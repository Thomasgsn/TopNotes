import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createRenderer, nextTick, ref } from "vue";
import { createStarterNotes, useNotesStore } from "../src/stores/notes.ts";
import { i18n, supportedLocales } from "../src/i18n.ts";
import { defaultTags } from "../src/tags.ts";

const renderer = createRenderer({
  createComment: () => ({}),
  insert: () => {},
  remove: () => {},
  parentNode: () => null,
  nextSibling: () => null,
});
const apps = [];

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.isTauri = false;
});

afterEach(async () => {
  apps.splice(0).forEach((app) => app.unmount());
  await nextTick();
  delete globalThis.window;
  delete globalThis.isTauri;
});

function mountLibrary(overrides = {}) {
  let store;
  const snapshots = [];
  const calls = { search: 0, settings: 0, shortcuts: 0 };
  const locked = ref(false);
  const app = renderer.createApp({
    setup() {
      store = useNotesStore({
        initialNotes: [
          {
            id: "note-1",
            title: "Note",
            body: "# Titre",
            bodyFormat: "markdown",
            tag: "work",
            pinned: false,
            archived: false,
            trashed: false,
            createdAt: 1,
            updatedAt: Date.now(),
          },
        ],
        initialTags: defaultTags(),
        locale: ref("fr"),
        persistence: {
          saveNotes: async (notes, tags) => snapshots.push(structuredClone({ notes, tags })),
        },
        translate: (key) =>
          ({ "tags.work": "Travail", "tags.personal": "Personnel", "tags.ideas": "Idées" })[key] ??
          key,
        focusSearch: () => {
          calls.search++;
        },
        focusTitle: () => {},
        selectionLocked: locked,
        openSettings: () => {
          calls.settings++;
        },
        openShortcuts: () => {
          calls.shortcuts++;
        },
        ...overrides,
      });
      return () => null;
    },
  });
  app.mount({});
  apps.push(app);
  return { store, snapshots, app, locked, calls };
}

test("custom tags can be added, assigned, renamed, filtered and deleted without deleting notes", async () => {
  const { store, snapshots, app } = mountLibrary();
  assert.equal(store.addTag("Clients", "#00aaff"), null);
  const custom = store.tags.value.find((tag) => tag.name === "Clients");
  store.updateTag(custom.id);
  store.selectFilter(`tag:${custom.id}`);
  await nextTick();
  assert.equal(store.visibleNotes.value.length, 1);
  assert.equal(store.tagCounts.value[custom.id], 1);
  assert.equal(store.editTag(custom.id, "Projets", "#aabbcc"), null);
  assert.equal(store.activeFilterTitle.value, "Projets");
  assert.equal(store.selectedNote.value.tag, custom.id);
  store.deleteTag(custom.id);
  await nextTick();
  assert.equal(store.selectedNote.value.tag, null);
  assert.equal(store.activeFilter.value, "all");
  assert.equal(store.visibleNotes.value.length, 1);
  assert.equal(store.visibleNotes.value[0].body, "# Titre");
  app.unmount();
  apps.splice(apps.indexOf(app), 1);
  assert.equal(snapshots.at(-1).notes[0].tag, null);
  assert.equal(
    snapshots.at(-1).tags.some((tag) => tag.id === custom.id),
    false,
  );
});

test("duplicate names do not change the tag catalog", () => {
  const { store } = mountLibrary();
  assert.equal(store.addTag("travail", "#00aaff"), "duplicateName");
  assert.equal(store.editTag("ideas", "Travail", "#00aaff"), "duplicateName");
  assert.equal(store.tags.value.length, 3);
});

test("editing Markdown keeps the detached note selected when it stops matching a search", async () => {
  const { store, locked } = mountLibrary();
  store.setSearchQuery("Titre");
  locked.value = true;
  store.updateBody("# Autre titre");
  assert.equal(store.selectedNote.value.bodyFormat, "markdown");
  await nextTick();
  assert.equal(store.selectedNote.value.id, "note-1");
  store.updateBody("# Complètement changé");
  await nextTick();
  assert.equal(store.visibleNotes.value.length, 0);
  assert.equal(store.selectedNote.value.id, "note-1");
  locked.value = false;
  await nextTick();
  assert.equal(store.selectedNote.value, null);
});

function shortcut(key, modifiers = {}) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  });
  window.dispatchEvent(event);
  return event;
}

test("Slack navigation shortcuts move between notes and preserve back and forward history", async () => {
  const { store } = mountLibrary();
  store.newNote();
  store.updateTitle("Deuxième");
  const second = store.selectedNote.value.id;
  store.newNote();
  store.updateTitle("Troisième");
  const third = store.selectedNote.value.id;
  await nextTick();
  shortcut("ArrowDown", { altKey: true });
  assert.equal(store.selectedNote.value.id, second);
  shortcut("ArrowUp", { altKey: true });
  assert.equal(store.selectedNote.value.id, third);
  shortcut("[", { metaKey: true });
  assert.equal(store.selectedNote.value.id, second);
  shortcut("]", { metaKey: true });
  assert.equal(store.selectedNote.value.id, third);
  shortcut("Tab", { ctrlKey: true });
  assert.equal(store.selectedNote.value.id, second);
  shortcut("Tab", { ctrlKey: true, shiftKey: true });
  assert.equal(store.selectedNote.value.id, third);
});

test("app shortcuts open search, settings and help without intercepting editor formatting", () => {
  const { calls } = mountLibrary();
  shortcut("k", { metaKey: true });
  shortcut("f", { ctrlKey: true });
  shortcut(",", { metaKey: true });
  shortcut("/", { metaKey: true });
  assert.deepEqual(calls, { search: 2, settings: 1, shortcuts: 1 });
  const markdown = shortcut("f", { metaKey: true, shiftKey: true });
  assert.equal(markdown.defaultPrevented, false);
  assert.equal(calls.search, 2);
});

test("deleting a trashed note permanently waits for confirmation", async () => {
  const { store } = mountLibrary();
  store.trashOrDeleteNote();
  store.selectFilter("trash");
  await nextTick();
  assert.equal(store.selectedNote.value.id, "note-1");

  store.trashOrDeleteNote();
  await nextTick();
  assert.equal(store.visibleNotes.value.length, 1);
  assert.equal(store.pendingDeletion.value.id, "note-1");

  store.cancelDelete();
  await nextTick();
  assert.equal(store.pendingDeletion.value, null);
  assert.equal(store.visibleNotes.value.length, 1);

  store.trashOrDeleteNote();
  store.confirmDelete();
  await nextTick();
  assert.equal(store.pendingDeletion.value, null);
  assert.equal(store.visibleNotes.value.length, 0);
});

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a failed save is reported and retried until it succeeds", async (context) => {
  context.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  let failures = 1;
  const writes = [];
  const { store } = mountLibrary({
    persistence: {
      saveNotes: async (notes) => {
        if (failures-- > 0) throw new Error("disk full");
        writes.push(structuredClone(notes));
      },
    },
  });
  store.updateTitle("Important");
  mock.timers.tick(320);
  await flushPromises();
  assert.equal(store.saved.value, false);
  assert.equal(store.saveError.value, true);
  assert.equal(writes.length, 0);

  mock.timers.tick(2000);
  await flushPromises();
  assert.equal(store.saved.value, true);
  assert.equal(store.saveError.value, false);
  assert.equal(writes.at(-1)[0].title, "Important");
});

test("quitting reports a failed save instead of silently staying open", async () => {
  let quits = 0;
  const { store } = mountLibrary({
    persistence: {
      saveNotes: async () => {
        throw new Error("read-only volume");
      },
    },
    quitApp: async () => {
      quits++;
    },
  });
  await store.requestQuit();
  assert.equal(quits, 0);
  assert.equal(store.quitBlocked.value, true);

  await store.forceQuit();
  assert.equal(quits, 1);
});

test("converting a legacy HTML note on open keeps its modification date and position", async (context) => {
  context.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  const writes = [];
  const legacy = {
    id: "legacy",
    title: "Ancienne",
    body: "<p>Texte</p>",
    tag: null,
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: 1,
    updatedAt: 5,
  };
  const recent = { ...legacy, id: "recent", title: "Récente", updatedAt: 10 };
  const { store } = mountLibrary({
    initialNotes: [recent, legacy],
    persistence: { saveNotes: async (notes) => writes.push(structuredClone(notes)) },
  });
  await nextTick();
  store.selectNote(store.visibleNotes.value[1]);
  store.convertLegacyBody("Texte");
  await nextTick();
  assert.equal(store.selectedNote.value.bodyFormat, "markdown");
  assert.equal(store.selectedNote.value.body, "Texte");
  assert.equal(store.selectedNote.value.updatedAt, 5);
  assert.deepEqual(
    store.visibleNotes.value.map((note) => note.id),
    ["recent", "legacy"],
  );

  mock.timers.tick(320);
  await flushPromises();
  assert.equal(writes.at(-1).find((note) => note.id === "legacy").bodyFormat, "markdown");
});

test("starter notes are stored as Markdown in every language", () => {
  for (const locale of supportedLocales) {
    i18n.global.locale.value = locale;
    for (const note of createStarterNotes((key) => String(i18n.global.t(key)))) {
      assert.equal(note.bodyFormat, "markdown", `${locale}: ${note.title}`);
      assert.doesNotMatch(note.body, /<\/?[a-z]+>/, `${locale}: ${note.title}`);
    }
  }
});
