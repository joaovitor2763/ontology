"use client";
import { ArrowRight, Check, Flag, ListChecks, ShieldAlert } from "lucide-react";
import {
  isBlocked,
  journeyDate,
  type milestoneAdvance,
  type milestoneProgress,
} from "@/modules/catalog/domain/journey-progress";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import { milestoneByN } from "@/modules/catalog/infrastructure/journey";
import type { Delivery } from "@/modules/delivery/domain/models";
import { cn } from "@/shared/lib/cn";
import { padMilestone } from "@/shared/lib/format";
import { Button, Meter } from "@/shared/ui/primitives";

export function MilestoneAside({
  journey,
  milestone,
  currentMilestone,
  current,
  past,
  progress,
  advance,
  nextTask,
  nextLabel,
  resolve,
  onReview,
  onEditNext,
  navigate,
}: {
  journey: JourneyTemplate;
  milestone: JourneyTemplate["milestones"][number];
  currentMilestone: number;
  current: boolean;
  past: boolean;
  progress: ReturnType<typeof milestoneProgress>;
  advance: ReturnType<typeof milestoneAdvance>;
  nextTask: Delivery | undefined;
  nextLabel: string;
  resolve: (id: string) => { name: string };
  onReview: () => void;
  onEditNext: (task: Delivery) => void;
  navigate: (n: number) => void;
}) {
  const overdueIds = new Set(progress.overdue.map((task) => task.id));
  const pendingBlocked = advance.pending.filter(
    (task) => isBlocked(task) || overdueIds.has(task.id),
  );
  return (
    <aside
      aria-label="O que falta para avançar"
      className="plan-aside space-y-5 rounded-xl border border-line p-4 lg:sticky lg:top-[calc(var(--pinned-header-height,0px)+var(--sticky-top,0px))] lg:max-h-[calc(100dvh-var(--outer-header-height,0px)-var(--pinned-header-height,0px)-24px)] lg:overflow-y-auto"
    >
      <section aria-label="Avanço do marco">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
          {!current
            ? past
              ? "Marco anterior"
              : "Marco futuro"
            : advance.next
              ? "Para avançar"
              : "Para encerrar o plano"}
        </p>
        <p className="mt-1.5 text-[13.5px] font-medium leading-snug">
          {!current
            ? `O marco atual é ${padMilestone(currentMilestone)} · ${milestoneByN(currentMilestone, journey).name}`
            : advance.ready
              ? advance.next
                ? "Todas as tarefas foram concluídas."
                : "Todas as tarefas do plano foram concluídas."
              : advance.empty
                ? "Nenhuma tarefa planejada ainda."
                : `${advance.pending.length} tarefa${advance.pending.length === 1 ? " pendente" : "s pendentes"}${
                    pendingBlocked.length
                      ? ` · ${pendingBlocked.length} em atraso ou bloqueada${pendingBlocked.length === 1 ? "" : "s"}`
                      : ""
                  }`}
        </p>
        {progress.items.length > 0 && (
          <div className="mt-2">
            <Meter value={progress.percent} thick tone="accent" label="Progresso do marco" />
          </div>
        )}
        {current ? (
          <Button
            size="sm"
            variant={advance.ready ? "primary" : "ghost"}
            className="mt-3 w-full"
            onClick={onReview}
          >
            {advance.ready
              ? advance.next
                ? "Revisar e avançar"
                : "Revisar conclusão"
              : "Revisar pendências"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => navigate(currentMilestone)}
          >
            Ir para o marco atual
          </Button>
        )}
      </section>

      {nextTask && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5",
            isBlocked(nextTask)
              ? "border-rose/15 bg-rose-soft/20"
              : "border-line bg-soft/60",
          )}
        >
          <p
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em]",
              isBlocked(nextTask) ? "text-rose" : "text-blue",
            )}
          >
            {isBlocked(nextTask) ? (
              <ShieldAlert className="h-3 w-3" />
            ) : (
              <Flag className="h-3 w-3" />
            )}
            {nextLabel}
          </p>
          <button
            type="button"
            onClick={() => onEditNext(nextTask)}
            className="mt-1 block text-left text-[13px] font-medium hover:text-blue"
          >
            {nextTask.title}
          </button>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-5 text-muted">
            {isBlocked(nextTask) && nextTask.blockers
              ? nextTask.blockers
              : `${resolve(nextTask.ownerId).name} · ${journeyDate(nextTask.dueAt)}`}
          </p>
        </div>
      )}

      {milestone.exitCriteria?.length ? (
        <section
          aria-label="Critérios de saída"
          className="border-t border-line pt-4"
        >
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            <ListChecks className="h-3 w-3" /> Critérios de saída
          </p>
          <ul className="mt-2 space-y-1.5 text-[12.5px]">
            {milestone.exitCriteria.map((criterion) => (
              <li key={criterion} className="flex items-start gap-2 leading-5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 grid h-3 w-3 shrink-0 place-items-center rounded-sm border",
                    progress.complete
                      ? "border-ok bg-ok-soft text-ok"
                      : "border-line",
                  )}
                >
                  {progress.complete && <Check className="h-2.5 w-2.5" />}
                </span>
                {criterion}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {current && advance.next && (
        <section aria-label="Próximo marco" className="border-t border-line pt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Próximo marco
          </p>
          <button
            type="button"
            onClick={() => navigate(advance.next!.n)}
            className="mt-1 text-left text-[12.5px] leading-5 hover:text-blue"
          >
            {padMilestone(advance.next.n)} · {advance.next.name}
            <span className="block text-[11px] text-muted">
              {advance.next.stage}
            </span>
          </button>
        </section>
      )}
    </aside>
  );
}
