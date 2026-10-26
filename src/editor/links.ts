import type { Editor } from "@tiptap/core";
import { getMarkRange } from "@tiptap/core";

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
