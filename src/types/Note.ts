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
  createdAt: number;
  updatedAt: number;
}
