"use client";
import { ArrowRight, Flag, Plus, Repeat2 } from "lucide-react";
import { journeyDate, type milestoneAdvance, type milestoneProgress } from "@/modules/catalog/domain/journey-progress";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import type { Company } from "@/modules/clients/domain/models";
import { cn } from "@/shared/lib/cn";
import { padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ActionMenu } from "@/shared/ui/Menu";
import { Button } from "@/shared/ui/primitives";

export function MilestoneOverview({
  company,
  journey,
  enrollmentId,
  milestone,
  open,
  state,
  outcome,
  progress,
  advance,
  unplanned,
  current,
  resolve,
  onReview,
  onCreate,
}: {
  company: Company;
  journey: JourneyTemplate;
  enrollmentId: string | null;
  milestone: JourneyTemplate["milestones"][number];
  open: number;
  state: { label: string; tone: string };
  outcome?: string;
  progress: ReturnType<typeof milestoneProgress>;
  advance: ReturnType<typeof milestoneAdvance>;
  unplanned: boolean;
  current: boolean;
  resolve: (id: string) => { name: string };
  onReview: () => void;
  onCreate: () => void;
}) {
  const m = milestone;
  return (
    <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 basis-[420px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-soft px-2 py-0.5 text-[11px] font-medium">
            {padMilestone(open)}
          </span>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[10.5px] font-medium",
              state.tone,
            )}
          >
            {state.label}
          </span>
          <span className="text-[11px] text-muted">{m.stage}</span>
        </div>
        <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight">
          {m.name}
        </h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-muted">
          {outcome ??
            `Organize as tarefas de ${m.stage.toLocaleLowerCase("pt-BR")} e valide o resultado com ${m.owner}.`}
        </p>
        {!unplanned && (
          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
            <div className="flex items-center gap-1.5">
              <dt className="text-muted">Progresso</dt>
              <dd className="tabular-nums">
                {progress.done}/{progress.items.length} tarefas
                <span className="text-muted"> · {progress.percent}%</span>
              </dd>
            </div>
            {progress.items.length > 0 && (
              <div className="flex items-center gap-1.5">
                <dt className="text-muted">Prazo</dt>
                <dd className="tabular-nums">
                  {journeyDate(progress.dueAt)}
                  {progress.overdue.length > 0 && (
                    <span className="ml-1.5 text-rose">
                      {progress.overdue.length} em atraso
                    </span>
                  )}
                </dd>
              </div>
            )}
            {progress.remainingHours > 0 && (
              <div className="flex items-center gap-1.5">
                <dt className="text-muted">Restante</dt>
                <dd className="tabular-nums">{progress.remainingHours} h</dd>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <dt className="text-muted">Responsável</dt>
              <dd>
                {m.owner && m.owner !== "Responsável"
                  ? `${m.owner} · ${resolve(company.csId).name}`
                  : resolve(company.csId).name}
              </dd>
            </div>
            {m.durationWeeks ? (
              <div className="flex items-center gap-1.5">
                <dt className="text-muted">Duração</dt>
                <dd>
                  {m.durationWeeks} semana{m.durationWeeks === 1 ? "" : "s"}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ActionMenu
          label="Mais ações do marco"
          actions={[
            {
              label: advance.ready ? "Revisar e avançar" : "Revisar pendências",
              icon: <ArrowRight />,
              onSelect: onReview,
              disabled: !current,
            },
            {
              label: "Ver todos os ciclos",
              icon: <Repeat2 />,
              href:
                paths.clientPlan(company.slug, "ciclos") +
                "&" +
                new URLSearchParams({
                  contratacao: enrollmentId ?? "__legacy__",
                }),
            },
            {
              label: journey.productId ? "Ver produto no catálogo" : "Ver modelo legado",
              icon: <Flag />,
              href: journey.productId
                ? paths.catalogProducts(journey.productId)
                : paths.catalogProducts(),
              separator: true,
            },
          ]}
        />
        {!unplanned && (
          <>
            <Button variant="ghost" size="sm" onClick={onCreate}>
              <Plus className="h-3.5 w-3.5" />
              Nova tarefa
            </Button>
            <Button
              size="sm"
              href={
                paths.clientPlan(company.slug, "ciclos", open) +
                "&" +
                new URLSearchParams({
                  contratacao: enrollmentId ?? "__legacy__",
                })
              }
            >
              <Repeat2 className="h-3.5 w-3.5" />
              Novo ciclo neste marco
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
