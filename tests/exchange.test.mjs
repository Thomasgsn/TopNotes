import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJsonExport, buildMarkdownExport, parseJsonImport } from "../src/exchange.ts";

const tags = [
  { id: "work", name: "", color: "#c96864" },
  { id: "custom", name: "Clients", color: "#00aaff" },
];
const translate = (key) => ({ "tags.work": "Travail", "app.untitled": "Sans titre" })[key] ?? key;
const note = (overrides) => ({
  id: "n1",
  title: "Réunion",
  body: "# Points\n\n- un",
  bodyFormat: "markdown",
  tag: "work",
  pinned: false,
  archived: false,
  trashed: false,
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 2),
  ...overrides,
});

test("a JSON export can be imported back unchanged", () => {
  const notes = [note(), note({ id: "n2", trashed: true, trashedAt: 5 })];
  const file = buildJsonExport(notes, tags);
  assert.equal(file.name, "topnotes.json");
  const parsed = parseJsonImport(file.content);
  assert.deepEqual(parsed.notes, notes);
  assert.deepEqual(parsed.tags, tags);
});

test("imports reject files that are not TopNotes exports", () => {
  assert.throws(() => parseJsonImport("not json"));
  assert.throws(() => parseJsonImport(JSON.stringify({ notes: [] })));
  assert.throws(() => parseJsonImport(JSON.stringify({ format: "topnotes-export", version: 99 })));
  const mixed = JSON.parse(buildJsonExport([note()], tags).content);
  mixed.notes.push({ id: "broken" });
  assert.deepEqual(
    parseJsonImport(JSON.stringify(mixed)).notes.map((item) => item.id),
    ["n1"],
  );
});

test("a Markdown export writes one safe, unique file per note outside the trash", () => {
  const files = buildMarkdownExport(
    [
      note(),
      note({ id: "n2", title: "Réunion", tag: "custom" }),
      note({ id: "n3", title: "a/b:c*?", tag: null }),
      note({
        id: "n4",
        title: "",
        body: "<p>Ancien <strong>HTML</strong></p>",
        bodyFormat: undefined,
      }),
      note({ id: "n5", title: "Jetée", trashed: true }),
    ],
    tags,
    translate,
  );
  assert.deepEqual(
    files.map((file) => file.name),
    ["Réunion.md", "Réunion 2.md", "a b c.md", "Sans titre.md"],
  );
  assert.equal(
    files[0].content,
    '---\ntitle: "Réunion"\ntag: "Travail"\ncreated: 2026-10-01T00:00:00.000Z\nupdated: 2026-10-02T00:00:00.000Z\n---\n\n# Points\n\n- un\n',
  );
  assert.match(files[1].content, /tag: "Clients"/);
  assert.doesNotMatch(files[2].content, /tag:/);
  assert.match(files[3].content, /\n\nAncien HTML\n$/);
});
