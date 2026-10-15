"use client";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { AgendaEntry } from "@/modules/engagement/application/agenda";
import { paths } from "@/shared/lib/routes";
import { ActionMenu } from "@/shared/ui/Menu";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Clock,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { monthYearLong, timeOf, weekdayShort } from "@/shared/lib/dates";

const monthFormat = { format: monthYearLong };
const weekdayFormat = { format: (d: Date) => `${weekdayShort(d)}.` };
const timeFormat = { format: timeOf };

export function EventList({
  events,
  onOpenEvent,
  onEditEvent,
  onDeleteEvent,
}: {
  events: AgendaEntry[];
  onOpenEvent?: (event: AgendaEntry) => void;
  onEditEvent?: (event: AgendaEntry) => void;
  onDeleteEvent?: (event: AgendaEntry) => void;
}) {
  const months = new Map<
    string,
    {
      date: Date;
      days: Map<string, { date: Date; events: AgendaEntry[] }>;
    }
  >();
  for (const event of [...events].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  )) {
    const date = new Date(event.startsAt);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    const dayKey = `${monthKey}-${date.getDate()}`;
    if (!months.has(monthKey)) months.set(monthKey, { date, days: new Map() });
    const month = months.get(monthKey)!;
    if (!month.days.has(dayKey)) month.days.set(dayKey, { date, events: [] });
    month.days.get(dayKey)!.events.push(event);
  }

  if (!events.length)
    return (
      <div className="mt-4 rounded-xl border border-line px-5 py-12 text-center">
        <CalendarDays className="mx-auto mb-3 h-5 w-5 text-muted" />
        <p className="text-[13.5px] text-muted">
          Nenhum compromisso neste filtro.
        </p>
      </div>
    );

  return (
    <div className="mt-6 space-y-7">
      {[...months].map(([monthKey, month]) => (
        <section key={monthKey} aria-label={monthFormat.format(month.date)}>
          <h2 className="border-b border-line pb-3 text-[13px] font-medium first-letter:uppercase">
            {monthFormat.format(month.date)}
          </h2>
          <ol className="divide-y divide-line">
            {[...month.days].map(([dayKey, day]) => (
              <li
                key={dayKey}
                className="agenda-day grid grid-cols-[44px_minmax(0,1fr)] gap-2 py-2 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-4"
              >
                <div className="pt-3 sm:pl-1">
                  <span className="block text-[25px] font-medium leading-none tracking-tight tabular-nums">
                    {day.date.getDate()}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-muted">
                    {weekdayFormat.format(day.date)}
                  </span>
                </div>
                <ol className="min-w-0 divide-y divide-line/60">
                  {day.events.map((event) => (
                    <li key={event.id}>
                      <EventRow
                        event={event}
                        onOpenEvent={onOpenEvent}
                        onEditEvent={onEditEvent}
                        onDeleteEvent={onDeleteEvent}
                      />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventRow({
  event,
  onOpenEvent,
  onEditEvent,
  onDeleteEvent,
}: {
  event: AgendaEntry;
  onOpenEvent?: (event: AgendaEntry) => void;
  onEditEvent?: (event: AgendaEntry) => void;
  onDeleteEvent?: (event: AgendaEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { clientBySlug } = useClientsState();
  const company = clientBySlug(event.company);
  return (
    <details
      className="group rounded-lg open:bg-soft/40"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        role="button"
        aria-expanded={open}
        aria-controls={detailsId}
        className="agenda-event-summary grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] items-start gap-x-3 rounded-lg px-2 py-3 transition-colors hover:bg-soft/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted sm:grid-cols-[64px_minmax(0,1fr)_110px_16px] sm:gap-x-4 sm:px-3 [&::-webkit-details-marker]:hidden"
      >
        <time
          dateTime={event.startsAt}
          className="col-start-1 row-start-1 text-[13px] font-medium leading-5 tabular-nums"
        >
          {timeFormat.format(new Date(event.startsAt))}
        </time>
        <div className="col-start-1 mt-1 min-w-0 sm:col-start-2 sm:row-start-1 sm:mt-0">
          <h3 className="text-[14px] font-medium leading-5 tracking-tight [overflow-wrap:anywhere]">
            {event.title}
          </h3>
          <div className="mt-1 flex min-w-0 flex-col gap-x-3 gap-y-1 text-[12px] leading-5 text-muted sm:flex-row sm:flex-wrap">
            <span>{company?.name ?? event.company}</span>
            {event.place && (
              <span className="inline-flex min-w-0 items-start gap-1.5">
                <MapPin className="mt-1 h-3 w-3 shrink-0" />
                <span className="[overflow-wrap:anywhere]">{event.place}</span>
              </span>
            )}
            {event.meta && (
              <span className="inline-flex min-w-0 items-start gap-1.5">
                <Clock className="mt-1 h-3 w-3 shrink-0" />
                <span>{event.meta}</span>
              </span>
            )}
          </div>
          <span className="mt-1 inline-block text-[11px] text-muted sm:hidden">
            {event.kind}
          </span>
        </div>
        <span className="hidden sm:col-start-3 sm:row-start-1 justify-self-end rounded-md bg-soft px-2 py-0.5 text-[11px] leading-5 text-ink-soft sm:inline-block">
          {event.kind}
        </span>
        <ChevronDown className="col-start-2 row-start-1 mt-0.5 h-4 w-4 text-muted transition-transform group-open:rotate-180 sm:col-start-4" />
      </summary>
      <div id={detailsId} className="px-2 pb-4 pt-1 sm:pl-[92px] sm:pr-12">
        <p className="max-w-[760px] whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
          {event.detail || "Nenhuma observação para este compromisso."}
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          {event.meetingId ? (
            <Link
              href={paths.meeting(event.meetingId)}
              className="inline-flex min-h-8 items-center gap-1 text-[12px] text-muted hover:text-ink"
            >
              Abrir reunião
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            onOpenEvent && (
              <button
                type="button"
                onClick={() => onOpenEvent(event)}
                className="inline-flex min-h-8 items-center gap-1 text-[12px] text-muted hover:text-ink"
              >
                Detalhes do evento
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )
          )}
          <Link
            href={paths.clientAgenda(event.company)}
            className="inline-flex min-h-8 items-center gap-1 text-[12px] text-muted hover:text-ink"
          >
            Abrir cliente
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {!event.meetingId && (onEditEvent || onDeleteEvent) && (
            <ActionMenu
              label={`Ações de ${event.title}`}
              className="ml-auto"
              actions={[
                ...(onEditEvent
                  ? [
                      {
                        label: "Editar evento",
                        icon: <Pencil />,
                        onSelect: () => onEditEvent(event),
                      },
                    ]
                  : []),
                ...(onDeleteEvent
                  ? [
                      {
                        label: "Excluir evento",
                        icon: <Trash2 />,
                        tone: "danger" as const,
                        onSelect: () => onDeleteEvent(event),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
    </details>
  );
}
