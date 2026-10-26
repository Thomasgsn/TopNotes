import { invoke, isTauri } from "@tauri-apps/api/core";
import { noteText } from "./editor/markdown.ts";
import { isPersistedNote } from "./persistence.ts";
import { isNoteTag, tagName } from "./tags.ts";
import type { Note, NoteTag } from "./types";

const EXPORT_FORMAT = "topnotes-export";
const EXPORT_VERSION = 1;
const MAX_FILE_NAME_LENGTH = 80;
// Characters refused by macOS, Windows or Markdown tools in file names.
const UNSAFE_FILE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]+/g;

export interface ExportFile {
  name: string;
  content: string;
}

export interface ImportedData {
  notes: Note[];
  tags: NoteTag[];
}

type Translate = (key: string) => string;

export function buildJsonExport(notes: readonly Note[], tags: readonly NoteTag[]): ExportFile {
  const data = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    tags,
  };
  return { name: "topnotes.json", content: JSON.stringify(data, null, 2) };
}

export function parseJsonImport(text: string): ImportedData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const candidate = (data ?? {}) as {
    format?: unknown;
    version?: unknown;
    notes?: unknown;
    tags?: unknown;
  };
  if (candidate.format !== EXPORT_FORMAT) throw new Error("The file is not a TopNotes export.");
  if (candidate.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported TopNotes export version ${String(candidate.version)}.`);
  }
  return {
    notes: Array.isArray(candidate.notes) ? candidate.notes.filter(isPersistedNote) : [],
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter(isNoteTag) : [],
  };
}

function fileBaseName(title: string, translate: Translate): string {
  const cleaned = title
    .replace(UNSAFE_FILE_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  return cleaned || translate("app.untitled");
}

// One Markdown file per note outside the trash, with its metadata as front matter.
export function buildMarkdownExport(
  notes: readonly Note[],
  tags: readonly NoteTag[],
  translate: Translate,
): ExportFile[] {
  const usedNames = new Set<string>();
  return notes
    .filter((note) => !note.trashed)
    .map((note) => {
      const baseName = fileBaseName(note.title, translate);
      let name = `${baseName}.md`;
      // macOS file systems are case-insensitive.
      for (let index = 2; usedNames.has(name.toLocaleLowerCase()); index++) {
        name = `${baseName} ${index}.md`;
      }
      usedNames.add(name.toLocaleLowerCase());

      const tag = tags.find((candidate) => candidate.id === note.tag);
      const frontMatter = [
        `title: ${JSON.stringify(note.title || translate("app.untitled"))}`,
        ...(tag ? [`tag: ${JSON.stringify(tagName(tag, translate))}`] : []),
        `created: ${new Date(note.createdAt).toISOString()}`,
        `updated: ${new Date(note.updatedAt).toISOString()}`,
      ];
      const body = note.bodyFormat === "markdown" ? note.body : noteText(note);
      return { name, content: `---\n${frontMatter.join("\n")}\n---\n\n${body}\n` };
    });
}

function browserDownload(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Writes the files to a new folder in Downloads and returns its path (null in the browser preview). */
export async function saveExport(folderName: string, files: ExportFile[]): Promise<string | null> {
  if (isTauri()) return invoke<string>("export_files", { folderName, files });
  files.forEach(browserDownload);
  return null;
}

export function exportFolderName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `TopNotes ${day} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
