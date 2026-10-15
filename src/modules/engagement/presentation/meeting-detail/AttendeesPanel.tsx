"use client";
import { Avatar, Badge } from "@/shared/ui/primitives";
import { formatDateTime } from "@/shared/lib/format";
import { inviteResponseLabel } from "@/modules/engagement/domain/models";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingPerson } from "./useMeetingDetail";
import type { MeetingGoogleSync } from "./useMeetingGoogleSync";

export function AttendeesPanel({
  meeting,
  attendee,
  tint,
  google,
}: {
  meeting: Meeting;
  attendee: (id: string) => MeetingPerson;
  tint?: string;
  google: MeetingGoogleSync;
}) {
  /** Badge with the invitation answer of one e-mail, when the event lives in Google. */
  const responseOf = (email?: string) => {
    const status = email
      ? meeting.google?.responses?.[email.toLowerCase()]
      : undefined;
    if (!status) return null;
    const tone =
      status === "accepted"
        ? "ok"
        : status === "declined"
          ? "bad"
          : status === "tentative"
            ? "warn"
            : "neutral";
    return <Badge tone={tone}>{inviteResponseLabel[status]}</Badge>;
  };
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-[12px] uppercase tracking-wide text-muted">
        Presentes
      </div>
      <ul className="mt-4 space-y-5">
        {meeting.attendeeIds.map((aid) => {
          const p = attendee(aid);
          const answer = responseOf((p as { email?: string }).email);
          return (
            <li key={aid} className="flex items-center gap-3">
              <Avatar
                initials={p.initials}
                tint={p.org === "praxis" ? undefined : tint}
                size="md"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium leading-snug">
                  {p.name}
                </span>
                <span className="mt-1 block text-[12px] leading-relaxed text-muted">
                  {p.role}
                </span>
              </span>
              {answer}
            </li>
          );
        })}
        {(meeting.guests ?? []).map((email) => (
          <li key={email} className="flex items-center gap-3">
            <Avatar
              initials={email.slice(0, 2).toUpperCase()}
              tint="#8a8f98"
              size="md"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-snug">
                {email}
              </span>
              <span className="mt-1 block text-[12px] text-muted">
                Convidado externo
              </span>
            </span>
            {responseOf(email)}
          </li>
        ))}
        {meeting.google?.eventId && (
          <li className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11.5px] text-muted">
            <span>
              {meeting.google.responsesAt
                ? `Respostas lidas ${formatDateTime(meeting.google.responsesAt)}`
                : "Respostas do convite ainda não lidas"}
              {meeting.google.cancelled ? " · evento cancelado no Google" : ""}
            </span>
            <button
              type="button"
              onClick={() => void google.refreshResponses()}
              disabled={google.refreshingResponses || !google.status.connected}
              className="rounded-md px-1.5 py-0.5 hover:bg-soft hover:text-ink disabled:opacity-50"
            >
              {google.refreshingResponses
                ? "Atualizando…"
                : google.responsesError
                  ? "Verificar respostas"
                  : "Atualizar respostas"}
            </button>
            {google.responsesError && (
              <div className="w-full space-y-1">
                <p role="alert" className="text-rose">
                  {google.responsesError}
                </p>
                {!google.refreshingResponses && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      google.resetResponses(meeting);
                      google.clearResponsesError();
                    }}
                  >
                    Revisar sincronização
                  </button>
                )}
              </div>
            )}
          </li>
        )}
        {meeting.attendeeIds.length === 0 && !meeting.guests?.length && (
          <li className="text-[13px] text-muted">Sem presentes registrados.</li>
        )}
      </ul>
    </div>
  );
}
