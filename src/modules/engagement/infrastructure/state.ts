import type {
  CommunicationTemplate,
  Hypothesis,
  HypothesisEvidence,
  Meeting,
  Pain,
  ProgramEvent,
  Signal,
  Solution,
} from "@/modules/engagement/domain/models";
import { removeMeetingAction, restoreMeetingAction } from "../domain/meeting-lifecycle";
import { resolveSignalReview, reopenSignalReview, projectAllMeetings, removeMeetingSnapshot, restoreMeetingSnapshot, putMeetingSnapshot } from "./snapshot";
import { withActionIds } from "@/modules/engagement/domain/meetings";
import {
  communicationTemplates as seedTemplates,
  events as seedEvents,
  hypotheses as seedHypotheses,
  meetings as seedMeetings,
  pains as seedPains,
  solutions as seedSolutions,
} from "@/modules/engagement/infrastructure/seed";
import { migrateLegacy, migrateMeetingOrganizers } from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { type SetStateAction } from "react";

import { ENGAGEMENT_INITIAL as INITIAL, type EngagementSnapshot as StoredState, type SignalReview } from "./snapshot";
export type { EngagementSnapshot as StoredState, SignalReview } from "./snapshot";
const migrate = () => migrateLegacy(INITIAL, ["ontology.praxis.v1"]);
const stamp = () => new Date().toISOString();
type API = {
  storageError: string | null;
  extraMeetings: Meeting[];
  extraEvents: ProgramEvent[];
  notes: Record<string, string>;
  addMeeting: (m: Meeting) => void;
  updateMeeting: (m: Meeting, message?: string | null) => void;
  removeMeeting: (id: string) => void;
  lifecycle: (id: string, restore: boolean, by: string, actionId?: string) => void;
  meetingsIncludingRemoved: Meeting[];
  removedMeetingIds: string[];
  addEvent: (e: ProgramEvent) => void;
  updateEvent: (e: ProgramEvent) => void;
  removeEvent: (id: string) => void;
  restoreEvent: (id:string) => void;
  eventsIncludingRemoved: ProgramEvent[];
  setNotes: (id: string, notes: string) => void;
  /** Every meeting after edits and removals, newest first, actions with ids. */
  allMeetings: Meeting[];
  /** Every event after edits and removals, chronological. */
  allEvents: ProgramEvent[];
  allPains: Pain[];
  allSolutions: Solution[];
  savePain: (p: Pain, message?: string | null) => void;
  removePain: (id: string) => void;
  saveSolution: (s: Solution, message?: string | null) => void;
  removeSolution: (id: string) => void;
  allHypotheses: Hypothesis[];
  saveHypothesis: (h: Hypothesis, message?: string | null) => void;
  removeHypothesis: (id: string) => void;
  restoreHypothesis: (id: string) => void;
  /** Appends evidence to a hypothesis; the status stays whatever the team set. */
  addHypothesisEvidence: (
    hypothesisId: string,
    evidence: Omit<HypothesisEvidence, "id" | "at"> & Partial<Pick<HypothesisEvidence, "id" | "at">>,
    message?: string | null,
  ) => void;
  /** Saves a meeting with its pains, solutions and decisions in one go. */
  saveCapture: (input: {
    meeting: Meeting;
    pains: Pain[];
    solutions: Solution[];
    /** Hypotheses created or edited during the capture; evidence in `meeting.hypothesisEvidence` is appended to them. */
    hypotheses?: Hypothesis[];
  }) => void;
  signalReviews: Record<string, SignalReview>;
  signalClassifications: Record<string, Partial<Signal>>;
  resolveSignal: (id: string, by: string, deliveryId?: string) => void;
  reopenSignal: (id: string) => void;
  allTemplates: CommunicationTemplate[];
  saveTemplate: (t: CommunicationTemplate) => void;
};
export function useEngagementState(): API {
  const [stored, setStored, storageError] = useLocalStorageState(
    "ontology.engagement.v2",
    INITIAL,
    migrate,
  );
  const {
    extraMeetings,
    extraEvents,
    notes,
    meetingEdits,
    removedMeetings,
    eventEdits,
    removedEvents,
    extraPains,
    painEdits,
    removedPains,
    extraSolutions,
    solutionEdits,
    removedSolutions,
    signalReviews,
    signalClassifications,
    templateEdits,
    extraTemplates,
  } = migrateMeetingOrganizers(stored);
  const extraHypotheses = stored.extraHypotheses ?? [];
  const hypothesisEdits = stored.hypothesisEdits ?? {};
  const removedHypotheses = stored.removedHypotheses ?? [];
  function field<K extends keyof StoredState>(key: K) {
    return (action: SetStateAction<StoredState[K]>) =>
      setStored((previous) => ({
        ...previous,
        [key]:
          typeof action === "function"
            ? (action as (value: StoredState[K]) => StoredState[K])(
                previous[key],
              )
            : action,
      }));
  }
  const setExtra = field("extraMeetings");
  const setExtraEvents = field("extraEvents");
  const setNotesState = field("notes");
  const goneMeetings = new Set(removedMeetings);
  const goneEvents = new Set(removedEvents);
  const allMeetings = [
    ...extraMeetings,
    ...seedMeetings.map((m) => meetingEdits[m.id] ?? m),
  ]
    .filter((m) => !goneMeetings.has(m.id))
    .map(withActionIds)
    .sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt));
  const allEvents = [
    ...seedEvents.map((e) => eventEdits[e.id] ?? e),
    ...extraEvents,
  ]
    .filter((e) => !goneEvents.has(e.id))
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const gonePains = new Set(removedPains);
  const goneSolutions = new Set(removedSolutions);
  const allPains = [
    ...seedPains.map((p) => painEdits[p.id] ?? p),
    ...extraPains.map((p) => painEdits[p.id] ?? p),
  ].filter((p) => !gonePains.has(p.id));
  const allSolutions = [
    ...seedSolutions.map((s) => solutionEdits[s.id] ?? s),
    ...extraSolutions.map((s) => solutionEdits[s.id] ?? s),
  ].filter((s) => !goneSolutions.has(s.id));
  const goneHypotheses = new Set(removedHypotheses);
  const allHypotheses = [
    ...seedHypotheses.map((h) => hypothesisEdits[h.id] ?? h),
    ...extraHypotheses.map((h) => hypothesisEdits[h.id] ?? h),
  ].filter((h) => !goneHypotheses.has(h.id));
  const allTemplates = [
    ...seedTemplates.map((t) => templateEdits[t.id] ?? t),
    ...extraTemplates.map((t) => templateEdits[t.id] ?? t),
  ];

  const isSeedPain = (id: string) => seedPains.some((p) => p.id === id);
  const isSeedSolution = (id: string) => seedSolutions.some((s) => s.id === id);

  function putPain(s: StoredState, pain: Pain): StoredState {
    const next = { ...pain, updatedAt: stamp() };
    if (isSeedPain(pain.id) || s.extraPains.some((p) => p.id === pain.id))
      return { ...s, painEdits: { ...s.painEdits, [pain.id]: next } };
    return { ...s, extraPains: [...s.extraPains, next] };
  }
  function putSolution(s: StoredState, solution: Solution): StoredState {
    const next = { ...solution, updatedAt: stamp() };
    if (isSeedSolution(solution.id) || s.extraSolutions.some((x) => x.id === solution.id))
      return { ...s, solutionEdits: { ...s.solutionEdits, [solution.id]: next } };
    return { ...s, extraSolutions: [...s.extraSolutions, next] };
  }
  const isSeedHypothesis = (id: string) => seedHypotheses.some((h) => h.id === id);
  function putHypothesis(s: StoredState, h: Hypothesis): StoredState {
    const next = { ...h, evidence: h.evidence ?? [], updatedAt: stamp() };
    const extras = s.extraHypotheses ?? [];
    if (isSeedHypothesis(h.id) || extras.some((x) => x.id === h.id))
      return { ...s, hypothesisEdits: { ...(s.hypothesisEdits ?? {}), [h.id]: next } };
    return { ...s, extraHypotheses: [...extras, { ...next, createdAt: next.createdAt || stamp() }] };
  }
  function currentHypothesis(s: StoredState, id: string): Hypothesis | undefined {
    return (
      (s.hypothesisEdits ?? {})[id] ??
      (s.extraHypotheses ?? []).find((x) => x.id === id) ??
      seedHypotheses.find((x) => x.id === id)
    );
  }
  function appendEvidence(
    s: StoredState,
    hypothesisId: string,
    evidence: Omit<HypothesisEvidence, "id" | "at"> & Partial<Pick<HypothesisEvidence, "id" | "at">>,
  ): StoredState {
    const h = currentHypothesis(s, hypothesisId);
    if (!h) return s;
    const item: HypothesisEvidence = {
      ...evidence,
      id: evidence.id ?? `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: evidence.at ?? stamp(),
    };
    if (h.evidence?.some((e) => e.id === item.id)) return s;
    return putHypothesis(s, { ...h, evidence: [...(h.evidence ?? []), item] });
  }
  function putMeeting(s: StoredState, m: Meeting): StoredState {
    const next = { ...m, updatedAt: stamp() };
    if (seedMeetings.some((x) => x.id === m.id))
      return { ...s, meetingEdits: { ...s.meetingEdits, [m.id]: next } };
    if (s.extraMeetings.some((x) => x.id === m.id))
      return { ...s, extraMeetings: s.extraMeetings.map((x) => (x.id === m.id ? next : x)) };
    return {
      ...s,
      extraMeetings: [{ ...next, createdAt: next.createdAt ?? stamp() }, ...s.extraMeetings],
    };
  }

  const value: API = {
    storageError,
    extraMeetings,
    extraEvents,
    notes,
    addMeeting: (m) => {
      const now = stamp();
      setExtra((xs) => [{ ...m, createdAt: now, updatedAt: now }, ...xs]);
      notify("Reunião adicionada à agenda");
    },
    updateMeeting: (m, message = "Reunião atualizada") => {
      setStored((s) => putMeeting(s, m));
      if (message) notify(message);
    },
    removeMeeting: (id) => {
      setStored(s => { const m=projectAllMeetings(s).find(m=>m.id===id); return m?removeMeetingSnapshot(s,m,"local",stamp()):s; });
    },
    lifecycle: (id, restore, by, actionId) => {
      setStored(s => {
        const m=projectAllMeetings(s).find(m=>m.id===id);
        if(!m) throw new Error("Reunião não encontrada.");
        if(m.schedulingStatus==="pending"||m.schedulingStatus==="uncertain") throw new Error("Conclua a operação pendente da reunião.");
        const at=stamp();
        if(actionId) return putMeetingSnapshot(s,restore?restoreMeetingAction(m,actionId,at):removeMeetingAction(m,actionId,by,at));
        return restore?restoreMeetingSnapshot(s,m,by,at):removeMeetingSnapshot(s,m,by,at);
      });
    },
    meetingsIncludingRemoved: projectAllMeetings(stored),
    removedMeetingIds: removedMeetings,
    addEvent: (e) => {
      const now = stamp();
      setExtraEvents((xs) => [{ ...e, createdAt: now, updatedAt: now }, ...xs]);
      notify("Evento adicionado à agenda");
    },
    updateEvent: (e) => {
      const next = { ...e, updatedAt: stamp() };
      const isSeed = seedEvents.some((x) => x.id === e.id);
      if (isSeed)
        setStored((s) => ({
          ...s,
          eventEdits: { ...s.eventEdits, [e.id]: next },
        }));
      else setExtraEvents((xs) => xs.map((x) => (x.id === e.id ? next : x)));
      notify("Evento atualizado");
    },
    removeEvent: id => setStored(s=>({...s,removedEvents:s.removedEvents.includes(id)?s.removedEvents:[...s.removedEvents,id]})),
    restoreEvent: id => setStored(s=>({...s,removedEvents:s.removedEvents.filter(value=>value!==id)})),
    eventsIncludingRemoved:[...seedEvents.map(e=>eventEdits[e.id]??e),...extraEvents],
    setNotes: (id, n) => setNotesState((s) => ({ ...s, [id]: n })),
    allMeetings,
    allEvents,
    allPains,
    allSolutions,
    savePain: (pain, message = "Dor atualizada") => {
      setStored((s) => putPain(s, pain));
      if (message) notify(message);
    },
    removePain: (id) => {
      setStored((s) => ({
        ...s,
        removedPains: s.removedPains.includes(id) ? s.removedPains : [...s.removedPains, id],
      }));
      notify("Dor removida", () =>
        setStored((s) => ({ ...s, removedPains: s.removedPains.filter((x) => x !== id) })),
      );
    },
    saveSolution: (solution, message = "Solução atualizada") => {
      setStored((s) => putSolution(s, solution));
      if (message) notify(message);
    },
    removeSolution: (id) => {
      setStored((s) => ({
        ...s,
        removedSolutions: s.removedSolutions.includes(id)
          ? s.removedSolutions
          : [...s.removedSolutions, id],
      }));
      notify("Solução removida", () =>
        setStored((s) => ({
          ...s,
          removedSolutions: s.removedSolutions.filter((x) => x !== id),
        })),
      );
    },
    allHypotheses,
    saveHypothesis: (h, message = "Hipótese atualizada") => {
      setStored((s) => putHypothesis(s, h));
      if (message) notify(message);
    },
    restoreHypothesis: id => setStored(s=>({...s,removedHypotheses:(s.removedHypotheses??[]).filter(value=>value!==id)})),
    removeHypothesis: (id) => {
      setStored((s) => ({
        ...s,
        removedHypotheses: (s.removedHypotheses ?? []).includes(id)
          ? s.removedHypotheses
          : [...(s.removedHypotheses ?? []), id],
      }));
      notify("Hipótese removida", () =>
        setStored((s) => ({
          ...s,
          removedHypotheses: (s.removedHypotheses ?? []).filter((x) => x !== id),
        })),
      );
    },
    addHypothesisEvidence: (hypothesisId, evidence, message = "Evidência registrada") => {
      setStored((s) => appendEvidence(s, hypothesisId, evidence));
      if (message) notify(message);
    },
    saveCapture: ({ meeting, pains, solutions, hypotheses = [] }) => {
      setStored((s) => {
        let next = putMeeting(s, {
          ...meeting,
          painIds: pains.map((p) => p.id),
          solutionIds: solutions.map((x) => x.id),
        });
        for (const pain of pains) next = putPain(next, pain);
        for (const solution of solutions) next = putSolution(next, solution);
        for (const h of hypotheses) next = putHypothesis(next, h);
        for (const ev of meeting.hypothesisEvidence ?? [])
          next = appendEvidence(next, ev.hypothesisId, {
            id: `ev-${meeting.id}-${ev.hypothesisId}`,
            at: meeting.startsAt,
            kind: ev.kind,
            note: ev.note,
            meetingId: meeting.id,
            source: meeting.kind === "entrevista" ? "entrevista" : "observacao",
          });
        return next;
      });
      notify("Reunião registrada com dores, soluções e decisões");
    },
    signalReviews,
    signalClassifications,
    resolveSignal: (id, by, deliveryId) => {
      setStored(s=>({...s,signalReviews:{...s.signalReviews,[id]:resolveSignalReview(s.signalReviews[id],by,stamp(),deliveryId)}}));
      notify(deliveryId?"Tarefa criada a partir do sinal":"Sinal marcado como resolvido");
    },
    reopenSignal: id => {
      setStored(s=>{const review=reopenSignalReview(s.signalReviews[id],stamp());return review?{...s,signalReviews:{...s.signalReviews,[id]:review}}:s;});
      notify("Sinal reaberto");
    },
    allTemplates,
    saveTemplate: (t) => {
      setStored((s) =>
        seedTemplates.some((x) => x.id === t.id) || s.extraTemplates.some((x) => x.id === t.id)
          ? { ...s, templateEdits: { ...s.templateEdits, [t.id]: t } }
          : { ...s, extraTemplates: [...s.extraTemplates, t] },
      );
      notify("Modelo de mensagem salvo");
    },
  };
  return value;
}
