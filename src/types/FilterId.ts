import type { TagId } from "./TagId";

export type FilterId = "all" | "today" | "pinned" | "archive" | "trash" | `tag:${TagId}`;
