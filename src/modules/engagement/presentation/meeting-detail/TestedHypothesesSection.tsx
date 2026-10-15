"use client";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { paths } from "@/shared/lib/routes";
import { evidenceKindLabel } from "@/modules/engagement/domain/hypotheses";
import type {
  Hypothesis,
  MeetingHypothesisEvidence,
} from "@/modules/engagement/domain/models";

export type TestedHypothesis = MeetingHypothesisEvidence & {
  hypothesis: Hypothesis | undefined;
};

export function TestedHypothesesSection({
  company,
  tested,
}: {
  company: string;
  tested: TestedHypothesis[];
}) {
  return (
    <section aria-label="Hipóteses testadas">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Hipóteses testadas</h2>
        <Link
          href={paths.clientAgenda(company)}
          className="text-[12.5px] text-muted hover:text-ink"
        >
          Diagnóstico do cliente
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {tested.map((ev) => (
          <li
            key={`${ev.hypothesisId}-${ev.kind}`}
            className="flex items-start gap-3 px-4 py-3"
          >
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-relaxed">
                {ev.hypothesis?.statement ?? "Hipótese removida"}
              </span>
              {ev.note && (
                <span className="mt-0.5 block text-[12.5px] text-muted">
                  {ev.note}
                </span>
              )}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ring-1",
                ev.kind === "confirma"
                  ? "bg-ok-soft text-ok ring-ok/15"
                  : ev.kind === "contradiz"
                    ? "bg-rose-soft/60 text-rose ring-rose/15"
                    : "bg-soft text-ink-soft ring-line",
              )}
            >
              {evidenceKindLabel[ev.kind]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
