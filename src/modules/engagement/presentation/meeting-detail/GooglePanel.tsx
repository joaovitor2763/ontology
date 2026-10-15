"use client";
import Link from "next/link";
import { Button } from "@/shared/ui/primitives";
import { paths } from "@/shared/lib/routes";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingGoogleSync } from "./useMeetingGoogleSync";

export function GooglePanel({
  meeting,
  upcoming,
  google,
}: {
  meeting: Meeting;
  upcoming: boolean;
  google: MeetingGoogleSync;
}) {
  const g = meeting.google;
  if (!g) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-[12px] uppercase tracking-wide text-muted">
        Google Agenda e Meet
      </div>
      <p className="mt-2 text-[13px] text-muted">
        Organizador: {meeting.organizerEmail ?? g.organizer ?? "Não informado"}
      </p>
      {g.recordingWarning && (
        <p role="status" className="mt-2 text-[13px] text-orange">
          {g.recordingWarning}
        </p>
      )}
      {g.autoRecording && (
        <p className="mt-2 text-[12px] text-muted">
          Gravação e transcrição automáticas ativadas no Meet.
        </p>
      )}
      <ul className="mt-3 space-y-2 text-[13.5px]">
        {g.htmlLink && (
          <li>
            <a
              href={g.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:text-blue"
            >
              Abrir no Google Agenda
            </a>
          </li>
        )}
        {g.meetLink && (
          <li>
            <a
              href={g.meetLink}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:text-blue"
            >
              Entrar no Meet
            </a>
            <span className="block text-[11.5px] text-muted">{g.meetLink}</span>
          </li>
        )}
        {g.recordingUrl && (
          <li>
            <a
              href={g.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:text-blue"
            >
              Gravação
            </a>
          </li>
        )}
        {g.transcriptUrl && (
          <li>
            <a
              href={g.transcriptUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:text-blue"
            >
              Transcrição no Google Docs
            </a>
          </li>
        )}
        {g.transcriptDocId && (
          <li>
            <Link
              href={paths.clientDocuments(meeting.company)}
              className="font-medium hover:text-blue"
            >
              Transcrição em Documentos
            </Link>
          </li>
        )}
      </ul>
      {g.meetLink && (
        <div className="mt-3">
          {upcoming && (
            <p className="mb-2 text-[12px] text-muted">
              Se você testou este link antes do horário agendado, busque os
              materiais da sessão antecipada.
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void google.pullArtifacts()}
            disabled={google.pulling || !google.status.connected}
            title={
              google.status.connected
                ? undefined
                : "Conecte sua conta Google no seu perfil"
            }
          >
            {google.pulling
              ? "Buscando…"
              : google.artifactFailed
                ? "Verificar materiais"
                : g.recordingUrl || g.transcriptUrl
                  ? "Atualizar gravação e transcrição"
                  : "Buscar gravação e transcrição"}
          </Button>
          {google.artifactNote && (
            <p
              role={google.artifactFailed ? "alert" : "status"}
              className={`mt-2 text-[12px] leading-relaxed ${google.artifactFailed ? "text-rose" : "text-muted"}`}
            >
              {google.artifactNote}
            </p>
          )}
          {google.artifactFailed && !google.pulling && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={() => {
                google.resetArtifacts(meeting);
                google.clearArtifactNote();
              }}
            >
              Revisar busca de materiais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
