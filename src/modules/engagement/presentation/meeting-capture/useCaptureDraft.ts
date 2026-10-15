"use client";
import { useRef, useState } from "react";
import {
  executeOperation,
  meetingOperationBaseline,
  operationAttempt,
  usesRemoteOperations,
} from "@/shared/infrastructure/operations";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  captureError,
  solutionError,
  withDecisionItems,
} from "@/modules/engagement/domain/diagnosis";
import { openHypothesisStatuses } from "@/modules/engagement/domain/hypotheses";
import type {
  Decision,
  Hypothesis,
  HypothesisEvidenceKind,
  Meeting,
  MeetingHypothesisEvidence,
  MeetingKind,
  Pain,
  Solution,
} from "@/modules/engagement/domain/models";
import { NOW, toDatetimeLocal } from "@/shared/lib/format";
import { STEPS, uid } from "./shared";

/** The whole draft of one capture: the five steps, their validation and the save. */
export function useCaptureDraft({
  defaultCompany,
  onClose,
}: {
  defaultCompany?: string;
  onClose: () => void;
}) {
  const { saveCapture, allPains, allHypotheses } = useEngagementState();
  const { active, me, resolve } = useTeam();
  const { clients } = useClientsState();
  const { forCompany } = useStakeholders();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const request = useRef<null | (() => Promise<void>)>(null);
  const baseline = useRef(meetingOperationBaseline());
  const meetingId = useState(() => uid("m"))[0];
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState(
    defaultCompany ?? clients[0]?.slug ?? "",
  );
  const [kind, setKind] = useState<MeetingKind>("alinhamento");
  const [when, setWhen] = useState(toDatetimeLocal(NOW));
  const [duration, setDuration] = useState(60);
  const [attendeeIds, setAttendees] = useState<string[]>([me.id]);
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [noNewPains, setNoNewPains] = useState(false);
  const [pains, setPains] = useState<Pain[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  /** Evidence this meeting gives to existing hypotheses, keyed by hypothesis id. */
  const [evidence, setEvidence] = useState<
    Record<string, { kind: HypothesisEvidenceKind; note: string }>
  >({});
  const [newHypotheses, setNewHypotheses] = useState<Hypothesis[]>([]);
  const existingHypotheses = allHypotheses.filter(
    (h) => h.company === company && openHypothesisStatuses.includes(h.status),
  );
  const attendees = [...active, ...forCompany(company).filter((s) => s.active)];
  const existingPains = allPains.filter(
    (p) => p.company === company && p.status !== "resolvida",
  );
  const linkablePains = [...pains, ...existingPains];

  function hypothesisEvidence(): MeetingHypothesisEvidence[] {
    return Object.entries(evidence)
      .filter(([, e]) => e.note.trim())
      .map(([hypothesisId, e]) => ({
        hypothesisId,
        kind: e.kind,
        note: e.note.trim(),
      }));
  }

  function meeting(): Meeting {
    const base: Meeting = {
      id: meetingId,
      company,
      title: title.trim(),
      kind,
      startsAt: new Date(when).toISOString(),
      durationMin: duration,
      attendeeIds: attendeeIds.filter((id) =>
        attendees.some((p) => p.id === id),
      ),
      summary:
        summary.trim() ||
        notes.trim().slice(0, 180) ||
        "Registro feito pela equipe.",
      notes: notes.trim(),
      decisions: [],
      hypothesisEvidence: hypothesisEvidence(),
      actions: decisions
        .filter((d) => d.nextStep?.trim())
        .map((d) => ({
          id: `${d.id}-a`,
          text: d.nextStep!.trim(),
          ownerId: d.ownerId ?? me.id,
          dueAt: d.dueAt ?? "",
        })),
    };
    return withDecisionItems(base, decisions);
  }

  function validate(target: number) {
    if (target >= 1 && !title.trim()) return "Dê um título à reunião.";
    if (target >= 2 && !noNewPains && pains.length === 0)
      return "Registre ao menos uma dor ou marque que nenhuma nova dor foi identificada.";
    if (target >= 2 && pains.some((p) => !p.title.trim()))
      return "Toda dor precisa de um título.";
    if (target >= 3 && newHypotheses.some((h) => h.statement.trim().length < 3))
      return "Toda hipótese nova precisa de um enunciado.";
    if (
      target >= 3 &&
      Object.values(evidence).some(
        (e) => e.note.trim() === "" && e.kind !== "confirma",
      )
    )
      return "Descreva a evidência das hipóteses marcadas ou desmarque-as.";
    if (target >= 4) {
      for (const s of solutions) {
        if (!s.title.trim()) return "Toda solução precisa de um título.";
        if (!s.painIds.length)
          return `Vincule a solução “${s.title}” a pelo menos uma dor.`;
        if (!s.hypothesis.trim())
          return `Escreva a hipótese da solução “${s.title}”: se fizermos X, esperamos Y porque Z.`;
      }
    }
    return null;
  }

  function go(next: number) {
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep(next);
  }

  async function finish() {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError("");
    try {
      if (!request.current) {
        const current = meeting();
        const problem =
          captureError({
            meeting: current,
            pains,
            solutions: [],
            decisions,
            noNewPains,
          }) ??
          solutions
            .map((solution) => solutionError(solution, linkablePains))
            .find(Boolean);
        if (problem) throw new Error(problem);
        const input = structuredClone({
          meeting: current,
          pains,
          solutions,
          noNewPains,
          hypotheses: newHypotheses.map((h) => ({
            ...h,
            statement: h.statement.trim(),
            painIds: h.painIds.filter((id) =>
              linkablePains.some((p) => p.id === id),
            ),
          })),
        });
        const attempt = operationAttempt("meetings.capture", input);
        request.current = async () => {
          if (await usesRemoteOperations())
            await executeOperation(
              "meetings.capture",
              input,
              attempt,
              baseline.current,
            );
          else saveCapture(input);
        };
        setPending(true);
      }
      await request.current();
      request.current = null;
      setPending(false);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível confirmar a reunião.",
      );
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  function review() {
    request.current = null;
    baseline.current = meetingOperationBaseline();
    setPending(false);
    setError("");
  }

  const personName = (id: string) =>
    attendees.find((p) => p.id === id)?.name ?? resolve(id).name;

  return {
    steps: STEPS,
    step,
    go,
    error,
    saving,
    pending,
    finish,
    review,
    locked,
    meetingId,
    me,
    active,
    clients,
    attendees,
    existingPains,
    existingHypotheses,
    linkablePains,
    hypothesisEvidence,
    personName,
    title,
    setTitle,
    company,
    setCompany,
    kind,
    setKind,
    when,
    setWhen,
    duration,
    setDuration,
    attendeeIds,
    setAttendees,
    summary,
    setSummary,
    notes,
    setNotes,
    noNewPains,
    setNoNewPains,
    pains,
    setPains,
    solutions,
    setSolutions,
    decisions,
    setDecisions,
    evidence,
    setEvidence,
    newHypotheses,
    setNewHypotheses,
  };
}

export type CaptureDraft = ReturnType<typeof useCaptureDraft>;
