"use client";
import { Plus, Repeat2 } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { paths } from "@/shared/lib/routes";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";

type Milestone = JourneyTemplate["milestones"][number];

/** A milestone with no cycle and no delivery gets one block, not two stacked empties. */
export function UnplannedMilestone({
  companySlug,
  enrollmentId,
  open,
  past,
  milestone,
  onCreate,
}: {
  companySlug: string;
  enrollmentId: string | null;
  open: number;
  past: boolean;
  milestone: Milestone;
  onCreate: () => void;
}) {
  return (
    <section
      aria-label="Marco sem planejamento"
      className="rounded-xl border border-dashed border-line px-6 py-7"
    >
      <div className="mx-auto max-w-[560px] text-center">
        <p className="text-[15px] font-medium">
          {past
            ? "Este marco não tem registro"
            : "Este marco ainda não foi planejado"}
        </p>
        <p className="mt-1.5 text-[13px] leading-6 text-muted">
          {past
            ? "Ele ficou para trás sem ciclo nem tarefas. Registre o que aconteceu ou siga com o marco atual."
            : "Abra um ciclo para executá-lo: o ciclo define período, responsável, tarefas e aceite. Ou registre uma tarefa avulsa."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            href={
              paths.clientPlan(companySlug, "ciclos", open) +
              "&" +
              new URLSearchParams({
                contratacao: enrollmentId ?? "__legacy__",
              })
            }
          >
            <Repeat2 className="h-3.5 w-3.5" />
            Novo ciclo neste marco
          </Button>
          <Button variant="ghost" size="sm" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            Nova tarefa
          </Button>
        </div>
      </div>
      {milestone.tasks?.length ? (
        <div className="mx-auto mt-6 max-w-[560px] border-t border-line pt-4 text-left">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Tarefas de referência do plano · {milestone.tasks.length} ·{" "}
            {milestone.tasks.reduce((sum, task) => sum + task.hours, 0)} h
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            {milestone.tasks.slice(0, 8).map((task) => (
              <li
                key={task.title}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="truncate">{task.title}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {task.hours} h
                </span>
              </li>
            ))}
            {milestone.tasks.length > 8 && (
              <li className="text-muted">
                e mais {milestone.tasks.length - 8}…
              </li>
            )}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted">
            Entram como ponto de partida do novo ciclo.
          </p>
        </div>
      ) : null}
    </section>
  );
}
