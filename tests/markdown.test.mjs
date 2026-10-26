import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { markdownExtensions, noteText } from "../src/editor/markdown.ts";
import { applyLink, readLinkDraft, removeLink, normalizeLinkUrl } from "../src/editor/links.ts";
import { editorShortcuts, navigationShortcuts } from "../src/editor/shortcuts.ts";
import { editorMessages } from "../src/editorMessages.ts";

let dom;
const editors = [];

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  for (const key of [
    "window",
    "document",
    "Node",
    "HTMLElement",
    "KeyboardEvent",
    "DOMParser",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    globalThis[key] =
      typeof dom.window[key] === "function" && key.includes("AnimationFrame")
        ? dom.window[key].bind(dom.window)
        : dom.window[key];
  }
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  dom.window.close();
});

function createEditor(content = "", contentType = "markdown", options = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: markdownExtensions(options),
    content,
    contentType,
  });
  editors.push(editor);
  return editor;
}

function type(editor, text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, character),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}

test("Markdown headings, nested lists and checkboxes survive saving and reopening", () => {
  const source =
    "# Titre\n\n## Sous-titre\n\n- Premier\n  - Imbriqué\n\n1. Ordonné\n\n- [ ] À faire\n- [x] Terminé\n\n**Gras** et *italique*\n\n```js\nconst n = 1\n```";
  const editor = createEditor(source);
  assert.equal(editor.view.dom.querySelector("h1").textContent, "Titre");
  assert.equal(editor.view.dom.querySelector("h2").textContent, "Sous-titre");
  assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
  assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]')[1].checked, true);
  const reopened = createEditor(editor.getMarkdown());
  assert.deepEqual(reopened.getJSON(), editor.getJSON());
});

for (const [prefix, node] of [
  ["# ", "heading"],
  ["- ", "bulletList"],
  ["1. ", "orderedList"],
  ["[ ] ", "taskList"],
  ["- [ ] ", "taskList"],
]) {
  test(`typing ${JSON.stringify(prefix)} creates ${node}`, () => {
    const editor = createEditor();
    type(editor, prefix);
    assert.equal(editor.getJSON().content[0].type, node);
  });
}

test("clicking a checkbox updates the stored Markdown", () => {
  const editor = createEditor("- [ ] Acheter du café");
  editor.view.dom.querySelector('input[type="checkbox"]').click();
  assert.match(editor.getMarkdown(), /- \[x\] Acheter du café/);
});

test("pasting plain Markdown recognizes headings and task lists", () => {
  const editor = createEditor();
  const clipboardData = {
    getData: (type) => (type === "text/plain" ? "# Collé\n\n- [ ] À faire" : ""),
  };
  const handled = editor.view.someProp("handlePaste", (handler) =>
    handler(editor.view, { clipboardData }),
  );
  assert.equal(handled, true);
  assert.equal(editor.view.dom.querySelector("h1").textContent, "Collé");
  assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 1);
});

test("legacy HTML converts to Markdown without losing headings, lists or emphasis", () => {
  const editor = createEditor(
    "<h2>Ancienne note</h2><p>Un <strong>objectif</strong> et un <em>détail</em>.</p><ul><li>Premier</li><li>Second</li></ul>",
    "html",
  );
  const markdown = editor.getMarkdown();
  assert.match(markdown, /## Ancienne note/);
  assert.match(markdown, /\*\*objectif\*\*/);
  assert.match(markdown, /\*détail\*/);
  const reopened = createEditor(markdown);
  assert.deepEqual(reopened.getJSON(), editor.getJSON());
});

test("note previews show text without Markdown syntax", () => {
  const body = "# Titre\n\n- [x] **Terminé**\n- [ ] À faire";
  assert.equal(noteText({ body, bodyFormat: "markdown" }), "Titre Terminé À faire");
});

for (const [key, mark] of [
  ["Mod-b", "bold"],
  ["Mod-i", "italic"],
  ["Mod-u", "underline"],
  ["Mod-Shift-x", "strike"],
  ["Mod-Shift-c", "code"],
]) {
  test(`Slack shortcut ${key} applies ${mark} to the selection`, () => {
    const editor = createEditor("Sélection");
    editor.commands.selectAll();
    editor.commands.keyboardShortcut(key);
    assert.ok(
      editor.getJSON().content[0].content[0].marks.some((candidate) => candidate.type === mark),
    );
  });
}

for (const [key, type, level] of [
  ["Mod-Shift-9", "blockquote"],
  ["Mod-Alt-Shift-c", "codeBlock"],
  ["Mod-Shift-8", "bulletList"],
  ["Mod-Shift-7", "orderedList"],
  ["Mod-Shift-0", "taskList"],
  ["Mod-Alt-1", "heading", 1],
  ["Mod-Alt-2", "heading", 2],
  ["Mod-Alt-3", "heading", 3],
]) {
  test(`Slack shortcut ${key} applies ${type}`, () => {
    const editor = createEditor("Sélection");
    editor.commands.selectAll();
    editor.commands.keyboardShortcut(key);
    const node = editor.getJSON().content[0];
    assert.equal(node.type, type);
    if (level) assert.equal(node.attrs.level, level);
  });
}

test("the Slack hyperlink shortcut opens the dialog with the selection intact", () => {
  let opened = false;
  const editor = createEditor("Mon site", "markdown", {
    openLink: () => {
      opened = true;
    },
  });
  editor.commands.selectAll();
  editor.commands.keyboardShortcut("Mod-Shift-u");
  assert.equal(opened, true);
  assert.equal(readLinkDraft(editor).label, "Mon site");
});

test("link insertion and editing update the address and label without duplicating content", () => {
  const editor = createEditor("Mon site");
  editor.commands.selectAll();
  assert.equal(applyLink(editor, readLinkDraft(editor), "example.com", "Visiter le site"), true);
  assert.equal(editor.view.dom.querySelector("a").textContent, "Visiter le site");
  editor.commands.setTextSelection(3);
  const draft = readLinkDraft(editor);
  assert.equal(draft.label, "Visiter le site");
  assert.equal(applyLink(editor, draft, "https://example.org/docs", "Documentation"), true);
  assert.equal(editor.getText(), "Documentation");
  assert.equal(editor.view.dom.querySelectorAll("a").length, 1);
  assert.equal(editor.view.dom.querySelector("a").getAttribute("href"), "https://example.org/docs");
  editor.commands.setTextSelection(3);
  removeLink(editor, readLinkDraft(editor));
  assert.equal(editor.getText(), "Documentation");
  assert.equal(editor.view.dom.querySelector("a"), null);
});

test("link addresses accept websites and email and reject unsafe or incomplete values", () => {
  assert.equal(normalizeLinkUrl("example.com"), "https://example.com/");
  assert.equal(normalizeLinkUrl("mailto:test@example.com"), "mailto:test@example.com");
  for (const value of ["javascript:alert(1)", "data:text/html,test", "https://", "two words", ""])
    assert.equal(normalizeLinkUrl(value), null);
});

test("pasting an address over selected text creates a hyperlink without replacing the label", () => {
  const editor = createEditor("Mon site");
  editor.commands.selectAll();
  editor.view.someProp("handlePaste", (handler) =>
    handler(
      editor.view,
      {
        clipboardData: { getData: (type) => (type === "text/plain" ? "https://example.com" : "") },
      },
      Slice.empty,
    ),
  );
  assert.equal(editor.getText(), "Mon site");
  assert.equal(editor.view.dom.querySelector("a").getAttribute("href"), "https://example.com/");
});

test("Slack shortcuts apply Markdown, undo and redo", () => {
  const editor = createEditor("<p>**Important**</p>", "html");
  editor.commands.selectAll();
  editor.commands.keyboardShortcut("Mod-Shift-f");
  assert.equal(editor.view.dom.querySelector("strong").textContent, "Important");
  editor.commands.keyboardShortcut("Mod-z");
  assert.equal(editor.getText(), "**Important**");
  editor.commands.keyboardShortcut("Mod-Shift-z");
  assert.equal(editor.view.dom.querySelector("strong").textContent, "Important");
});

test("list items can move up and down with Slack canvas shortcuts", () => {
  const editor = createEditor("- Un\n- Deux\n- Trois");
  let secondPosition;
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "Deux") secondPosition = position + 1;
  });
  editor.commands.setTextSelection(secondPosition);
  const move = (key) => {
    const mac = /Mac|iPad|iPhone/.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      key,
      altKey: true,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    });
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));
  };
  move("ArrowUp");
  assert.deepEqual(
    editor.getJSON().content[0].content.map((item) => item.content[0].content[0].text),
    ["Deux", "Un", "Trois"],
  );
  move("ArrowDown");
  assert.deepEqual(
    editor.getJSON().content[0].content.map((item) => item.content[0].content[0].text),
    ["Un", "Deux", "Trois"],
  );
});

test("the shortcuts dialog has translations for every registered shortcut", () => {
  for (const messages of Object.values(editorMessages)) {
    for (const shortcut of [...editorShortcuts, ...navigationShortcuts])
      assert.ok(messages.shortcuts[shortcut.id]);
  }
});

test("plain text that looks like block Markdown reopens as the same plain text", () => {
  const literals = [
    "- pas une liste",
    "+ pas une liste",
    "* pas une liste",
    "1. pas une liste",
    "12) pas une liste",
    "# pas un titre",
    "###### pas un titre",
    "---",
    "- - -",
    "===",
    "Prix : 5 - 3 = 2 # ok",
  ];
  for (const text of literals) {
    const editor = createEditor("");
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const reopened = createEditor(editor.getMarkdown());
    assert.deepEqual(reopened.getJSON(), editor.getJSON(), text);
  }
});

test("literal block markers after a line break stay plain text", () => {
  const editor = createEditor("");
  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Titre" },
          { type: "hardBreak" },
          { type: "text", text: "- suite" },
          { type: "hardBreak" },
          { type: "text", text: "===" },
        ],
      },
    ],
  });
  const reopened = createEditor(editor.getMarkdown());
  assert.deepEqual(reopened.getJSON(), editor.getJSON());
});

test("real lists, headings and rules keep their Markdown syntax", () => {
  const markdown = "# Titre\n\n- un\n- deux\n\n1. premier\n\n---\n\nTexte";
  assert.equal(createEditor(markdown).getMarkdown(), markdown);
});

test("note text is computed once per body so long lists stay responsive", () => {
  const notes = Array.from({ length: 500 }, (_, index) => ({
    body: `# Note ${index}\n\nUn paragraphe **gras** et une liste\n\n- a\n- b`,
    bodyFormat: "markdown",
  }));
  notes.forEach((note) => noteText(note));
  const start = performance.now();
  for (let render = 0; render < 5; render++) notes.forEach((note) => noteText(note));
  assert.ok(performance.now() - start < 50, "re-rendering 500 previews must not re-parse them");
  assert.equal(noteText(notes[3]), "Note 3 Un paragraphe gras et une liste a b");
});

test("cached note text follows body changes", () => {
  const note = { body: "Avant", bodyFormat: "markdown" };
  assert.equal(noteText(note), "Avant");
  note.body = "**Après**";
  assert.equal(noteText(note), "Après");
});
