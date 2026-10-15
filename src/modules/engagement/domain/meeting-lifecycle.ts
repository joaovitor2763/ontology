import type { Meeting } from "./models.ts";
import { withActionIds } from "./meetings.ts";

/** Derive legacy IDs before filtering so removing an earlier action never shifts identity. */
export function activeMeetingActions(meeting: Meeting) {
  return withActionIds(meeting).actions.filter(action => !action.removedAt);
}

export function removeMeetingAction(meeting: Meeting, actionId: string, by: string, at: string): Meeting {
  const normalized = withActionIds(meeting);
  const action = normalized.actions.find(action => action.id === actionId);
  if (!action) throw new Error("Ação não encontrada.");
  if (action.removedAt) return meeting;
  return { ...normalized, updatedAt: at, actions: normalized.actions.map(action => action.id === actionId ? { ...action, removedAt: at, removedBy: by } : action) };
}

/** Delivery identity, status and external data stay untouched; audit belongs to the command. */
export function restoreMeetingAction(meeting: Meeting, actionId: string, at: string): Meeting {
  const normalized = withActionIds(meeting);
  const action = normalized.actions.find(action => action.id === actionId);
  if (!action) throw new Error("Ação não encontrada.");
  if (!action.removedAt) return meeting;
  return { ...normalized, updatedAt: at, actions: normalized.actions.map(action => {
    if (action.id !== actionId) return action;
    const restored = { ...action };
    delete restored.removedAt;
    delete restored.removedBy;
    return restored;
  }) };
}
