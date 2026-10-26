import type { JSONContent } from "@tiptap/core";
import { Extension, InputRule } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
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
    StarterKit.configure({ link: { openOnClick: false } }),
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

export function noteText(note: Pick<Note, "body" | "bodyFormat">): string {
  if (note.bodyFormat === "markdown") {
    return documentText(markdown.parse(note.body)).replace(/\s+/g, " ").trim();
  }
  if (typeof document === "undefined") return note.body.replace(/<[^>]+>/g, " ").trim();
  const template = document.createElement("template");
  template.innerHTML = note.body;
  return (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
}
