import type { Delivery } from "./models.ts";
import { plannedStart } from "./delivery-policy.ts";
/** Only these optional editor fields support an explicit clear (null in API input).
 * The stored marker survives JSON and overrides immutable seeded task values. */
/** Optional fields that editors may clear explicitly with null through the public API. */
export const editorClearableTaskFields = ["effortActual", "deliverable", "startsAt"] as const;
/** Stored clear markers also protect the server-owned completion date after reopening. */
export const clearableTaskFields = [...editorClearableTaskFields, "completedAt"] as const;
export type ClearableTaskField = typeof clearableTaskFields[number];
export type TaskOverride = Partial<Delivery> & {
  clearedFields?: ClearableTaskField[];
  /** Server-owned tombstone: history and document references keep their identity. */
  removed?: boolean;
  removedAt?: string;
  removedBy?: string;
};
export function mergeTaskOverride(previous: TaskOverride, patch: Partial<Delivery>): TaskOverride {
  const cleared = new Set(previous.clearedFields ?? []);
  for (const field of clearableTaskFields) if (Object.hasOwn(patch, field)) {
    if (patch[field] === undefined) cleared.add(field);
    else cleared.delete(field);
  }
  const next: TaskOverride = { ...previous, ...patch };
  if (cleared.size) next.clearedFields = [...cleared];
  else delete next.clearedFields;
  return next;
}
export function applyTaskOverride(record: Delivery, patch: TaskOverride = {}): Delivery {
  const { clearedFields, ...fields } = patch;
  const next = { ...record, ...fields };
  for (const field of clearedFields ?? []) if (fields[field] === undefined) delete next[field];
  // Lazy repair: legacy records (or a deadline moved before a fixed start) never show start > deadline.
  const startsAt = plannedStart(next.startsAt, next.dueAt);
  if (startsAt !== next.startsAt) next.startsAt = startsAt;
  return next;
}
