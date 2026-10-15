"use client";
import type { RefObject } from "react";
import { Check } from "lucide-react";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import { milestoneByN } from "@/modules/catalog/infrastructure/journey";
import { cn } from "@/shared/lib/cn";
import { padMilestone } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";

type Summary = {
  n: number;
  name: string;
  stage: string;
  done: number;
  items: unknown[];
  closed: boolean;
  cycles: number;
};

/**
 * Compact rail of milestones grouped by stage. Names show while they fit
 * (up to eight milestones); with more, the rail keeps numbers and the
 * selected milestone's name lives in the header below. Sticks to the top
 * of the scroll area so the position in the plan never leaves the screen.
 */
export function MilestoneRail({
  journey,
  summaries,
  stages,
  open,
  currentMilestone,
  peek,
  setPeek,
  navigate,
  stepperRef,
  railWidth,
}: {
  journey: JourneyTemplate;
  summaries: Summary[];
  stages: string[];
  open: number;
  currentMilestone: number;
  peek: number | null;
  setPeek: (n: number | null) => void;
  navigate: (n: number) => void;
  stepperRef: RefObject<HTMLOListElement | null>;
  railWidth: number | null;
}) {
  const m = milestoneByN(open, journey);
  const labeled =
    journey.milestones.length <= 8 &&
    (railWidth == null || railWidth >= journey.milestones.length * 136);
  const shown = peek != null ? milestoneByN(peek, journey) : m;
  const shownN = peek ?? open;
  const shownSummary = summaries.find((item) => item.n === shownN);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <ol
        ref={stepperRef}
        aria-label="Marcos do plano"
        className={cn(
          "hidden overflow-x-auto sm:flex",
          labeled ? "px-2 py-2.5" : "px-2 py-2",
        )}
      >
        {stages.map((stage) => {
          const items = summaries.filter((item) => item.stage === stage);
          return (
            <li
              key={stage}
              className="flex min-w-0 flex-col"
              style={{
                flex: `${items.length} 1 0%`,
                minWidth: `${items.length * (labeled ? 132 : 48)}px`,
              }}
            >
              <span
                className="plan-rail-stage truncate px-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted"
                title={stage}
              >
                {stage}
              </span>
              <ol className="mt-1 flex">
                {items.map((item) => {
                  const on = item.n === open;
                  const isCurrent = item.n === currentMilestone;
                  const globalIndex = journey.milestones.findIndex(
                    (x) => x.n === item.n,
                  );
                  const last = globalIndex === journey.milestones.length - 1;
                  const meta = `${item.done}/${item.items.length} tarefas${
                    item.cycles
                      ? ` · ${item.cycles} ciclo${item.cycles === 1 ? "" : "s"}`
                      : ""
                  }`;
                  return (
                    <li
                      key={item.n}
                      className={cn(
                        "plan-rail-cell flex flex-1",
                        labeled ? "min-w-[132px]" : "min-w-[48px]",
                      )}
                    >
                      <button
                        type="button"
                        aria-current={on ? "step" : undefined}
                        aria-label={`${padMilestone(item.n)} · ${item.name}${isCurrent ? " · atual" : ""}`}
                        onMouseEnter={() => setPeek(item.n)}
                        onMouseLeave={() => setPeek(null)}
                        onFocus={() => setPeek(item.n)}
                        onBlur={() => setPeek(null)}
                        onClick={() => navigate(item.n)}
                        className={cn(
                          "group min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-soft/70",
                          on && "bg-soft",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                              item.closed
                                ? "bg-ok-soft text-ok"
                                : isCurrent
                                  ? "bg-ink text-on-ink"
                                  : on
                                    ? "border border-ink bg-surface text-ink"
                                    : "border border-line-strong bg-surface text-muted group-hover:border-ink",
                              on &&
                                !isCurrent &&
                                !item.closed &&
                                "ring-2 ring-ink/10",
                            )}
                          >
                            {item.closed ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              String(item.n).padStart(2, "0")
                            )}
                          </span>
                          {!last && (
                            <span
                              aria-hidden
                              className={cn(
                                "h-px flex-1",
                                item.closed ? "bg-ok/40" : "bg-line",
                              )}
                            />
                          )}
                        </span>
                        {labeled && (
                          <span className="plan-rail-label block">
                            <span
                              className={cn(
                                "mt-1.5 block truncate pr-1 text-[12px] font-medium leading-5",
                                !on && !isCurrent && "text-ink-soft",
                              )}
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            <span className="block truncate text-[10.5px] text-muted">
                              {isCurrent ? "Atual · " : ""}
                              {meta}
                            </span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
      <p
        data-always={!labeled && peek != null ? "" : undefined}
        className="plan-rail-name hidden items-center gap-2 border-t border-line px-3 text-[11.5px] text-muted sm:flex"
      >
        <span className="font-medium text-ink">{padMilestone(shownN)}</span>
        <span className="truncate text-ink">{shown.name}</span>
        <span className="truncate">· {shown.stage}</span>
        {shownSummary && (
          <span className="tabular-nums">
            · {shownSummary.done}/{shownSummary.items.length} tarefas
          </span>
        )}
        {shownN === currentMilestone && <span>· atual</span>}
      </p>
      <div className="p-3 sm:hidden">
        <Combobox
          label="Marco do plano"
          value={String(open)}
          onValueChange={(value) => navigate(Number(value))}
          className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink"
          options={journey.milestones.map((item) => ({
            value: String(item.n),
            label: `${padMilestone(item.n)} · ${item.name}${item.n === currentMilestone ? " · Atual" : ""}`,
            description: item.stage,
          }))}
        />
      </div>
    </div>
  );
}
