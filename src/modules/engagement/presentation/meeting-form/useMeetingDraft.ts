"use client";
import { useEffect, useRef, useState } from "react";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  executeOperation,
  meetingOperationBaseline,
  operationAttempt,
  usesRemoteOperations,
  type OperationAttempt,
} from "@/shared/infrastructure/operations";
import { notify } from "@/shared/ui/Feedback";
import { meetingError, parseGuests } from "@/modules/engagement/domain/meetings";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { loadClientDeliveryCollection, type ClientDeliveryCollection } from "@/modules/delivery/infrastructure/client-collection";
import { useServices } from "@/modules/delivery/presentation/state";
import {
  createGoogleEvent,
  useGoogleStatus,
} from "@/shared/infrastructure/google";
import type { InteractionTag } from "@/modules/engagement/domain/interaction-tags";
import type {
  ActionItem,
  Meeting,
  MeetingKind,
  MeetingModality,
  MeetingPrep,
} from "@/modules/engagement/domain/models";
import { NOW, nextSlot, toDatetimeLocal, meetingLabel } from "@/shared/lib/format";
import { newMeetingId, plusDays, prepKinds } from "./shared";

/** The whole meeting form: its fields, what they derive and the save. */
export function useMeetingDraft({
  meeting,
  defaultCompany,
  defaultKind,
  onClose,
}: {
  meeting?: Meeting;
  defaultCompany?: string;
  defaultKind?: MeetingKind;
  onClose: () => void;
}) {
  const { addMeeting, updateMeeting, allHypotheses } = useEngagementState();
  const { active, me, resolve, session } = useTeam();
  const { clients } = useClientsState();
  const { forCompany } = useStakeholders();
  const { cycles } = useServices();
  const { statusMap, extraTasks, taskPatches } = useDeliveryState();
  const scoped = useScopedClientExecution();
  const scopedCompany = scoped?.company;
  const [requestId] = useState(() => meeting?.id ?? newMeetingId());
  const [tags, setTags] = useState<InteractionTag[]>(meeting?.tags ?? []);
  const [customTitle, setTitle] = useState<string | null>(meeting?.title ?? null);
  const [company, setCompany] = useState(
    meeting?.company ?? defaultCompany ?? clients[0]?.slug ?? "",
  );
  const [alternateExecution, setAlternateExecution] = useState<{
    company: string; collection: ClientDeliveryCollection;
  } | null>(null);
  const [executionError, setExecutionError] = useState<{ company: string; message: string } | null>(null);
  const [executionRetry, setExecutionRetry] = useState(0);
  const changeCompany = (value: string) => {
    if (value === company) return;
    setAlternateExecution(null);
    setExecutionError(null);
    setCompany(value);
  };
  useEffect(() => {
    if (!scopedCompany || !company || company === scopedCompany) return;
    const controller = new AbortController();
    void loadClientDeliveryCollection(company, { signal: controller.signal })
      .then((collection) => {
        if (controller.signal.aborted) return;
        setAlternateExecution({ company, collection });
        setExecutionError(null);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setExecutionError({ company, message: failure instanceof Error ? failure.message : "Não foi possível carregar as tarefas deste cliente." });
      });
    return () => controller.abort();
  }, [company, scopedCompany, executionRetry]);
  const [kind, setKind] = useState<MeetingKind>(
    meeting?.kind ?? defaultKind ?? "alinhamento",
  );
  const [when, setWhen] = useState(
    meeting ? toDatetimeLocal(meeting.startsAt) : nextSlot(),
  );
  const [duration, setDuration] = useState(meeting?.durationMin ?? 45);
  const [modality, setModality] = useState<MeetingModality>(
    meeting?.modality ?? "online",
  );
  const [place, setPlace] = useState(meeting?.place ?? "");
  const [cycleId, setCycleId] = useState(meeting?.cycleId ?? "");
  const [deliveryId, setDeliveryId] = useState(meeting?.deliveryId ?? "");
  const [guestsText, setGuestsText] = useState(
    (meeting?.guests ?? []).join("\n"),
  );
  const google = useGoogleStatus();
  const [onGoogle, setOnGoogle] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const pendingRequest = useRef<{
    command: "meetings.create" | "meetings.update" | "meetings.reschedule";
    input: unknown;
    attempt: OperationAttempt;
  } | null>(null);
  const [pendingOperation, setPendingOperation] = useState(false);
  const [operationBaseline] = useState(meetingOperationBaseline);
  const [attendeeIds, setAttendees] = useState<string[]>(
    meeting?.attendeeIds ?? [me.id],
  );
  const [summary, setSummary] = useState(meeting?.summary ?? "");
  const [notes, setNotes] = useState(meeting?.notes ?? "");
  const [decisions, setDecisionsState] = useState<string[]>(
    meeting?.decisions ?? [],
  );
  const [decisionDraft, setDecisionDraft] = useState("");
  const [actions, setActions] = useState<ActionItem[]>(meeting?.actions ?? []);
  const [actionDraft, setActionDraft] = useState<ActionItem>({
    id: "",
    text: "",
    ownerId: me.id,
    dueAt: plusDays(7),
  });
  const [prep, setPrep] = useState<MeetingPrep>(meeting?.prep ?? {});
  const [error, setError] = useState("");
  const attendees = [...active, ...forCompany(company).filter((s) => s.active)];
  const needsAlternate = Boolean(scoped && company !== scoped.company);
  const selectedExecution = needsAlternate && alternateExecution?.company === company
    ? alternateExecution.collection : null;
  const currentExecutionError = executionError?.company === company ? executionError.message : "";
  const executionLoading = needsAlternate && !selectedExecution && !currentExecutionError;
  const availableCycles = needsAlternate ? selectedExecution?.cycles ?? [] : cycles;
  const availableTasks = needsAlternate ? selectedExecution?.tasks ?? [] : deliveriesFor(
    company, statusMap, extraTasks, taskPatches,
  );
  const companyCycles = availableCycles
    .filter((c) => c.company === company)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const companyDeliveries = availableTasks
    .filter(
      (d) =>
        !cycleId ||
        companyCycles.find((c) => c.id === cycleId)?.taskIds.includes(d.id),
    )
    .filter((d) => d.status !== "entregue" || d.id === deliveryId);
  const hypotheses = allHypotheses.filter(
    (h) =>
      h.company === company &&
      (h.status === "aberta" ||
        h.status === "em-teste" ||
        h.status === "refinada"),
  );
  const hasPrep = prepKinds.includes(kind);
  const patchPrep = (patch: Partial<MeetingPrep>) =>
    setPrep((current) => ({ ...current, ...patch }));
  const future = when >= NOW.slice(0, 16);
  const editing = Boolean(meeting);
  const clientName = clients.find(client => client.slug === company)?.name;
  const title = customTitle ?? (!editing && future && clientName
    ? `${meetingLabel[kind]} · ${clientName}` : "");
  /** New, future meeting by a connected member: goes to their Google calendar with invitations. */
  const canSchedule = !editing && future && google.connected;
  const organizerEmail =
    meeting?.organizerEmail ??
    meeting?.google?.organizer ??
    session?.email ??
    me.email;

  function addDecision() {
    const value = decisionDraft.trim();
    if (!value) return;
    setDecisionsState((xs) => [...xs, value]);
    setDecisionDraft("");
  }
  function removeDecision(index: number) {
    setDecisionsState((xs) => xs.filter((_, j) => j !== index));
  }
  function addAction() {
    if (!actionDraft.text.trim()) return;
    setActions((xs) => [
      ...xs,
      {
        ...actionDraft,
        id: `${meeting?.id ?? "m"}-a-${Math.random().toString(36).slice(2, 8)}`,
        text: actionDraft.text.trim(),
      },
    ]);
    setActionDraft({ id: "", text: "", ownerId: me.id, dueAt: plusDays(7) });
  }
  function removeAction(id: string) {
    setActions((xs) => xs.filter((x) => x.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const next: Meeting = {
      ...(meeting ?? { id: requestId }),
      organizerEmail,
      company,
      tags,
      title: title.trim(),
      kind,
      startsAt: new Date(when).toISOString(),
      durationMin: duration,
      modality,
      place: place.trim() || undefined,
      cycleId: cycleId || undefined,
      deliveryId: deliveryId || undefined,
      guests: parseGuests(guestsText),
      attendeeIds: attendeeIds.filter((id) =>
        attendees.some((p) => p.id === id),
      ),
      summary:
        summary.trim() ||
        notes.trim().slice(0, 180) ||
        (future ? "Agendada." : "Registro feito pela equipe."),
      notes: notes.trim(),
      decisions,
      actions,
      relatedNodeIds: meeting?.relatedNodeIds,
      prep: hasPrep ? prep : meeting?.prep,
      createdAt: meeting?.createdAt,
    };
    const problem = meetingError(next);
    if (problem) {
      setError(problem);
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      if (await usesRemoteOperations()) {
        const patch = {
          ...next,
          cycleId: cycleId || "",
          deliveryId: deliveryId || "",
          place: place.trim(),
        };
        const calendarChanged =
          meeting &&
          [
            "title",
            "startsAt",
            "durationMin",
            "modality",
            "place",
            "attendeeIds",
            "guests",
            "summary",
            "notes",
          ].some(
            (field) =>
              JSON.stringify(next[field as keyof Meeting] ?? "") !==
              JSON.stringify(meeting[field as keyof Meeting] ?? ""),
          );
        const command = !meeting
          ? "meetings.create"
          : meeting.google?.eventId && calendarChanged
            ? "meetings.reschedule"
            : "meetings.update";
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "America/Sao_Paulo";
        const input = meeting
          ? { meetingId: meeting.id, patch, timeZone }
          : {
              meeting: next,
              sendInvites: Boolean(canSchedule && onGoogle),
              timeZone,
            };
        attempt.current = operationAttempt(command, input, attempt.current);
        const request = pendingRequest.current ?? {
          command,
          input,
          attempt: attempt.current,
        };
        const result = await executeOperation<{
          meeting: Meeting;
          operation: {
            id: string;
            status: string;
            error?: string | null;
          } | null;
        }>(
          request.command,
          request.input,
          request.attempt,
          meeting ? operationBaseline : undefined,
        );
        if (result.data.operation && result.data.operation.status !== "complete") {
          pendingRequest.current = request;
          setPendingOperation(true);
          setError(
            "A reunião foi registrada, mas a atualização no Google ainda não foi confirmada. Tente novamente para consultar o resultado.",
          );
          return;
        }
        notify(editing ? "Reunião atualizada" : "Reunião criada");
        onClose();
        return;
      }
      if (canSchedule && onGoogle) {
        setSaving(true);
        setError("");
        try {
          const emails = [
            ...attendees
              .filter((p) => next.attendeeIds.includes(p.id))
              .map((p) => (p as { email?: string }).email),
            ...(next.guests ?? []),
          ];
          const start = new Date(next.startsAt);
          const end = new Date(start.getTime() + next.durationMin * 60_000);
          const result = await createGoogleEvent({
            requestId: next.id,
            title: next.title,
            description: next.notes,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            timeZone:
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "America/Sao_Paulo",
            attendees: emails.filter((e): e is string => Boolean(e)),
            withMeet: next.modality !== "presencial",
          });
          next.organizerEmail = result.organizer;
          next.google = {
            calendarId: result.calendarId,
            eventId: result.eventId,
            htmlLink: result.htmlLink,
            meetLink: result.meetLink || undefined,
            organizer: result.organizer,
            autoRecording: result.autoRecording,
            recordingWarning: result.recordingWarning,
            syncedAt: new Date().toISOString(),
          };
          if (result.meetLink && !next.place) next.place = result.meetLink;
        } catch (failure) {
          setSaving(false);
          setError(
            failure instanceof Error
              ? `${failure.message} A reunião não foi salva; desmarque o agendamento no Google para salvar só aqui.`
              : "Não foi possível agendar no Google.",
          );
          return;
        }
        setSaving(false);
      }
      if (editing) updateMeeting(next);
      else addMeeting(next);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível salvar a reunião. Tente novamente.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const ownerName = (id: string) =>
    attendees.find((p) => p.id === id)?.name ?? resolve(id).name;

  return {
    meeting,
    submitting,
    submit,
    error,
    saving,
    pendingOperation,
    editing,
    future,
    hasPrep,
    canSchedule,
    google,
    onGoogle,
    setOnGoogle,
    organizerEmail,
    clients,
    attendees,
    companyCycles,
    companyDeliveries,
    executionLoading,
    executionError: needsAlternate ? currentExecutionError : "",
    retryExecution: () => { setExecutionError(null); setExecutionRetry((retry) => retry + 1); },
    hypotheses,
    tags,
    setTags,
    title,
    setTitle,
    company,
    setCompany: changeCompany,
    kind,
    setKind,
    when,
    setWhen,
    duration,
    setDuration,
    modality,
    setModality,
    place,
    setPlace,
    cycleId,
    setCycleId,
    deliveryId,
    setDeliveryId,
    guestsText,
    setGuestsText,
    attendeeIds,
    setAttendees,
    summary,
    setSummary,
    notes,
    setNotes,
    decisions,
    decisionDraft,
    setDecisionDraft,
    addDecision,
    removeDecision,
    actions,
    actionDraft,
    setActionDraft,
    addAction,
    removeAction,
    prep,
    patchPrep,
    ownerName,
  };
}

export type MeetingDraft = ReturnType<typeof useMeetingDraft>;
