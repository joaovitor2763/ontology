import type { Meeting } from "../domain/models.ts";
/**
 * Pure helpers around Google Calendar and Meet artifacts. The Worker talks to
 * Google; these functions decide what a meeting link, a conference record and
 * an exported artifact mean for a meeting of the platform.
 */
export type MeetArtifact = { name: string; state: string; url: string };

export type MeetArtifacts = {
  conferenceRecord: string;
  startedAt?: string;
  endedAt?: string;
  recordings: MeetArtifact[];
  transcripts: MeetArtifact[];
  /** "[time] speaker: text" lines, capped at 1 MB. */
  transcriptText: string;
};

/** `https://meet.google.com/abc-defg-hij` → `abc-defg-hij`. */
export function googleMeetCode(url: string): string | null {
  const match = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Export links only from Google's own hosts; anything else is dropped. */
export function artifactFromItem(
  item: Record<string, unknown>,
  destination: "driveDestination" | "docsDestination",
): MeetArtifact | null {
  const target = item[destination] as Record<string, unknown> | undefined;
  const url = String(target?.exportUri ?? "");
  const name = String(item.name ?? "");
  if (!name) return null;
  return {
    name,
    state: String(item.state ?? "").toUpperCase(),
    url: /^https:\/\/(drive|docs)\.google\.com\//.test(url) ? url : "",
  };
}

/** The conference record whose start is closest to the scheduled start. */
export function pickConferenceRecord<T extends { startTime?: string }>(
  records: T[],
  startsAt: string,
): T | undefined {
  const target = new Date(startsAt).getTime();
  return [...records]
    .filter((r) => r.startTime)
    .sort(
      (a, b) =>
        Math.abs(new Date(a.startTime!).getTime() - target) -
        Math.abs(new Date(b.startTime!).getTime() - target),
    )[0];
}

export type MeetParticipant = {
  name?: string;
  signedinUser?: { displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

export function transcriptText(
  entries: { participant?: string; text?: string; startTime?: string }[],
  maxBytes = 1_000_000,
  participants: MeetParticipant[] = [],
): string {
  const names = new Map(participants.map((p) => [p.name,
    (p.signedinUser?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || "").replace(/[\r\n]+/g, " ").trim(),
  ]));
  const unknown = new Map<string, string>();
  const lines: string[] = [];
  let size = 0;
  for (const entry of entries) {
    const text = String(entry.text ?? "").trim();
    if (!text) continue;
    const participant = entry.participant ?? "";
    if (!names.get(participant) && !unknown.has(participant))
      unknown.set(participant, `Participante ${unknown.size + 1} (nome indisponível)`);
    const who = names.get(participant) || unknown.get(participant);
    const stamp = entry.startTime ? `[${entry.startTime}] ` : "";
    const line = `${stamp}${who}: ${text}`;
    size += new TextEncoder().encode(line + "\n").byteLength;
    if (size > maxBytes) throw new Error("Transcrição muito extensa para importar integralmente. Consulte o documento no Google Docs.");
    lines.push(line);
  }
  return lines.join("\n");
}

/** Attendee list for the calendar event: unique, lower-case, organizer excluded. */
export function eventAttendees(emails: (string | undefined | null)[], organizer?: string) {
  const own = organizer?.trim().toLowerCase();
  return [
    ...new Set(
      emails
        .map((e) => (e ?? "").trim().toLowerCase())
        .filter((e) => e && e.includes("@") && e !== own),
    ),
  ].slice(0, 100);
}

/** Keep looking for BOTH artifacts, including meetings previously marked ready with only one. */
export function needsMeetArtifacts(m: Meeting, email: string | undefined, now = Date.now()) {
  const g = m.google;
  if (!g?.meetLink || !email) return false;
  if (g.organizer && g.organizer.toLowerCase() !== email.toLowerCase()) return false;
  const end = new Date(m.startsAt).getTime() + m.durationMin * 60_000;
  if (end > now || now - end > 7 * 24 * 3_600_000) return false;
  if (g.recordingUrl && g.transcriptDocId) return false;
  return !g.lastArtifactCheckAt || now - Date.parse(g.lastArtifactCheckAt) >= 3_600_000;
}
