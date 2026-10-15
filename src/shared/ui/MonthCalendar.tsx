"use client";
import {
  dateFull,
  dayMonthLong,
  monthYearLong,
  toDate,
  weekdayDateLong,
} from "@/shared/lib/dates";

import { cn } from "@/shared/lib/cn";
import { NOW } from "@/shared/lib/format";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export type CalItem = {
  id: string;
  title: string;
  startsAt: string;
  href?: string;
  onSelect?: () => void;
  kicker?: string;
  tint?: string;
};

const WEEK = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function MonthCalendar({ items }: { items: CalItem[] }) {
  const now = new Date(NOW);
  const [cursor, setCursor] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [pick, setPick] = useState(ymd(now));

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    const monday = (first.getDay() + 6) % 7;
    start.setDate(1 - monday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    items.forEach((it) => {
      const k = ymd(toDate(it.startsAt));
      map.set(k, [...(map.get(k) ?? []), it]);
    });
    return map;
  }, [items]);

  const selected = [...(byDay.get(pick) ?? [])].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  const label = monthYearLong(cursor);
  const today = ymd(now);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-soft"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 px-3 text-[14px] font-medium first-letter:uppercase">
          {label}
        </div>
        <button
          type="button"
          className="mr-2 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-soft"
          onClick={() => {
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setPick(today);
          }}
        >
          Hoje
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-soft"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-soft/50 text-center text-[11px] text-muted">
        {WEEK.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const list = byDay.get(key) ?? [];
          const on = pick === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              aria-label={`${dateFull(d)}: ${list.length} compromisso${list.length === 1 ? "" : "s"}`}
              onClick={() => setPick(key)}
              className={cn(
                "flex min-h-[58px] min-w-0 flex-col items-center border-b border-r border-line p-2 text-left transition-colors hover:bg-soft/70 sm:min-h-[96px] sm:items-stretch sm:p-3 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-soft/40 text-muted",
                on && "bg-soft ring-1 ring-inset ring-line-strong",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px]",
                  key === today && "bg-primary text-on-primary",
                )}
              >
                {d.getDate()}
              </span>
              <span
                className="mt-1 flex h-2 items-center justify-center gap-1 sm:hidden"
                aria-hidden="true"
              >
                {list.slice(0, 3).map((it) => (
                  <span
                    key={it.id}
                    className={cn(
                      "h-1 w-1 rounded-full",
                      !it.tint && "bg-ink-soft/60",
                    )}
                    style={it.tint ? { background: it.tint } : undefined}
                  />
                ))}
              </span>
              <div className="mt-2 hidden space-y-1 sm:block">
                {list.slice(0, 3).map((it) => (
                  <div
                    key={it.id}
                    className="flex min-w-0 items-center gap-1 rounded bg-soft px-1 py-0.5 text-[11px] leading-tight text-ink-soft"
                  >
                    {/* A cor do cliente vira um ponto: o texto fica legível no claro e no escuro. */}
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        !it.tint && "bg-ink-soft/60",
                      )}
                      style={it.tint ? { background: it.tint } : undefined}
                    />
                    <span className="truncate">{it.title}</span>
                  </div>
                ))}
                {list.length > 3 && (
                  <div className="px-1 text-[10px] text-muted">
                    +{list.length - 3}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <div className="flex items-start gap-3 border-t border-line p-5">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <div>
            <p className="text-[13px] font-medium">
              Nenhum compromisso em{" "}
              {dayMonthLong(toDate(pick))}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              Escolha uma data com eventos ou agende um novo encontro.
            </p>
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="border-t border-line p-5">
          <div className="text-[12px] text-muted">
            {weekdayDateLong(toDate(pick))}
          </div>
          <ul className="mt-4 space-y-3">
            {selected.map((it) => (
              <li key={it.id}>
                {it.onSelect ? (
                  <button
                    type="button"
                    onClick={it.onSelect}
                    className="block w-full rounded-xl border border-line px-4 py-3 text-left hover:border-line-strong"
                  >
                    <div className="text-[12px] text-muted">{it.kicker}</div>
                    <div className="mt-2 text-[14px] font-medium">
                      {it.title}
                    </div>
                  </button>
                ) : it.href ? (
                  <Link
                    href={it.href}
                    className="block rounded-xl border border-line px-4 py-3 hover:border-line-strong"
                  >
                    <div className="text-[12px] text-muted">{it.kicker}</div>
                    <div className="mt-2 text-[14px] font-medium leading-relaxed">
                      {it.title}
                    </div>
                  </Link>
                ) : (
                  <div className="rounded-xl border border-line px-3 py-2">
                    <div className="text-[12px] text-muted">{it.kicker}</div>
                    <div className="text-[14px] font-medium">{it.title}</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
