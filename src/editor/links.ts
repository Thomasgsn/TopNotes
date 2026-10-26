import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Editor } from "@tiptap/core";
import { getMarkRange } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

export interface LinkDraft {
  from: number;
  to: number;
  href: string;
  label: string;
}

export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const value = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname) return url.href;
    if (url.protocol === "mailto:" && url.pathname.includes("@")) return url.href;
  } catch {
    return null;
  }
  return null;
}

export function readLinkDraft(editor: Editor): LinkDraft {
  const { from, to, $from } = editor.state.selection;
  const link = getMarkRange($from, editor.schema.marks.link);
  const range = link && to <= link.to ? link : { from, to };
  return {
    ...range,
    href: editor.getAttributes("link").href ?? "",
    label: editor.state.doc.textBetween(range.from, range.to, " "),
  };
}

export function applyLink(editor: Editor, draft: LinkDraft, url: string, label: string): boolean {
  const href = normalizeLinkUrl(url);
  if (!href) return false;
  return editor
    .chain()
    .focus()
    .insertContentAt(
      { from: draft.from, to: draft.to },
      { type: "text", text: label.trim() || href, marks: [{ type: "link", attrs: { href } }] },
    )
    .run();
}

export function removeLink(editor: Editor, draft: LinkDraft): boolean {
  return editor
    .chain()
    .focus()
    .setTextSelection({ from: draft.from, to: draft.to })
    .unsetLink()
    .run();
}

// Returns the link address under a document position, only if it is safe to open.
export function linkHrefAt(state: EditorState, position: number): string | null {
  const marks = state.doc.nodeAt(position)?.marks ?? state.doc.resolve(position).marks();
  const link = marks.find((mark) => mark.type.name === "link");
  return link ? normalizeLinkUrl(String(link.attrs.href ?? "")) : null;
}

export function openExternalLink(href: string): void {
  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  void openUrl(href).catch((error: unknown) => {
    console.error("TopNotes could not open the link.", error);
  });
}
