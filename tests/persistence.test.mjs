import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

class MemoryStorage {
  #values = new Map();
  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }
  setItem(key, value) {
    this.#values.set(key, String(value));
  }
  removeItem(key) {
    this.#values.delete(key);
  }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

afterEach(() => {
  delete globalThis.localStorage;
});

const validNote = {
  id: "valid",
  title: "Lisible",
  body: "Texte",
  bodyFormat: "markdown",
  tag: null,
  pinned: false,
  archived: false,
  trashed: false,
  createdAt: 1,
  updatedAt: 2,
};

test("notes the app cannot read are kept on disk instead of being dropped", async () => {
  const { BrowserPersistence } = await import("../src/persistence.ts");
  const unreadable = { ...validNote, id: "future", bodyFormat: "asciidoc" };
  localStorage.setItem(
    "topnotes.data.v1",
    JSON.stringify({
      schemaVersion: 1,
      notes: [validNote, unreadable],
      tags: null,
      settings: null,
    }),
  );

  const persistence = new BrowserPersistence();
  const loaded = await persistence.load();
  assert.deepEqual(
    loaded.notes.map((note) => note.id),
    ["valid"],
  );

  await persistence.saveNotes([{ ...validNote, title: "Modifiée" }]);
  const stored = JSON.parse(localStorage.getItem("topnotes.data.v1"));
  assert.deepEqual(
    stored.notes.map((note) => note.id),
    ["valid", "future"],
  );
  assert.equal(stored.notes[0].title, "Modifiée");
  assert.deepEqual(stored.notes[1], unreadable);
});
