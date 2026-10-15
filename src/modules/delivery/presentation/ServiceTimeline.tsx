"use client";
import { monthYearLong, weekdayShort } from "@/shared/lib/dates";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { ClientMark } from "@/modules/clients/presentation/ClientMark";
import type { Delivery } from "@/modules/delivery/domain/models";
import {
  cycleProgress,
  cycleStatusLabel,
  serviceDate,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { cn } from "@/shared/lib/cn";
import { NOW, formatDate } from "@/shared/lib/format";
import { calendarDay, cycleLanes, timelineSpan } from "@/shared/lib/time-axis";
import { Button } from "@/shared/ui/primitives";
import {
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Mesmas cores dos status de trabalho do DS (`statusColor`): fila, em curso, revisão, concluído. */
export const cycleColors = {
  planejado: "var(--ds-chart-6)",
  "em-curso": "var(--ds-blue)",
  "em-aceite": "var(--ds-accent)",
  concluido: "var(--ds-ok)",
};
export function ServiceTimeline({
  cycles,
  tasks,
  from,
  days,
  onDays,
  onMove,
  onToday,
  onSelect,
  ownerName,
}: {
  cycles: ServiceCycle[];
  tasks: Pick<Delivery, "id" | "company" | "status">[];
  from: Date;
  days: number;
  onDays: (days: number) => void;
  onMove: (direction: number) => void;
  onToday: () => void;
  onSelect: (id: string) => void;
  ownerName: (id: string) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current && scrollRef.current.clientWidth < 640)
      scrollRef.current.scrollLeft = 7 * 40;
  }, []);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fromKey = iso(from);
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = calendarDay(NOW) - calendarDay(fromKey);
  const todayVisible = today >= 0 && today < days;
  const within = cycles.filter((c) =>
    timelineSpan(c.startsAt, c.endsAt, fromKey, days),
  );
  const { clients: companies } = useClientsState();
  const groups = companies.filter((c) =>
    within.some((v) => v.company === c.slug),
  );
  const months = dates.reduce<
    { label: string; start: number; count: number }[]
  >((list, d, i) => {
    const label = monthYearLong(d);
    if (list.at(-1)?.label === label) list[list.length - 1].count++;
    else list.push({ label, start: i, count: 1 });
    return list;
  }, []);
  return (
    <section className="timeline-panel overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Período anterior"
            onClick={() => onMove(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-[15px] font-semibold first-letter:uppercase">
            {months.map((m) => m.label).join(" / ")}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Próximo período"
            onClick={() => onMove(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onToday();
              requestAnimationFrame(() => {
                if (scrollRef.current)
                  scrollRef.current.scrollLeft =
                    scrollRef.current.clientWidth < 640 ? 7 * 40 : 0;
              });
            }}
          >
            Hoje
          </Button>
          <div
            className="flex rounded-lg border border-line bg-soft p-1"
            aria-label="Escala do cronograma"
          >
            {[14, 28, 42].map((n) => (
              <button
                key={n}
                aria-label={`${n / 7} semanas`}
                aria-pressed={days === n}
                onClick={() => onDays(n)}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px]",
                  days === n
                    ? "bg-surface font-semibold text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {n / 7} <span className="sm:hidden">sem.</span>
                <span className="hidden sm:inline">semanas</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[min(65dvh,640px)] overflow-auto"
        tabIndex={0}
        role="region"
        aria-label="Linha do tempo dos ciclos. Role para explorar clientes e datas."
      >
        <div className="relative" style={{ minWidth: days * 40 }}>
          <div className="sticky top-0 z-10 border-b border-line bg-surface">
            <div className="relative h-8 bg-soft/45">
              {months.map((m) => (
                <span
                  key={m.label}
                  className="absolute top-2 truncate px-2 text-[10px] font-medium uppercase tracking-wider text-muted"
                  style={{
                    left: `${(m.start / days) * 100}%`,
                    width: `${(m.count / days) * 100}%`,
                  }}
                >
                  {m.count < 4 ? m.label.slice(0, 3) : m.label}
                </span>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${days},minmax(0,1fr))` }}
            >
              {dates.map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 border-r border-line/50 text-[11px] last:border-r-0",
                    [0, 6].includes(d.getDay()) && "bg-soft/65",
                  )}
                >
                  <span className="text-[10px] uppercase text-muted">
                    {weekdayShort(d)}
                  </span>
                  <span
                    aria-current={i === today ? "date" : undefined}
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-md font-medium",
                      i === today ? "bg-ink text-on-ink" : "text-ink-soft",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative min-h-48">
            <div
              className="pointer-events-none absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${days},minmax(0,1fr))` }}
            >
              {dates.map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "border-r border-line/45 last:border-0",
                    [0, 6].includes(d.getDay())
                      ? "bg-soft/75"
                      : "bg-surface",
                  )}
                />
              ))}
            </div>
            {todayVisible && (
              <div
                className="pointer-events-none absolute inset-y-0 z-[1] border-l border-ink/35"
                style={{ left: `${((today + 0.5) / days) * 100}%` }}
              >
                <span className="absolute -left-[3px] top-0 h-1.5 w-1.5 rounded-full bg-ink" />
              </div>
            )}
            {groups.map((company) => {
              const items = within.filter((c) => c.company === company.slug);
              const lanes = cycleLanes(items);
              const closed = collapsed.includes(company.slug);
              return (
                <div
                  key={company.slug}
                  className="relative border-b border-line/80 last:border-b-0"
                >
                  <div className="relative z-[2] flex h-11 items-center bg-surface/85 px-4">
                    <button
                      aria-expanded={!closed}
                      onClick={() =>
                        setCollapsed((v) =>
                          closed
                            ? v.filter((id) => id !== company.slug)
                            : [...v, company.slug],
                        )
                      }
                      className="sticky left-4 inline-flex items-center gap-2.5 text-[12px] font-medium"
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 text-muted transition-transform",
                          closed && "-rotate-90",
                        )}
                      />
                      <ClientMark company={company} className="h-5 w-5 rounded-md text-[10px] font-semibold" />
                      {company.name}
                      <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted">
                        {items.length}
                      </span>
                    </button>
                  </div>
                  {!closed && (
                    <div
                      className="relative"
                      style={{ height: lanes.length * 64 + 12 }}
                    >
                      {lanes.map((lane, index) =>
                        lane.map((c) => {
                          const span = timelineSpan(
                            c.startsAt,
                            c.endsAt,
                            fromKey,
                            days,
                          )!;
                          const progress = cycleProgress(c, tasks);
                          const late =
                            c.status !== "concluido" &&
                            serviceDate(c.endsAt) < serviceDate(NOW);
                          const color = late
                            ? "var(--ds-rose)"
                            : cycleColors[c.status];
                          const name = ownerName(c.ownerId);
                          return (
                            <button
                              key={c.id}
                              onClick={() => onSelect(c.id)}
                              aria-label={`Abrir ciclo ${c.name} · ${company.name}`}
                              title={`${c.name} · ${formatDate(c.startsAt)} a ${formatDate(c.endsAt)} · ${cycleStatusLabel[c.status]} · ${progress.percent}% concluído · ${name}`}
                              className="timeline-cycle absolute z-[2] overflow-hidden rounded-tile border border-line/65 bg-surface text-left transition-colors hover:z-[3] hover:border-line-strong focus-visible:z-[4]"
                              style={{
                                left: `calc(${span.left}% + 3px)`,
                                width: `calc(${span.width}% - 6px)`,
                                top: index * 64 + 6,
                                height: 46,
                              }}
                            >
                              <div className="flex h-full min-w-0 items-center gap-2.5 px-3">
                                <span className="shrink-0 text-muted">
                                  {c.status === "concluido" ? (
                                    <CheckCheck className="h-3.5 w-3.5" />
                                  ) : (
                                    <Clock3 className="h-3.5 w-3.5" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                  {c.name}
                                </span>
                                <span className="timeline-remaining shrink-0 rounded-full border border-line/70 bg-soft/25 px-2 py-0.5 text-[10px] text-muted">
                                  {progress.total - progress.done} pendentes
                                </span>
                                <span className="timeline-percent shrink-0 text-[11px] tabular-nums text-ink-soft">
                                  {progress.percent}%
                                </span>
                                <span className="timeline-progress h-1 w-12 shrink-0 overflow-hidden rounded-full bg-soft">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{
                                      width: `${progress.percent}%`,
                                      background: color,
                                    }}
                                  />
                                </span>
                              </div>
                            </button>
                          );
                        }),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!within.length && (
              <p className="relative p-8 text-[13px] text-muted">
                Nenhum ciclo neste período. Navegue pelas datas ou volte para
                hoje.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-soft/30 px-5 py-3 text-[10px] text-muted">
        {Object.entries(cycleStatusLabel).map(([id, label]) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: cycleColors[id as ServiceCycle["status"]] }}
            />
            {label}
          </span>
        ))}
        <span className="ml-auto">
          {within.length} ciclos neste período · Clique para ver tarefas e
          aceite
        </span>
      </div>
    </section>
  );
}
