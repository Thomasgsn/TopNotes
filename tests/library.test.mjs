import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createRenderer, nextTick, ref } from "vue";
import { useNotesStore } from "../src/stores/notes.ts";
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

function mountLibrary() {
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
