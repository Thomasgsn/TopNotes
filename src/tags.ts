import type { NoteTag } from "./types/TagId";

export function defaultTags(): NoteTag[] {
  return [
    { id: "work", name: "", color: "#c96864" },
    { id: "personal", name: "", color: "#78947b" },
    { id: "ideas", name: "", color: "#718aa1" },
  ];
}

export function tagName(tag: NoteTag, translate: (key: string) => string): string {
  return tag.name || translate(`tags.${tag.id}`);
}

export function isNoteTag(value: unknown): value is NoteTag {
  if (!value || typeof value !== "object") return false;
  const tag = value as Partial<NoteTag>;
  return (
    typeof tag.id === "string" &&
    tag.id.length > 0 &&
    typeof tag.name === "string" &&
    typeof tag.color === "string" &&
    /^#[\da-f]{6}$/i.test(tag.color)
  );
}

export type TagError = "emptyName" | "duplicateName";

export function validateTagName(
  name: string,
  tags: NoteTag[],
  translate: (key: string) => string,
  exceptId?: string,
): TagError | null {
  const normalized = name.trim().normalize("NFKC").toLocaleLowerCase();
  if (!normalized) return "emptyName";
  return tags.some(
    (tag) =>
      tag.id !== exceptId &&
      tagName(tag, translate).normalize("NFKC").toLocaleLowerCase() === normalized,
  )
    ? "duplicateName"
    : null;
}
