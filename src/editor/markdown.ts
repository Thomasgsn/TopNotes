import type { JSONContent } from "@tiptap/core";
import { Extension, InputRule } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";
import type { Note } from "../types/Note";
import { editorShortcuts } from "./shortcuts.ts";
import { normalizeLinkUrl } from "./links.ts";

const MarkdownTaskItem = TaskItem.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[([ xX])\]\s$/,
        handler: ({ range, match, chain }) => {
          const commands = chain().deleteRange(range);
          if (!this.editor.isActive("taskList")) commands.toggleTaskList();
          commands.updateAttributes("taskItem", { checked: match[1].toLowerCase() === "x" }).run();
        },
      }),
    ];
  },
});

// @tiptap/markdown only escapes inline delimiters. Text that starts a line with a
// list, heading, rule or setext marker would reopen as that block, so escape it.
export function escapeBlockSyntax(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^( {0,3})([-+*]|#{1,6})(?=\s|$)/, "$1\\$2")
        .replace(/^( {0,3})(-)(?=(?:\s*-){2,}\s*$)/, "$1\\$2")
        .replace(/^( {0,3}\d{1,9})([.)])(?=\s|$)/, "$1\\$2")
        .replace(/^( {0,3})(=+\s*)$/, "$1\\$2"),
    )
    .join("\n");
}

const MarkdownParagraph = Paragraph.extend({
  renderMarkdown(node, helpers, context) {
    return escapeBlockSyntax(this.parent?.(node, helpers, context) ?? "");
  },
});

// Link validation (isAllowedUri) does not apply to Markdown parsing: keep the
// label but drop links whose address is not a safe web or email address.
const SafeLink = Link.extend({
  parseMarkdown(token, helpers) {
    if (!normalizeLinkUrl(String(token.href ?? ""))) return helpers.parseInline(token.tokens ?? []);
    return this.parent?.(token, helpers) ?? [];
  },
}).configure({ openOnClick: false, isAllowedUri: (url) => normalizeLinkUrl(url) !== null });

const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const clipboard = event.clipboardData;
            if (!clipboard || this.editor.isActive("codeBlock")) return false;
            const text = clipboard.getData("text/plain");
            const href = /^(https?:\/\/|mailto:)/i.test(text) ? normalizeLinkUrl(text) : null;
            if (href && !this.editor.state.selection.empty)
              return this.editor.commands.setLink({ href });
            if (clipboard.getData("text/html")) return false;
            if (!/^(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s|```)|\*\*.+\*\*/m.test(text)) return false;
            return this.editor.commands.insertContent(text, { contentType: "markdown" });
          },
        },
      }),
    ];
  },
});

const SlackShortcuts = Extension.create<{ openLink: () => void }>({
  name: "slackShortcuts",
  priority: 1100,
  addOptions() {
    return { openLink: () => {} };
  },
  addKeyboardShortcuts() {
    return Object.fromEntries(
      editorShortcuts.map((shortcut) => [
        shortcut.key,
        () => shortcut.run(this.editor, this.options.openLink),
      ]),
    );
  },
});

export function markdownExtensions(options: { openLink?: () => void } = {}) {
  return [
    StarterKit.configure({ paragraph: false, link: false }),
    SafeLink,
    MarkdownParagraph,
    TaskList,
    MarkdownTaskItem.configure({ nested: true }),
    Markdown,
    MarkdownClipboard,
    SlackShortcuts.configure({ openLink: options.openLink ?? (() => {}) }),
  ];
}

const markdown = new MarkdownManager({ extensions: markdownExtensions() });

function documentText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(documentText).join(node.type === "paragraph" ? "" : " ");
}

// Previews, search and statistics read every note on each keystroke; parsing is
// the expensive part, so keep one cached text per note until its body changes.
const noteTextCache = new WeakMap<object, { body: string; bodyFormat?: string; text: string }>();

export function noteText(note: Pick<Note, "body" | "bodyFormat">): string {
  const cached = noteTextCache.get(note);
  if (cached && cached.body === note.body && cached.bodyFormat === note.bodyFormat) {
    return cached.text;
  }
  const text = extractNoteText(note);
  noteTextCache.set(note, { body: note.body, bodyFormat: note.bodyFormat, text });
  return text;
}

function extractNoteText(note: Pick<Note, "body" | "bodyFormat">): string {
  if (note.bodyFormat === "markdown") {
    return documentText(markdown.parse(note.body)).replace(/\s+/g, " ").trim();
  }
  if (typeof document === "undefined") return note.body.replace(/<[^>]+>/g, " ").trim();
  const template = document.createElement("template");
  template.innerHTML = note.body;
  return (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
}
