import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { computed, nextTick, onBeforeUnmount, onMounted, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import { isPersistedNote } from "../persistence.ts";
import { noteText } from "../editor/markdown.ts";
import { defaultTags, tagName as displayTagName, validateTagName } from "../tags.ts";
import type { TagError } from "@/app/tags";
import type { Persistence } from "@/app/persistence";
import type { FilterId, Note, NoteTag, TagId } from "@/app/types";

const SAVE_RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000];
const CLOCK_INTERVAL = 30_000;
const HISTORY_LIMIT = 100;

export function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function createStarterNotes(translate: (key: string) => string): Note[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return [
    {
      id: createId(),
      title: translate("starter.planningTitle"),
      body: translate("starter.planningBody"),
      bodyFormat: "markdown",
      tag: "work",
      pinned: true,
      archived: false,
      trashed: false,
      createdAt: now - day,
      updatedAt: now - 90 * 1000,
    },
    {
      id: createId(),
      title: translate("starter.weekendTitle"),
      body: translate("starter.weekendBody"),
      bodyFormat: "markdown",
      tag: "personal",
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now - 2 * day,
      updatedAt: now - 3 * 60 * 60 * 1000,
    },
    {
      id: createId(),
      title: translate("starter.meetingTitle"),
      body: translate("starter.meetingBody"),
      bodyFormat: "markdown",
      tag: "work",
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now - 3 * day,
      updatedAt: now - day,
    },
    {
      id: createId(),
      title: translate("starter.booksTitle"),
      body: translate("starter.booksBody"),
      bodyFormat: "markdown",
      tag: "ideas",
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now - 7 * day,
      updatedAt: now - 3 * day,
    },
    {
      id: createId(),
      title: translate("starter.shoppingTitle"),
      body: translate("starter.shoppingBody"),
      bodyFormat: "markdown",
      tag: "personal",
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now - 9 * day,
      updatedAt: now - 5 * day,
    },
  ];
}

export function isToday(timestamp: number, now = Date.now()): boolean {
  const date = new Date(timestamp);
  const today = new Date(now);
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

type Translate = (key: string) => string;

interface NotesStoreOptions {
  initialNotes: Note[] | null;
  initialTags: NoteTag[] | null;
  locale: Readonly<Ref<string>>;
  persistence: Persistence;
  translate: Translate;
  focusSearch: () => void;
  focusTitle: () => void;
  selectionLocked?: Readonly<Ref<boolean>>;
  openSettings?: () => void;
  openShortcuts?: () => void;
  quitApp?: () => Promise<void>;
}

export function useNotesStore({
  initialNotes,
  initialTags,
  locale,
  persistence,
  translate,
  focusSearch,
  focusTitle,
  selectionLocked = ref(false),
  openSettings = () => {},
  openShortcuts = () => {},
  quitApp = () => invoke("quit_app"),
}: NotesStoreOptions) {
  const notes = ref<Note[]>([]);
  const tags = ref<NoteTag[]>(initialTags ?? defaultTags());
  const tagsVisible = ref(false);
  const selectedNoteId = ref("");
  const activeFilter = ref<FilterId>("all");
  const searchQuery = ref("");
  const saved = ref(true);
  // The app stays open for days in the menu bar: "Today" and relative times
  // must follow the clock, not only re-renders.
  const now = ref(Date.now());
  const saveError = ref(false);
  const quitBlocked = ref(false);
  const pendingDeletionId = ref<string | null>(null);
  const pendingTagDeletionId = ref<TagId | null>(null);
  const emptyTrashPending = ref(false);
  const nativeRuntime = isTauri();

  let initialized = false;
  let disposed = false;
  let revision = 0;
  let quitting = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let failedSaves = 0;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let removeNewNoteListener: (() => void) | undefined;
  let removeQuitListener: (() => void) | undefined;
  // Notes created in this session and not yet left: discarded if still empty.
  const draftNoteIds = new Set<string>();
  const history: string[] = [];
  let historyIndex = -1;

  function noteMatchesFilter(note: Note): boolean {
    if (activeFilter.value === "trash") return note.trashed;
    if (note.trashed) return false;
    if (activeFilter.value === "archive") return note.archived;
    if (note.archived) return false;
    if (activeFilter.value === "today") return isToday(note.updatedAt, now.value);
    if (activeFilter.value === "pinned") return note.pinned;
    if (activeFilter.value.startsWith("tag:")) return note.tag === activeFilter.value.slice(4);
    return true;
  }

  const visibleNotes = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase(locale.value);
    const tagNames = new Map(tags.value.map((tag) => [tag.id, tagName(tag)]));
    return notes.value
      .filter(noteMatchesFilter)
      .filter((note) => {
        if (!query) return true;
        const tagLabel = note.tag ? (tagNames.get(note.tag) ?? "") : "";
        return `${note.title} ${noteText(note)} ${tagLabel}`
          .toLocaleLowerCase(locale.value)
          .includes(query);
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  });

  const selectedNote = computed(
    () => notes.value.find((note) => note.id === selectedNoteId.value) ?? null,
  );

  const pendingDeletion = computed(
    () => notes.value.find((note) => note.id === pendingDeletionId.value) ?? null,
  );

  const activeFilterTitle = computed(() => {
    if (activeFilter.value.startsWith("tag:"))
      return tagName(tags.value.find((tag) => tag.id === activeFilter.value.slice(4)));
    const keys: Record<Exclude<FilterId, `tag:${TagId}`>, string> = {
      all: "app.notes",
      today: "app.today",
      pinned: "app.pinned",
      archive: "app.archive",
      trash: "app.trash",
    };
    return translate(keys[activeFilter.value as Exclude<FilterId, `tag:${TagId}`>]);
  });

  const noteCounts = computed(() => ({
    all: notes.value.filter((note) => !note.trashed && !note.archived).length,
    today: notes.value.filter(
      (note) => !note.trashed && !note.archived && isToday(note.updatedAt, now.value),
    ).length,
    pinned: notes.value.filter((note) => !note.trashed && !note.archived && note.pinned).length,
    archive: notes.value.filter((note) => !note.trashed && note.archived).length,
    trash: notes.value.filter((note) => note.trashed).length,
  }));

  const tagCounts = computed<Record<TagId, number>>(() =>
    Object.fromEntries(
      tags.value.map((tag) => [
        tag.id,
        notes.value.filter((note) => !note.trashed && !note.archived && note.tag === tag.id).length,
      ]),
    ),
  );

  function tagName(tag?: NoteTag): string {
    return tag ? displayTagName(tag, translate) : "";
  }

  function openTags(): void {
    tagsVisible.value = true;
  }
  function closeTags(): void {
    tagsVisible.value = false;
  }

  function addTag(name: string, color: string): TagError | null {
    const error = validateTagName(name, tags.value, translate);
    if (error) return error;
    tags.value.push({ id: createId(), name: name.trim(), color });
    markDirty();
    return null;
  }

  function editTag(id: TagId, name: string, color: string): TagError | null {
    const error = validateTagName(name, tags.value, translate, id);
    if (error) return error;
    const tag = tags.value.find((tag) => tag.id === id);
    if (tag) {
      tag.name = name.trim();
      tag.color = color;
      markDirty();
    }
    return null;
  }

  const pendingTagDeletion = computed(() => {
    const tag = tags.value.find((candidate) => candidate.id === pendingTagDeletionId.value);
    if (!tag) return null;
    return { tag, noteCount: notes.value.filter((note) => note.tag === tag.id).length };
  });

  function requestDeleteTag(id: TagId): void {
    pendingTagDeletionId.value = id;
  }

  function confirmDeleteTag(): void {
    const id = pendingTagDeletionId.value;
    pendingTagDeletionId.value = null;
    if (id) deleteTag(id);
  }

  function cancelDeleteTag(): void {
    pendingTagDeletionId.value = null;
  }

  function deleteTag(id: TagId): void {
    tags.value = tags.value.filter((tag) => tag.id !== id);
    for (const note of notes.value) {
      if (note.tag === id) note.tag = null;
    }
    if (activeFilter.value === `tag:${id}`) activeFilter.value = "all";
    markDirty();
  }

  async function persistNotes(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }

    const persistedRevision = revision;
    const snapshot = notes.value.map((note) => ({ ...note }));
    try {
      await persistence.saveNotes(
        snapshot,
        tags.value.map((tag) => ({ ...tag })),
      );
      failedSaves = 0;
      saveError.value = false;
      if (persistedRevision === revision) saved.value = true;
    } catch (error) {
      saved.value = false;
      saveError.value = true;
      console.error("TopNotes could not save notes.", error);
      scheduleRetry();
      throw error;
    }
  }

  function scheduleRetry(): void {
    if (saveTimer || disposed) return;
    const delay = SAVE_RETRY_DELAYS[Math.min(failedSaves, SAVE_RETRY_DELAYS.length - 1)];
    failedSaves += 1;
    saveTimer = setTimeout(() => void persistNotes().catch(() => undefined), delay);
  }

  function retrySave(): void {
    void persistNotes().catch(() => undefined);
  }

  async function requestQuit(): Promise<void> {
    if (quitting) return;
    quitting = true;
    try {
      await persistNotes();
    } catch {
      quitting = false;
      quitBlocked.value = true;
      return;
    }
    await quitApp();
  }

  async function forceQuit(): Promise<void> {
    quitBlocked.value = false;
    await quitApp();
  }

  function cancelQuit(): void {
    quitBlocked.value = false;
  }

  function markDirty(): void {
    revision += 1;
    saved.value = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistNotes().catch(() => undefined), 320);
  }

  function selectFilter(filter: FilterId): void {
    activeFilter.value = filter;
  }

  function selectNote(note: Note): void {
    selectedNoteId.value = note.id;
  }

  function navigateNote(direction: -1 | 1): void {
    const current = visibleNotes.value.findIndex((note) => note.id === selectedNoteId.value);
    const next =
      visibleNotes.value[Math.max(0, Math.min(visibleNotes.value.length - 1, current + direction))];
    if (next) selectNote(next);
  }

  function navigateHistory(direction: -1 | 1): void {
    let index = historyIndex + direction;
    while (index >= 0 && index < history.length) {
      const note = notes.value.find((candidate) => candidate.id === history[index]);
      if (note) {
        historyIndex = index;
        searchQuery.value = "";
        activeFilter.value = note.trashed ? "trash" : note.archived ? "archive" : "all";
        selectNote(note);
        return;
      }
      index += direction;
    }
  }

  function setSearchQuery(query: string): void {
    searchQuery.value = query;
  }

  function newNote(): void {
    const now = Date.now();
    const note: Note = {
      id: createId(),
      title: "",
      body: "",
      bodyFormat: "markdown",
      tag: null,
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    notes.value.unshift(note);
    draftNoteIds.add(note.id);
    activeFilter.value = "all";
    searchQuery.value = "";
    selectedNoteId.value = note.id;
    markDirty();
    void nextTick(focusTitle);
  }

  function discardEmptyDraft(id: string): void {
    if (!draftNoteIds.delete(id)) return;
    const note = notes.value.find((candidate) => candidate.id === id);
    if (!note || note.title.trim() || noteText(note)) return;
    notes.value = notes.value.filter((candidate) => candidate.id !== id);
    markDirty();
  }

  function touchSelectedNote(): Note | null {
    if (!selectedNote.value) return null;
    selectedNote.value.updatedAt = Date.now();
    markDirty();
    return selectedNote.value;
  }

  function updateTitle(title: string): void {
    if (!selectedNote.value) return;
    selectedNote.value.title = title;
    touchSelectedNote();
  }

  function updateBody(body: string): void {
    if (!selectedNote.value) return;
    selectedNote.value.body = body;
    selectedNote.value.bodyFormat = "markdown";
    touchSelectedNote();
  }

  // Converting a legacy HTML body is a storage migration, not a user edit:
  // keep updatedAt so the note does not jump to the top or into "Today".
  function convertLegacyBody(body: string): void {
    const note = selectedNote.value;
    if (!note || note.bodyFormat === "markdown") return;
    note.body = body;
    note.bodyFormat = "markdown";
    markDirty();
  }

  function updateTag(tag: TagId | null): void {
    if (!selectedNote.value) return;
    selectedNote.value.tag = tags.value.some((candidate) => candidate.id === tag) ? tag : null;
    touchSelectedNote();
  }

  function togglePin(): void {
    if (!selectedNote.value) return;
    selectedNote.value.pinned = !selectedNote.value.pinned;
    touchSelectedNote();
  }

  function toggleArchive(): void {
    if (!selectedNote.value) return;
    selectedNote.value.archived = !selectedNote.value.archived;
    selectedNote.value.trashed = false;
    touchSelectedNote();
  }

  function restoreNote(): void {
    if (!selectedNote.value) return;
    selectedNote.value.trashed = false;
    touchSelectedNote();
    activeFilter.value = selectedNote.value.archived ? "archive" : "all";
  }

  function trashOrDeleteNote(): void {
    const note = selectedNote.value;
    if (!note) return;
    if (note.trashed) {
      pendingDeletionId.value = note.id;
      return;
    }
    // Trashed notes are hidden from every other view and count, so they keep
    // their pin and archive state to get it back when restored.
    note.trashed = true;
    note.updatedAt = Date.now();
    markDirty();
  }

  function confirmDelete(): void {
    const id = pendingDeletionId.value;
    pendingDeletionId.value = null;
    if (!id) return;
    notes.value = notes.value.filter((candidate) => candidate.id !== id);
    markDirty();
  }

  function cancelDelete(): void {
    pendingDeletionId.value = null;
  }

  function requestEmptyTrash(): void {
    if (notes.value.some((note) => note.trashed)) emptyTrashPending.value = true;
  }

  function confirmEmptyTrash(): void {
    emptyTrashPending.value = false;
    notes.value = notes.value.filter((note) => !note.trashed);
    markDirty();
  }

  function cancelEmptyTrash(): void {
    emptyTrashPending.value = false;
  }

  function formatRelativeTime(timestamp: number): string {
    const difference = timestamp - now.value;
    const absolute = Math.abs(difference);
    if (absolute < 90 * 1000) return translate("time.now");
    const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
    if (absolute < 60 * 60 * 1000)
      return formatter.format(Math.round(difference / 60_000), "minute");
    if (absolute < 24 * 60 * 60 * 1000)
      return formatter.format(Math.round(difference / 3_600_000), "hour");
    if (absolute < 7 * 24 * 60 * 60 * 1000)
      return formatter.format(Math.round(difference / 86_400_000), "day");
    return new Intl.DateTimeFormat(locale.value, { day: "numeric", month: "short" }).format(
      timestamp,
    );
  }

  function notePreview(note: Note): string {
    return noteText(note) || translate("app.startWriting");
  }

  function handleKeyboardShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    if (
      typeof document !== "undefined" &&
      document.querySelector('[role="dialog"][aria-modal="true"]')
    )
      return;
    const primary = event.metaKey || event.ctrlKey;
    if (!primary && event.altKey && !event.shiftKey) {
      const actions: Record<string, () => void> = {
        ArrowUp: () => navigateNote(-1),
        ArrowDown: () => navigateNote(1),
        ArrowLeft: () => navigateHistory(-1),
        ArrowRight: () => navigateHistory(1),
      };
      if (actions[event.key]) {
        event.preventDefault();
        actions[event.key]();
      }
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
      event.preventDefault();
      navigateNote(event.shiftKey ? -1 : 1);
      return;
    }
    if (!primary || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      newNote();
    } else if (key === "f" || key === "k") {
      event.preventDefault();
      focusSearch();
    } else if (key === "s") {
      event.preventDefault();
      void persistNotes().catch(() => undefined);
    } else if (key === "[" || key === "]") {
      event.preventDefault();
      navigateHistory(key === "[" ? -1 : 1);
    } else if (key === ",") {
      event.preventDefault();
      openSettings();
    } else if (key === "/") {
      event.preventDefault();
      openShortcuts();
    }
  }

  async function initialize(): Promise<void> {
    notes.value = (initialNotes ?? createStarterNotes(translate))
      .filter(isPersistedNote)
      .map((note) => ({
        ...note,
        tag: tags.value.some((tag) => tag.id === note.tag) ? note.tag : null,
      }));
    selectedNoteId.value = visibleNotes.value[0]?.id ?? "";
    initialized = true;
    window.addEventListener("keydown", handleKeyboardShortcut);
    clockTimer = setInterval(() => {
      now.value = Date.now();
    }, CLOCK_INTERVAL);

    if (nativeRuntime) {
      [removeNewNoteListener, removeQuitListener] = await Promise.all([
        listen("topnotes://new-note", newNote).catch(() => undefined),
        listen("topnotes://quit-requested", () => void requestQuit().catch(() => undefined)).catch(
          () => undefined,
        ),
      ]);
    }

    if (initialNotes === null || initialTags === null) await persistNotes().catch(() => undefined);
  }

  function dispose(): void {
    disposed = true;
    if (clockTimer) clearInterval(clockTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (initialized && !saved.value) void persistNotes().catch(() => undefined);
    removeNewNoteListener?.();
    removeQuitListener?.();
    window.removeEventListener("keydown", handleKeyboardShortcut);
  }

  watch([visibleNotes, selectionLocked], ([currentNotes, locked]) => {
    if (locked) return;
    if (!currentNotes.some((note) => note.id === selectedNoteId.value)) {
      selectedNoteId.value = currentNotes[0]?.id ?? "";
    }
  });

  watch(selectedNoteId, (_id, previousId) => discardEmptyDraft(previousId), { flush: "sync" });

  watch(
    selectedNoteId,
    (id) => {
      if (!id || history[historyIndex] === id) return;
      history.splice(historyIndex + 1);
      history.push(id);
      if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
      historyIndex = history.length - 1;
    },
    { flush: "sync" },
  );

  onMounted(() => void initialize());
  onBeforeUnmount(dispose);

  return {
    activeFilter: readonly(activeFilter),
    activeFilterTitle,
    cancelDelete,
    cancelEmptyTrash,
    cancelQuit,
    confirmDelete,
    confirmEmptyTrash,
    convertLegacyBody,
    emptyTrashPending: readonly(emptyTrashPending),
    forceQuit,
    formatRelativeTime,
    newNote,
    noteCounts,
    notePreview,
    pendingDeletion,
    quitBlocked: readonly(quitBlocked),
    requestEmptyTrash,
    requestQuit,
    retrySave,
    saved: readonly(saved),
    saveError: readonly(saveError),
    searchQuery: readonly(searchQuery),
    selectFilter,
    selectedNote,
    selectedNoteId: readonly(selectedNoteId),
    selectNote,
    setSearchQuery,
    tagCounts,
    tags,
    tagName,
    tagsVisible: readonly(tagsVisible),
    openTags,
    closeTags,
    addTag,
    editTag,
    requestDeleteTag,
    confirmDeleteTag,
    cancelDeleteTag,
    pendingTagDeletion,
    toggleArchive,
    togglePin,
    trashOrDeleteNote,
    updateBody,
    updateTag,
    updateTitle,
    visibleNotes,
    restoreNote,
  };
}
