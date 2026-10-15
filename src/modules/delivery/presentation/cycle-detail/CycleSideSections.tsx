"use client";
import Link from "next/link";
import { FileText, History, Video } from "lucide-react";
import { formatDateTime } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import {
  cycleStatusLabel,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { ClientDocument } from "@/modules/documents/domain/models";

export function CycleHistory({
  transitions,
  resolve,
}: {
  transitions: NonNullable<ServiceCycle["transitions"]>;
  resolve: (id: string) => { name: string };
}) {
  return (
    <section aria-label="Histórico do ciclo">
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium">
        <History className="h-3.5 w-3.5 text-muted" />
        Histórico
      </h3>
      {transitions.length ? (
        <ol className="relative ml-1.5 space-y-2 border-l border-line pl-4 text-[12.5px]">
          {transitions.map((t, i) => (
            <li key={`${t.at}-${i}`} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ink" />
              <span className="font-medium">{cycleStatusLabel[t.status]}</span>
              <span className="text-muted">
                {" "}
                · {formatDateTime(t.at)} · {resolve(t.by).name}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12px] text-muted">
          As mudanças de situação ficam registradas aqui.
        </p>
      )}
    </section>
  );
}

export function CycleMeetings({
  company,
  meetings,
}: {
  company: string;
  meetings: Meeting[];
}) {
  return (
    <section aria-label="Reuniões do período">
      <div className="mb-2 flex justify-between gap-3">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <Video className="h-3.5 w-3.5 text-muted" />
          Reuniões do período
        </h3>
        <Link
          className="shrink-0 text-[12px] text-muted hover:text-ink"
          href={paths.clientAgenda(company)}
        >
          Agenda
        </Link>
      </div>
      {meetings.map((m) => (
        <Link
          key={m.id}
          className="block border-t border-line py-2.5 text-[13px] hover:text-blue"
          href={paths.meeting(m.id)}
        >
          {m.title}
          <span className="mt-1 block text-[11px] text-muted">
            {formatDateTime(m.startsAt)}
          </span>
        </Link>
      ))}
      {!meetings.length && (
        <p className="text-[12px] text-muted">
          Nenhuma reunião registrada neste período.
        </p>
      )}
    </section>
  );
}

export function CycleDocs({
  company,
  docs,
}: {
  company: string;
  docs: ClientDocument[];
}) {
  return (
    <section aria-label="Documentos relacionados">
      <div className="mb-2 flex justify-between gap-3">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <FileText className="h-3.5 w-3.5 text-muted" />
          Documentos
        </h3>
        <Link
          href={paths.clientDocuments(company)}
          className="shrink-0 text-[12px] text-muted hover:text-ink"
        >
          Ver todos
        </Link>
      </div>
      {docs.map((d) => (
        <p key={d.id} className="border-t border-line py-2.5 text-[13px]">
          {d.name}
        </p>
      ))}
      {!docs.length && (
        <p className="text-[12px] text-muted">
          Anexe as evidências e documentos do cliente.
        </p>
      )}
    </section>
  );
}
