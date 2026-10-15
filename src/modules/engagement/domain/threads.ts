import type { Thread, ThreadMessage } from "./models.ts";

/** The last note written in a space, by the moment it records. */
export function latestNote(notes?: ThreadMessage[]) {
  if (!notes?.length) return undefined;
  return [...notes].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
}

/** How a space is named in the list and in the header. */
export function spaceTitle(t: Thread) {
  if (t.kind === "notes") return "Notas do cliente";
  if (t.kind === "call") return t.title;
  if (t.kind === "group") return t.title;
  return t.counterpart;
}
