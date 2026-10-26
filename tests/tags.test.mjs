import assert from "node:assert/strict";
import test from "node:test";
import { defaultTags, isNoteTag, tagName, validateTagName } from "../src/tags.ts";

const translate = (key) =>
  ({ "tags.work": "Travail", "tags.personal": "Personnel", "tags.ideas": "Idées" })[key] ?? key;

test("default tag identities remain compatible with saved notes", () => {
  assert.deepEqual(
    defaultTags().map((tag) => tag.id),
    ["work", "personal", "ideas"],
  );
  assert.equal(tagName(defaultTags()[0], translate), "Travail");
  assert.equal(tagName({ ...defaultTags()[0], name: "Clients" }, translate), "Clients");
});

test("tag names reject blanks and case insensitive duplicates, including localized defaults", () => {
  const tags = defaultTags();
  assert.equal(validateTagName("  ", tags, translate), "emptyName");
  assert.equal(validateTagName(" travail ", tags, translate), "duplicateName");
  assert.equal(validateTagName("Travail", tags, translate, "work"), null);
  assert.equal(validateTagName("Clients", tags, translate), null);
});

test("custom tags validate arbitrary identities and safe colors", () => {
  assert.equal(isNoteTag({ id: "tag-custom-123", name: "Clients", color: "#00aaff" }), true);
  assert.equal(isNoteTag({ id: "tag-custom-123", name: "Clients", color: "not-a-color" }), false);
});
