"use client";
import { attachDocument } from "@/modules/documents/application/attachments";
import { attachmentRepository } from "@/modules/documents/infrastructure/attachments";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import type { Meeting, MeetingGoogle } from "@/modules/engagement/domain/models";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  fetchEventResponses,
  fetchMeetArtifacts,
} from "@/shared/infrastructure/google";
import { NOW } from "@/shared/lib/format";
import { executeOperation, meetingOperationBaseline, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";

const HOUR = 3_600_000;
type SyncAttempt<T> = {
  input: { meetingId: string };
  attempt: OperationAttempt;
  baseline: ReturnType<typeof meetingOperationBaseline>;
  inFlight?: Promise<T>;
};
type ArtifactResult = { note: string; google: MeetingGoogle };
// Page and background sync share an unresolved request, including after polling.
// Entries contain only request identity and version guards, never credentials.
const responseAttempts = new Map<string, SyncAttempt<MeetingGoogle>>();
const artifactAttempts = new Map<string, SyncAttempt<ArtifactResult>>();

export function meetingEndedAt(m: Meeting) {
  return new Date(m.startsAt).getTime() + m.durationMin * 60_000;
}

/** A meeting whose recording and transcript are still worth asking Google for. */
export { needsMeetArtifacts as needsArtifacts } from "@/modules/engagement/application/google-meet";

/** An upcoming meeting whose invitation answers may have changed. */
export function needsResponses(m: Meeting, sessionEmail: string | undefined, now = Date.now()) {
  const g = m.google;
  if (!g?.eventId || !sessionEmail) return false;
  if (g.organizer && g.organizer.toLowerCase() !== sessionEmail.toLowerCase()) return false;
  if (meetingEndedAt(m) < now - 24 * HOUR) return false;
  if (g.responsesAt && now - new Date(g.responsesAt).getTime() < 30 * 60_000) return false;
  return true;
}

/**
 * Pulls Google Meet artifacts and invitation answers into a meeting. Shared by
 * the meeting page (button) and the background sync (automatic).
 */
export function useMeetArtifacts() {
  const { updateMeeting } = useEngagementState();
  const { me } = useTeam();
  const { addDoc, addVersion, extraDocs, docEdits } = useDocumentsState();

  async function pullArtifacts(m: Meeting): Promise<{ note: string; google: MeetingGoogle }> {
    if (await usesRemoteOperations()) {
      const identity = `${(me.email ?? me.id).toLowerCase()}:${m.id}`;
      let pending = artifactAttempts.get(identity);
      if (!pending) {
        const input = { meetingId: m.id };
        pending = { input, attempt: operationAttempt("meetings.syncArtifacts", input), baseline: meetingOperationBaseline() };
        artifactAttempts.set(identity, pending);
      }
      if (pending.inFlight) return pending.inFlight;
      const captured = pending;
      captured.inFlight = (async () => {
        const result = await executeOperation<{ meeting: Meeting; note: string }>("meetings.syncArtifacts", captured.input, captured.attempt, captured.baseline);
        if (!result.data.meeting?.google || typeof result.data.note !== "string") throw new Error("Não foi possível confirmar os materiais da reunião. Tente novamente.");
        artifactAttempts.delete(identity);
        return { note: result.data.note, google: result.data.meeting.google };
      })().finally(() => { captured.inFlight = undefined; });
      return captured.inFlight;
    }
    const current = m.google ?? {};
    if (!current.meetLink) return { note: "Sem link do Meet.", google: current };
    const checkedAt = new Date().toISOString();
    const result = await fetchMeetArtifacts({ meetLink: current.meetLink, startsAt: m.startsAt, includeEarlierSessions: Date.parse(m.startsAt) > Date.now() });
    const endedAgo = Date.now() - meetingEndedAt(m);
    if (result.state === "not_found") {
      const google: MeetingGoogle = {
        ...current,
        lastArtifactCheckAt: checkedAt,
        artifactStatus: endedAgo > 7 * 24 * HOUR ? "not_generated" : "pending",
      };
      updateMeeting({ ...m, google }, null);
      return {
        note:
          google.artifactStatus === "not_generated"
            ? "Não encontramos registro deste encontro no Meet. Confira o link e a data da reunião."
            : "O Meet ainda não tem registro desta reunião. Se ela aconteceu, tente de novo em alguns minutos.",
        google,
      };
    }
    if (result.state === "pending" || !result.artifacts) {
      const google: MeetingGoogle = { ...current, lastArtifactCheckAt: checkedAt, artifactStatus: "pending" };
      updateMeeting({ ...m, google }, null);
      return { note: "A reunião ainda não terminou no Meet.", google };
    }
    const a = result.artifacts;
    const google: MeetingGoogle = {
      ...current,
      recordingUrl: a.recordings.find((r) => r.url)?.url ?? current.recordingUrl,
      transcriptUrl: a.transcripts.find((t) => t.url)?.url ?? current.transcriptUrl,
      syncedAt: checkedAt,
      lastArtifactCheckAt: checkedAt,
    };
    const previousRecord = extraDocs.find((doc) => doc.id === current.transcriptDocId);
    const previousDoc = previousRecord ? { ...previousRecord, ...docEdits[previousRecord.id] } : undefined;
    const previousText = a.transcriptText && current.transcriptDocId
      ? await attachmentRepository.get(current.transcriptDocId).then((file) => file?.text())
      : undefined;
    if (a.transcriptText && a.transcriptText !== previousText) {
      const id = "up-" + crypto.randomUUID();
      const file = new Blob([a.transcriptText], { type: "text/plain" });
      await attachDocument(
        attachmentRepository,
        {
          id,
          company: m.company,
          name: `Transcrição · ${m.title}.txt`,
          kind: "ata" as const,
          mime: "text/plain",
          size: file.size,
          uploadedAt: checkedAt,
          uploadedBy: me.id,
          relatedMeetingId: m.id,
          visibility: "interna" as const,
          note: "Transcrição gerada pelo Google Meet.",
        },
        file,
        (doc) => {
          if (previousDoc) addVersion(previousDoc, doc);
          else addDoc(doc);
          google.transcriptDocId = doc.id;
        },
      );
    }
    const found = Boolean(google.recordingUrl || google.transcriptUrl || google.transcriptDocId);
    google.artifactStatus = google.recordingUrl && google.transcriptDocId ? "ready" : endedAgo > 7 * 24 * HOUR ? (found ? "ready" : "not_generated") : "pending";
    updateMeeting({ ...m, google }, found ? "Materiais do Meet atualizados" : null);
    return {
      note: [
        a.startedAt ? `Sessão de ${new Date(a.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "",
        google.recordingUrl ? "Gravação encontrada." : "Sem gravação.",
        google.transcriptUrl || google.transcriptDocId ? "Transcrição encontrada." : "Sem transcrição.",
      ].join(" "),
      google,
    };
  }

  async function pullResponses(m: Meeting): Promise<MeetingGoogle> {
    if (await usesRemoteOperations()) {
      const identity = `${(me.email ?? me.id).toLowerCase()}:${m.id}`;
      let pending = responseAttempts.get(identity);
      if (!pending) {
        const input = { meetingId: m.id };
        pending = { input, attempt: operationAttempt("meetings.syncResponses", input), baseline: meetingOperationBaseline() };
        responseAttempts.set(identity, pending);
      }
      if (pending.inFlight) return pending.inFlight;
      const captured = pending;
      captured.inFlight = (async () => {
        const result = await executeOperation<{ meeting: Meeting }>("meetings.syncResponses", captured.input, captured.attempt, captured.baseline);
        if (!result.data.meeting?.google) throw new Error("Não foi possível confirmar as respostas dos convites. Tente novamente.");
        responseAttempts.delete(identity);
        return result.data.meeting.google;
      })().finally(() => { captured.inFlight = undefined; });
      return captured.inFlight;
    }
    const current = m.google ?? {};
    if (!current.eventId) return current;
    const result = await fetchEventResponses(current.eventId, current.calendarId);
    const google: MeetingGoogle = {
      ...current,
      responses: Object.fromEntries(result.attendees.map((a) => [a.email, a.responseStatus])),
      responsesAt: new Date().toISOString(),
      cancelled: result.status === "cancelled" || undefined,
    };
    updateMeeting({ ...m, google }, null);
    return google;
  }

  function resetResponses(m: Meeting) {
    const identity = `${(me.email ?? me.id).toLowerCase()}:${m.id}`;
    if (!responseAttempts.get(identity)?.inFlight) responseAttempts.delete(identity);
  }
  function resetArtifacts(m: Meeting) {
    const identity = `${(me.email ?? me.id).toLowerCase()}:${m.id}`;
    if (!artifactAttempts.get(identity)?.inFlight) artifactAttempts.delete(identity);
  }
  return { pullArtifacts, pullResponses, resetResponses, resetArtifacts, sessionEmail: me.email, now: NOW };
}
