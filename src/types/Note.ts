import type { TagId } from "./TagId";

export interface Note {
  id: string;
  title: string;
  body: string;
  bodyFormat?: "markdown";
  tag: TagId | null;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  // When the note was moved to the trash; optional in stored data.
  trashedAt?: number;
  createdAt: number;
  updatedAt: number;
}
