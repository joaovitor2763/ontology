import { normalizeInteractionTags, interactionTagLabel, type InteractionTag } from "./interaction-tags.ts";
import type { NoteEdit, ThreadMessage } from "./models";

export type NotePatch = { at?: string; text?: string; title?: string; tags?: InteractionTag[] };

/**
 * Applies a correction to a note. The date ("when it happened"), the title and
 * the text can change; the moment the note was written never does, and every
 * change is appended to the note's history with who made it and when.
 */
export function editNote(
  note: ThreadMessage,
  patch: NotePatch,
  by: string,
  now: string,
): ThreadMessage {
  const edits: NoteEdit[] = [];
  if (patch.at && patch.at !== note.at)
    edits.push({ at: now, by, field: "at", from: note.at, to: patch.at });
  if (patch.title !== undefined && patch.title !== (note.title ?? ""))
    edits.push({ at: now, by, field: "title", from: note.title ?? "", to: patch.title });
  if (patch.text !== undefined && patch.text !== note.text)
    edits.push({ at: now, by, field: "text", from: note.text, to: patch.text });
  const tags = patch.tags === undefined ? note.tags : normalizeInteractionTags(patch.tags);
  const oldTags = normalizeInteractionTags(note.tags);
  if (patch.tags !== undefined && JSON.stringify(tags) !== JSON.stringify(oldTags))
    edits.push({ at: now, by, field: "tags", from: oldTags.map((tag) => interactionTagLabel[tag]).join(", "), to: tags!.map((tag) => interactionTagLabel[tag]).join(", ") });
  if (!edits.length) return note;
  return {
    ...note,
    ...(patch.tags !== undefined ? { tags } : {}),
    at: patch.at ?? note.at,
    title: patch.title !== undefined ? patch.title || undefined : note.title,
    text: patch.text ?? note.text,
    createdAt: note.createdAt ?? note.at,
    history: [...(note.history ?? []), ...edits],
  };
}
