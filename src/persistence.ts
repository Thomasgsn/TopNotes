import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppLocale } from "./i18n";
import { isNoteTag } from "./tags.ts";
import type { Note, NoteTag } from "./types";

const SCHEMA_VERSION = 1;
const DATA_STORAGE_KEY = "topnotes.data.v1";

const LEGACY_NOTES_STORAGE_KEY = "topnotes.notes.v1";
const LEGACY_LOCALE_STORAGE_KEY = "topnotes.locale";
const LEGACY_ALWAYS_ON_TOP_STORAGE_KEY = "topnotes.alwaysOnTop";
const LEGACY_AUTOSTART_INITIALIZED_KEY = "topnotes.autostart.initialized";

const legacyStorageKeys = [
  LEGACY_NOTES_STORAGE_KEY,
  LEGACY_LOCALE_STORAGE_KEY,
  LEGACY_ALWAYS_ON_TOP_STORAGE_KEY,
  LEGACY_AUTOSTART_INITIALIZED_KEY,
] as const;

const validLocales = new Set<AppLocale>(["fr", "en", "it", "es", "de"]);

export interface PersistedSettings {
  locale: AppLocale;
  alwaysOnTop: boolean;
  autostartInitialized: boolean;
}

export interface PersistedAppData {
  schemaVersion: number;
  notes: Note[] | null;
  tags: NoteTag[] | null;
  settings: PersistedSettings | null;
}

export interface Persistence {
  load(): Promise<PersistedAppData>;
  saveNotes(notes: Note[], tags?: NoteTag[]): Promise<void>;
  saveSettings(settings: PersistedSettings): Promise<void>;
}

function emptyAppData(): PersistedAppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    notes: null,
    tags: null,
    settings: null,
  };
}

function browserLocale(): AppLocale {
  const language = typeof navigator === "undefined" ? "en" : navigator.language;
  const shortLanguage = language.toLowerCase().split("-")[0] as AppLocale;
  return validLocales.has(shortLanguage) ? shortLanguage : "en";
}

export function isPersistedNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Note>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    (candidate.tag === null || typeof candidate.tag === "string") &&
    (candidate.bodyFormat === undefined || candidate.bodyFormat === "markdown") &&
    typeof candidate.pinned === "boolean" &&
    typeof candidate.archived === "boolean" &&
    typeof candidate.trashed === "boolean" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

function normalizeSettings(value: unknown): PersistedSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedSettings>;
  if (
    !validLocales.has(candidate.locale as AppLocale) ||
    typeof candidate.alwaysOnTop !== "boolean" ||
    typeof candidate.autostartInitialized !== "boolean"
  ) {
    return null;
  }

  return {
    locale: candidate.locale as AppLocale,
    alwaysOnTop: candidate.alwaysOnTop,
    autostartInitialized: candidate.autostartInitialized,
  };
}

function normalizeAppData(value: unknown): PersistedAppData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedAppData>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;

  const notes = candidate.notes;
  if (notes !== null && !Array.isArray(notes)) return null;
  const validNotes = notes === null ? null : notes.filter(isPersistedNote);
  const settings = candidate.settings === null ? null : normalizeSettings(candidate.settings);
  if (candidate.settings !== null && settings === null) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    notes: validNotes,
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter(isNoteTag) : null,
    settings,
  };
}

function loadLegacyData(): PersistedAppData | null {
  const notesValue = localStorage.getItem(LEGACY_NOTES_STORAGE_KEY);
  const localeValue = localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
  const alwaysOnTopValue = localStorage.getItem(LEGACY_ALWAYS_ON_TOP_STORAGE_KEY);
  const autostartValue = localStorage.getItem(LEGACY_AUTOSTART_INITIALIZED_KEY);

  let notes: Note[] | null = null;
  if (notesValue !== null) {
    try {
      const parsed = JSON.parse(notesValue) as unknown;
      if (Array.isArray(parsed)) notes = parsed.filter(isPersistedNote);
    } catch {
      // Keep the malformed legacy value until a successful migration.
    }
  }

  const locale = validLocales.has(localeValue as AppLocale) ? (localeValue as AppLocale) : null;
  const hasSettings = locale !== null || alwaysOnTopValue !== null || autostartValue !== null;
  const settings = hasSettings
    ? {
        locale: locale ?? browserLocale(),
        alwaysOnTop: alwaysOnTopValue === null ? true : alwaysOnTopValue === "true",
        autostartInitialized: autostartValue === "true",
      }
    : null;

  return notes === null && settings === null
    ? null
    : { schemaVersion: SCHEMA_VERSION, notes, tags: null, settings };
}

function clearLegacyData(): void {
  for (const key of legacyStorageKeys) localStorage.removeItem(key);
}

abstract class SerializedPersistence implements Persistence {
  protected data = emptyAppData();
  private writeQueue: Promise<void> = Promise.resolve();

  abstract load(): Promise<PersistedAppData>;

  saveNotes(notes: Note[], tags?: NoteTag[]): Promise<void> {
    const snapshot = notes.map((note) => ({ ...note }));
    const tagSnapshot = tags?.map((tag) => ({ ...tag }));
    return this.enqueue(async () => {
      await this.writeNotes(snapshot, tagSnapshot);
      this.data = { ...this.data, notes: snapshot, tags: tagSnapshot ?? this.data.tags };
    });
  }

  saveSettings(settings: PersistedSettings): Promise<void> {
    const snapshot = { ...settings };
    return this.enqueue(async () => {
      await this.writeSettings(snapshot);
      this.data = { ...this.data, settings: snapshot };
    });
  }

  protected abstract writeNotes(notes: Note[], tags?: NoteTag[]): Promise<void>;
  protected abstract writeSettings(settings: PersistedSettings): Promise<void>;

  private enqueue(write: () => Promise<void>): Promise<void> {
    const operation = this.writeQueue.then(write);
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}

class NativePersistence extends SerializedPersistence {
  async load(): Promise<PersistedAppData> {
    const loaded = normalizeAppData(await invoke<unknown>("load_app_data"));
    if (!loaded) throw new Error("The native persistence layer returned invalid app data.");
    this.data = loaded;

    const legacy = loadLegacyData();
    if (!legacy) return this.data;

    if (this.data.notes === null && legacy.notes !== null) await this.saveNotes(legacy.notes);
    if (this.data.settings === null && legacy.settings !== null) {
      await this.saveSettings(legacy.settings);
    }
    clearLegacyData();
    return this.data;
  }

  protected writeNotes(notes: Note[], tags?: NoteTag[]): Promise<void> {
    return invoke("save_notes", { notes, tags: tags ?? null });
  }

  protected writeSettings(settings: PersistedSettings): Promise<void> {
    return invoke("save_settings", { settings });
  }
}

class BrowserPersistence extends SerializedPersistence {
  async load(): Promise<PersistedAppData> {
    const storedValue = localStorage.getItem(DATA_STORAGE_KEY);
    if (storedValue !== null) {
      try {
        const stored = normalizeAppData(JSON.parse(storedValue) as unknown);
        if (stored) {
          this.data = stored;
          return this.data;
        }
      } catch {
        // The legacy data below remains the safest available recovery source.
      }
    }

    const legacy = loadLegacyData();
    if (legacy) {
      this.data = legacy;
      localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(this.data));
      clearLegacyData();
    }
    return this.data;
  }

  protected writeNotes(notes: Note[], tags?: NoteTag[]): Promise<void> {
    this.write({ ...this.data, notes, tags: tags ?? this.data.tags });
    return Promise.resolve();
  }

  protected writeSettings(settings: PersistedSettings): Promise<void> {
    this.write({ ...this.data, settings });
    return Promise.resolve();
  }

  private write(data: PersistedAppData): void {
    localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(data));
  }
}

export const appPersistence: Persistence = isTauri()
  ? new NativePersistence()
  : new BrowserPersistence();
