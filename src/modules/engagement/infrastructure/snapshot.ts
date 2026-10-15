import type { CommunicationTemplate, Hypothesis, Meeting, Pain, ProgramEvent, Signal, Solution } from "../domain/models.ts";
import { withActionIds } from "../domain/meetings.ts";
import { meetings as seedMeetings } from "./seed.ts";
import { mergeLegacy, migrateMeetingOrganizers } from "../../../shared/infrastructure/migration.ts";
export type SignalReview = { by: string; at: string; deliveryId?: string; reopenedAt?: string };

export type EngagementSnapshot = {
  extraMeetings: Meeting[];
  extraEvents: ProgramEvent[];
  notes: Record<string, string>;
  /** Edits over seeded meetings, keyed by id. Created meetings are edited in place. */
  meetingEdits: Record<string, Meeting>;
  removedMeetings: string[];
  eventEdits: Record<string, ProgramEvent>;
  removedEvents: string[];
  /** Diagnosis: pains and solutions captured in meetings (seed + created), edits by id. */
  extraPains: Pain[];
  painEdits: Record<string, Pain>;
  removedPains: string[];
  extraSolutions: Solution[];
  solutionEdits: Record<string, Solution>;
  removedSolutions: string[];
  /** Hypotheses of the diagnosis (seed + created), edits by id. */
  extraHypotheses: Hypothesis[];
  hypothesisEdits: Record<string, Hypothesis>;
  removedHypotheses: string[];
  /** Signals marked as handled by a person, keyed by signal id. */
  signalReviews: Record<string, SignalReview>;
  /** Slot for AI classifications of signals, keyed by signal id. Empty until the gateway is on. */
  signalClassifications: Record<string, Partial<Signal>>;
  templateEdits: Record<string, CommunicationTemplate>;
  extraTemplates: CommunicationTemplate[];
};
export const ENGAGEMENT_INITIAL: EngagementSnapshot = {
  extraMeetings: [],
  extraEvents: [],
  notes: {},
  meetingEdits: {},
  removedMeetings: [],
  eventEdits: {},
  removedEvents: [],
  extraPains: [],
  painEdits: {},
  removedPains: [],
  extraSolutions: [],
  solutionEdits: {},
  removedSolutions: [],
  extraHypotheses: [],
  hypothesisEdits: {},
  removedHypotheses: [],
  signalReviews: {},
  signalClassifications: {},
  templateEdits: {},
  extraTemplates: [],
};

export function normalizeEngagementSnapshot(raw: Partial<EngagementSnapshot> = {}): EngagementSnapshot {
  return migrateMeetingOrganizers(mergeLegacy(ENGAGEMENT_INITIAL, [raw]));
}
export function projectMeetings(raw: Partial<EngagementSnapshot> = {}, options: { includeRemoved?: boolean } = {}): Meeting[] {
  const state = normalizeEngagementSnapshot(raw);
  return [...state.extraMeetings, ...seedMeetings.map(m => state.meetingEdits[m.id] ?? m)]
    .filter(m => options.includeRemoved || !state.removedMeetings.includes(m.id)).map(withActionIds)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}
export function putMeetingSnapshot(state: EngagementSnapshot, meeting: Meeting): EngagementSnapshot {
  if (seedMeetings.some(m => m.id === meeting.id)) return { ...state, meetingEdits: { ...state.meetingEdits, [meeting.id]: meeting } };
  return { ...state, extraMeetings: state.extraMeetings.some(m => m.id === meeting.id)
    ? state.extraMeetings.map(m => m.id === meeting.id ? meeting : m) : [meeting, ...state.extraMeetings] };
}

/** Tombstones preserve extra meetings and all task/Google links, just as seeds. */
export function removeMeetingSnapshot(state: EngagementSnapshot, meeting: Meeting, by: string, at: string): EngagementSnapshot {
  if (state.removedMeetings.includes(meeting.id)) return state;
  const next = putMeetingSnapshot(state, { ...withActionIds(meeting), removedAt: at, removedBy: by, updatedAt: at });
  return { ...next, removedMeetings: [...next.removedMeetings, meeting.id] };
}
/** Restoring visibility never clears cancellation or recreates external events. */
export function restoreMeetingSnapshot(state: EngagementSnapshot, meeting: Meeting, by: string, at: string): EngagementSnapshot {
  if (!state.removedMeetings.includes(meeting.id)) return state;
  const restored = { ...withActionIds(meeting), restoredAt: at, restoredBy: by, updatedAt: at };
  delete restored.removedAt;
  delete restored.removedBy;
  const next = putMeetingSnapshot(state, restored);
  return { ...next, removedMeetings: next.removedMeetings.filter(id => id !== meeting.id) };
}
/** Lifecycle queries include tombstoned records without changing normal lists. */
export function projectAllMeetings(raw: Partial<EngagementSnapshot> = {}): Meeting[] {
  return projectMeetings(raw, { includeRemoved: true });
}

/** Reopening preserves the resolution and linked task; old reviews remain resolved by default. */
export function reopenSignalReview(review:SignalReview|undefined,at:string):SignalReview|undefined {
  return review?{...review,reopenedAt:at}:undefined;
}
export function resolveSignalReview(previous:SignalReview|undefined,by:string,at:string,deliveryId?:string):SignalReview {
  return {by,at,...((previous?.deliveryId??deliveryId)?{deliveryId:previous?.deliveryId??deliveryId}:{})};
}

export function signalReviewState(review:SignalReview|undefined) {
  return {resolvedAt:review?.reopenedAt?undefined:review?.at,resolvedBy:review?.reopenedAt?undefined:review?.by,deliveryId:review?.deliveryId};
}
