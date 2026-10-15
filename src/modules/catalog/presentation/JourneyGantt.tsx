"use client";
import { monthShort } from "@/shared/lib/dates";

import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { paths } from "@/shared/lib/routes";
import { NOW, formatDate, padMilestone } from "@/shared/lib/format";
import { Badge, HealthDot } from "@/shared/ui/primitives";
import Link from "next/link";

function monthsBetween(from: Date, to: Date) {
  const out: Date[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (d <= end) {
    out.push(new Date(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export function JourneyGantt({ journeyId }: { journeyId?: string }) {
  const { milestoneOf, journeyOf } = useCatalog();
  const { clients } = useClientsState();
  const now = new Date(NOW);
  const rows = clients.filter(
    (c) => !journeyId || journeyOf(c).id === journeyId,
  );
  const starts = rows.map((c) => new Date(`${c.startedAt}T12:00:00`).getTime());
  const ends = rows.map((c) => new Date(c.nextMilestoneAt).getTime());
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 90);
  const start = new Date(
    Math.min(...(starts.length ? starts : [now.getTime()]), now.getTime()),
  );
  start.setDate(1);
  const end = new Date(Math.max(...ends, horizon.getTime()));
  end.setMonth(end.getMonth() + 1, 1);
  const months = monthsBetween(start, end);
  const span = end.getTime() - start.getTime();

  function x(iso: string) {
    const t = new Date(iso).getTime();
    return Math.max(0, Math.min(100, ((t - start.getTime()) / span) * 100));
  }

  const nowX = x(now.toISOString());

  return (
    <>
      <section className="mt-8 lg:hidden">
        <h2 className="mb-4 text-[15px] font-medium">Clientes neste plano</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {rows.map((c) => {
            const { n, def } = milestoneOf(c);
            return (
              <li key={c.slug}>
                <Link
                  href={paths.clientPlan(c.slug)}
                  className="block px-4 py-3 hover:bg-soft/40"
                >
                  <div className="flex items-center gap-3 text-[14px] font-medium">
                    <HealthDot flag={c.healthFlag} />
                    <span className="min-w-0 flex-1">{c.name}</span>
                    <Badge>{padMilestone(n)}</Badge>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                    {def.name}
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    Próximo marco · {formatDate(c.nextMilestoneAt)}
                  </p>
                </Link>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="p-5 text-[13px] text-muted">
              Nenhum cliente neste plano.
            </li>
          )}
        </ul>
      </section>
      <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-line lg:block">
        <div className="min-w-[720px] p-5">
          <div
            className="relative mb-3 grid text-[11px] text-muted"
            style={{
              gridTemplateColumns: `160px repeat(${months.length}, minmax(0,1fr))`,
            }}
          >
            <div />
            {months.map((m) => (
              <div key={m.toISOString()} className="first-letter:uppercase">
                {monthShort(m)}.
              </div>
            ))}
          </div>
          <div className="relative space-y-3">
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-rose/40"
              style={{ left: `calc(160px + (100% - 160px) * ${nowX / 100})` }}
            />
            {rows.length === 0 && (
              <p className="py-6 text-[13px] text-muted">
                Nenhum cliente neste plano.
              </p>
            )}
            {rows.map((c) => {
              const { n, def } = milestoneOf(c);
              const left = x(c.startedAt);
              const right = x(c.nextMilestoneAt);
              const width = Math.max(4, right - left);
              return (
                <div
                  key={c.slug}
                  className="grid items-center gap-2"
                  style={{ gridTemplateColumns: "160px 1fr" }}
                >
                  <Link
                    href={paths.clientPlan(c.slug)}
                    className="flex min-w-0 items-center gap-2 text-[13px]"
                  >
                    <HealthDot flag={c.healthFlag} />
                    <span className="truncate font-medium">{c.name}</span>
                  </Link>
                  <div className="relative h-8 rounded-lg bg-soft">
                    <Link
                      href={paths.clientPlan(c.slug)}
                      className="absolute top-1 bottom-1 rounded-md"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: c.tint + "33",
                      }}
                      title={`${padMilestone(n)} · ${def.name}`}
                    >
                      <span
                        className="absolute inset-y-0 left-2 flex items-center truncate text-[11px] font-medium"
                        style={{ color: c.tint }}
                      >
                        {padMilestone(n)}
                      </span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-[12px] text-muted">
            Da entrada no contrato até o próximo marco previsto. A linha vermelha é hoje.
          </p>
        </div>
      </div>
    </>
  );
}
