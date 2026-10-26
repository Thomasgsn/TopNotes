import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

export function moveListItem(editor: Editor, direction: -1 | 1): boolean {
  const { $from, from, to } = editor.state.selection;
  let depth = $from.depth;
  while (depth > 0 && !["listItem", "taskItem"].includes($from.node(depth).type.name)) depth--;
  if (!depth) return false;
  const item = $from.node(depth);
  const position = $from.before(depth);
  if (to >= position + item.nodeSize) return false;
  const list = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const neighbor = list.maybeChild(index + direction);
  if (!neighbor) return false;
  const start = direction < 0 ? position - neighbor.nodeSize : position;
  const replacement = direction < 0 ? [item, neighbor] : [neighbor, item];
  const newPosition = direction < 0 ? start : position + neighbor.nodeSize;
  const transaction = editor.state.tr.replaceWith(
    start,
    start + item.nodeSize + neighbor.nodeSize,
    Fragment.fromArray(replacement),
  );
  transaction.setSelection(
    TextSelection.create(
      transaction.doc,
      newPosition + from - position,
      newPosition + to - position,
    ),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function applyMarkdown(editor: Editor): boolean {
  const selection = editor.state.selection;
  const range = selection.empty
    ? { from: selection.$from.start(), to: selection.$from.end() }
    : { from: selection.from, to: selection.to };
  const text = editor.state.doc.textBetween(range.from, range.to, "\n");
  if (!text) return true;
  return editor.commands.insertContentAt(range, text, { contentType: "markdown" });
}

function cycleStyle(editor: Editor): boolean {
  if (editor.isActive("taskList")) return editor.commands.toggleTaskList();
  if (editor.isActive("orderedList")) return editor.commands.toggleTaskList();
  if (editor.isActive("bulletList")) return editor.commands.toggleOrderedList();
  if (editor.isActive("heading", { level: 3 })) return editor.commands.toggleBulletList();
  if (editor.isActive("heading", { level: 2 })) return editor.commands.setHeading({ level: 3 });
  if (editor.isActive("heading", { level: 1 })) return editor.commands.setHeading({ level: 2 });
  return editor.commands.setHeading({ level: 1 });
}

export const editorShortcuts = [
  { id: "bold", key: "Mod-b", run: (editor: Editor) => editor.commands.toggleBold() },
  { id: "italic", key: "Mod-i", run: (editor: Editor) => editor.commands.toggleItalic() },
  { id: "underline", key: "Mod-u", run: (editor: Editor) => editor.commands.toggleUnderline() },
  { id: "strike", key: "Mod-Shift-x", run: (editor: Editor) => editor.commands.toggleStrike() },
  {
    id: "link",
    key: "Mod-Shift-u",
    run: (_editor: Editor, openLink: () => void) => {
      openLink();
      return true;
    },
  },
  { id: "quote", key: "Mod-Shift-9", run: (editor: Editor) => editor.commands.toggleBlockquote() },
  { id: "inlineCode", key: "Mod-Shift-c", run: (editor: Editor) => editor.commands.toggleCode() },
  {
    id: "codeBlock",
    key: "Mod-Alt-Shift-c",
    run: (editor: Editor) => editor.commands.toggleCodeBlock(),
  },
  {
    id: "bulletList",
    key: "Mod-Shift-8",
    run: (editor: Editor) => editor.commands.toggleBulletList(),
  },
  {
    id: "orderedList",
    key: "Mod-Shift-7",
    run: (editor: Editor) => editor.commands.toggleOrderedList(),
  },
  { id: "taskList", key: "Mod-Shift-0", run: (editor: Editor) => editor.commands.toggleTaskList() },
  { id: "paragraph", key: "Mod-Alt-0", run: (editor: Editor) => editor.commands.clearNodes() },
  {
    id: "heading1",
    key: "Mod-Alt-1",
    run: (editor: Editor) => editor.commands.setHeading({ level: 1 }),
  },
  {
    id: "heading2",
    key: "Mod-Alt-2",
    run: (editor: Editor) => editor.commands.setHeading({ level: 2 }),
  },
  {
    id: "heading3",
    key: "Mod-Alt-3",
    run: (editor: Editor) => editor.commands.setHeading({ level: 3 }),
  },
  { id: "applyMarkdown", key: "Mod-Shift-f", run: applyMarkdown },
  { id: "undo", key: "Mod-z", run: (editor: Editor) => editor.commands.undo() },
  { id: "redo", key: "Mod-Shift-z", run: (editor: Editor) => editor.commands.redo() },
  { id: "lineBreak", key: "Shift-Enter", run: (editor: Editor) => editor.commands.setHardBreak() },
  {
    id: "indent",
    key: "Tab",
    run: (editor: Editor) =>
      editor.commands.sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem"),
  },
  {
    id: "outdent",
    key: "Shift-Tab",
    run: (editor: Editor) =>
      editor.commands.liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem"),
  },
  { id: "cycleStyle", key: "Ctrl-`", run: cycleStyle },
  { id: "moveUp", key: "Mod-Alt-ArrowUp", run: (editor: Editor) => moveListItem(editor, -1) },
  { id: "moveDown", key: "Mod-Alt-ArrowDown", run: (editor: Editor) => moveListItem(editor, 1) },
];

export const navigationShortcuts = [
  // Registered globally by the native app (src-tauri/src/lib.rs).
  { id: "toggleWindow", key: "Mod-Alt-n" },
  { id: "newNote", key: "Mod-n" },
  { id: "search", key: "Mod-k" },
  { id: "search", key: "Mod-f" },
  { id: "previousNote", key: "Alt-ArrowUp" },
  { id: "nextNote", key: "Alt-ArrowDown" },
  { id: "previousNote", key: "Ctrl-Shift-Tab" },
  { id: "nextNote", key: "Ctrl-Tab" },
  { id: "historyBack", key: "Mod-[" },
  { id: "historyForward", key: "Mod-]" },
  { id: "save", key: "Mod-s" },
  { id: "settings", key: "Mod-," },
  { id: "help", key: "Mod-/" },
];

export const isMacPlatform =
  typeof navigator !== "undefined" && /Mac|iPad|iPhone/.test(navigator.platform);

export function shortcutLabel(key: string, mac: boolean): string {
  if (!mac && key === "Mod-[") return "Alt ←";
  if (!mac && key === "Mod-]") return "Alt →";
  const keys: Record<string, string> = {
    Mod: mac ? "⌘" : "Ctrl",
    Alt: mac ? "⌥" : "Alt",
    Shift: mac ? "⇧" : "Shift",
    Ctrl: mac ? "⌃" : "Ctrl",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Enter: "↵",
  };
  return key
    .split("-")
    .map((part) => keys[part] ?? part.toUpperCase())
    .join(" ");
}
