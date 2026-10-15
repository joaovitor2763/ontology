"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import Link from "next/link";
import { FileText } from "lucide-react";
import { docKindLabel } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ClientMark } from "@/modules/clients/presentation/ClientMark";
import { CoverageBadge } from "@/modules/knowledge/presentation/Coverage";
import { GooglePanel } from "./GooglePanel";
import { PrepPanel } from "./PrepPanel";
import { AttendeesPanel } from "./AttendeesPanel";
import type { useMeetingDetail } from "./useMeetingDetail";
import type { Meeting } from "@/modules/engagement/domain/models";

type Detail = Extract<ReturnType<typeof useMeetingDetail>, { meeting: Meeting }>;

export function MeetingSidebar({
  detail,
  onEdit,
}: {
  detail: Detail;
  onEdit: () => void;
}) {
  const {
    meeting,
    client,
    concepts,
    files,
    linkedCycle,
    linkedDelivery,
    prepItems,
    prepDone,
    prepHypotheses,
    upcoming,
    attendee,
    google,
    togglePrep,
  } = detail;
  return (
    <aside className="space-y-5 lg:sticky lg:top-8">
      {client && (
        <Link
          href={clientEntry(client.slug)}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-line-strong"
        >
          <ClientMark company={client} />
          <span className="min-w-0">
            <span className="block truncate text-input font-medium">
              {client.name}
            </span>
            <span className="text-[12.5px] text-muted">Abrir cliente</span>
          </span>
        </Link>
      )}
      <GooglePanel meeting={meeting} upcoming={upcoming} google={google} />
      {(linkedCycle || linkedDelivery) && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-[12px] uppercase tracking-wide text-muted">
            Vínculos
          </div>
          <ul className="mt-3 space-y-2 text-[13.5px]">
            {linkedCycle && (
              <li>
                <span className="block text-[11.5px] text-muted">Ciclo</span>
                <Link
                  href={paths.clientCycle(meeting.company, linkedCycle.id)}
                  className="font-medium hover:text-blue"
                >
                  {linkedCycle.name}
                </Link>
              </li>
            )}
            {linkedDelivery && (
              <li>
                <span className="block text-[11.5px] text-muted">Tarefa</span>
                <Link
                  href={paths.clientDelivery(meeting.company, linkedDelivery.id)}
                  className="font-medium hover:text-blue"
                >
                  {linkedDelivery.title}
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      <PrepPanel
        meeting={meeting}
        items={prepItems}
        done={prepDone}
        upcoming={upcoming}
        hypotheses={prepHypotheses}
        onToggle={togglePrep}
        onEdit={onEdit}
      />

      <AttendeesPanel
        meeting={meeting}
        attendee={attendee}
        tint={client?.tint}
        google={google}
      />

      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-[12px] uppercase tracking-wide text-muted">
            Documentos desta reunião
          </div>
          <Link
            href={paths.clientDocuments(meeting.company)}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            Todos os documentos
          </Link>
        </div>
        {files.length ? (
          <ul className="mt-3 space-y-1">
            {files.map((f) => (
              <li key={f.id}>
                <Link
                  href={paths.clientDocuments(meeting.company)}
                  className="flex items-center gap-2 rounded-xl px-1 py-2 text-[13.5px] hover:bg-soft"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {docKindLabel[f.kind]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-muted">
            Nenhum documento vinculado a esta reunião.
          </p>
        )}
      </div>

      {concepts.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-[12px] uppercase tracking-wide text-muted">
              Ontologia
            </div>
            <Link
              href={paths.clientOntology(meeting.company)}
              className="text-[12.5px] text-muted hover:text-ink"
            >
              Abrir mapa
            </Link>
          </div>
          <ul className="mt-3 space-y-1">
            {concepts.map((n) => (
              <li key={n.id}>
                <Link
                  href={paths.clientOntology(meeting.company, n.id)}
                  className="flex items-center justify-between gap-3 rounded-xl px-1 py-2 hover:bg-soft"
                >
                  <span className="text-[13.5px] font-medium">{n.label}</span>
                  <CoverageBadge value={n.coverage} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

export type MeetingDetailView = Detail;
