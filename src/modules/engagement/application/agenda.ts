import { meetingLabel } from "../../../shared/lib/format.ts";
import type { Meeting, ProgramEvent } from "../domain/models";
export type AgendaEntry = ProgramEvent & {
  meetingId?: string;
  /** Duration and attendance for meetings; events keep `place` as location. */
  meta?: string;
};
/** Both scheduling entry points feed the same agenda, retaining their source identity. */
export function agendaEntries(
  events: ProgramEvent[],
  meetings: Meeting[],
): AgendaEntry[] {
  return [
    ...events.map((event) => ({ ...event, id: `event:${event.id}` })),
    ...meetings.map((meeting) => ({
      id: `meeting:${meeting.id}`,
      meetingId: meeting.id,
      company: meeting.company,
      title: meeting.title,
      kind: meetingLabel[meeting.kind] ?? "Reunião",
      startsAt: meeting.startsAt,
      place: "",
      meta: `${meeting.durationMin} min · ${meeting.attendeeIds.length} participante${meeting.attendeeIds.length === 1 ? "" : "s"}`,
      detail: meeting.summary || meeting.notes,
    })),
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
