"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  FileCheck2,
  Repeat2,
  ShieldAlert,
} from "lucide-react";
import { isBlocked, journeyDate } from "@/modules/catalog/domain/journey-progress";
import { JOURNEY_TASK_STATUSES as STATUS } from "@/modules/catalog/presentation/JourneyTasks";
import type { Delivery, DeliveryStatus } from "@/modules/delivery/domain/models";
import {
  cycleProgress,
  cycleStatusLabel,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { AcceptanceWait } from "@/modules/delivery/presentation/CycleDetail";
import { CriticalTaskBadge } from "@/modules/delivery/presentation/CriticalTaskBadge";
import { cn } from "@/shared/lib/cn";
import { paths } from "@/shared/lib/routes";
import { ActionMenu } from "@/shared/ui/Menu";
import { Avatar, Badge, StatusBadge } from "@/shared/ui/primitives";
import { cycleTone, statusDot } from "./shared";

export type TaskGroup = {
  key: string;
  cycle: ServiceCycle | null;
  tasks: Delivery[];
};

export function MilestoneTasksTable({
  companySlug,
  groups,
  allTasks,
  today,
  milestoneCyclesCount,
  showLoose,
  setShowLoose,
  totalItems,
  visibleCount,
  overdueIds,
  canEditTasks,
  busy,
  resolve,
  onEdit,
  onChangeStatus,
  onCreate,
}: {
  companySlug: string;
  groups: TaskGroup[];
  allTasks: Delivery[];
  today: string;
  milestoneCyclesCount: number;
  showLoose: boolean;
  setShowLoose: (fn: (v: boolean) => boolean) => void;
  totalItems: number;
  visibleCount: number;
  overdueIds: Set<string>;
  canEditTasks: boolean;
  busy: boolean;
  resolve: (id: string) => { name: string; initials: string };
  onEdit: (task: Delivery) => void;
  onChangeStatus: (task: Delivery, status: DeliveryStatus) => void;
  onCreate: () => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-line">
      {/* g4os-ds-disable-next-line raw-table -- tabela agrupada por ciclo (um tbody com cabeçalho de grupo por ciclo, grupo recolhível); o DataTable não tem grupos */}
      <table className="w-full min-w-[720px] table-fixed text-left text-[13px]">
        <thead className="border-b border-line text-[11px] uppercase tracking-[0.04em] text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Tarefa</th>
            <th className="w-[140px] px-3 py-2 font-medium">Responsável</th>
            <th className="w-[112px] px-3 py-2 font-medium">Prazo</th>
            <th className="w-[132px] px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        {groups.map((group) => {
          const cycle = group.cycle;
          const done = cycle ? cycleProgress(cycle, allTasks) : null;
          const overdue =
            cycle && cycle.status !== "concluido" && cycle.endsAt < today;
          const folded = !cycle && milestoneCyclesCount > 0 && !showLoose;
          return (
            <tbody
              key={group.key}
              className="border-b border-line last:border-0"
            >
              <tr className="bg-soft/50">
                <td colSpan={4} className="px-3 py-2">
                  {cycle ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                      <Link
                        href={paths.clientCycle(companySlug, cycle.id)}
                        className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium hover:text-blue"
                      >
                        <Repeat2 className="h-3.5 w-3.5 text-muted" />
                        <span className="truncate">{cycle.name}</span>
                      </Link>
                      <Badge tone={cycleTone(cycle.status)}>
                        {cycleStatusLabel[cycle.status]}
                      </Badge>
                      <span className={cn("text-muted", overdue && "text-rose")}>
                        {journeyDate(cycle.startsAt)} —{" "}
                        {journeyDate(cycle.endsAt)}
                      </span>
                      <span className="text-muted">
                        {resolve(cycle.ownerId).name.split(" ")[0]}
                      </span>
                      {done && (
                        <span className="tabular-nums text-muted">
                          {done.done}/{done.total} tarefas
                        </span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-2">
                        <AcceptanceWait cycle={cycle} />
                        <Link
                          href={paths.clientCycle(companySlug, cycle.id)}
                          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
                        >
                          Abrir ciclo
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium text-ink-soft">
                          Sem ciclo
                        </span>
                        <span className="tabular-nums">
                          {group.tasks.length}{" "}
                          {group.tasks.length === 1 ? "tarefa" : "tarefas"}
                        </span>
                      </span>
                      {milestoneCyclesCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => setShowLoose((v) => !v)}
                          aria-expanded={!folded}
                          className="inline-flex items-center gap-1 text-[12px] text-blue hover:underline"
                        >
                          {folded ? "Mostrar" : "Recolher"}
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 transition-transform",
                              !folded && "rotate-180",
                            )}
                          />
                        </button>
                      ) : (
                        <span>Vincule a um ciclo ao editar a tarefa</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
              {!folded &&
                group.tasks.map((task) => {
                  const owner = resolve(task.ownerId);
                  const blocked = isBlocked(task);
                  return (
                    <tr
                      key={task.id}
                      className="border-t border-line hover:bg-soft/40"
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2 pl-1">
                          <button
                            type="button"
                            disabled={!canEditTasks || busy}
                            aria-label={`${task.status === "entregue" ? "Reabrir" : blocked ? "Revisar bloqueio de" : "Concluir"} tarefa: ${task.title}`}
                            onClick={() =>
                              blocked
                                ? onEdit(task)
                                : onChangeStatus(
                                    task,
                                    task.status === "entregue"
                                      ? "fila"
                                      : "entregue",
                                  )
                            }
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                              task.status === "entregue"
                                ? "text-ok"
                                : blocked
                                  ? "text-rose"
                                  : "text-line-strong hover:text-blue",
                            )}
                          >
                            {blocked ? (
                              <ShieldAlert className="h-4 w-4" />
                            ) : (
                              <CircleCheck className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(task)}
                            className={cn(
                              "flex min-w-0 items-center gap-1.5 text-left font-medium hover:text-blue",
                              task.status === "entregue" &&
                                "text-muted line-through decoration-line-strong",
                            )}
                          >
                            {task.completion === "deliverable" && (
                              <FileCheck2 className="h-3 w-3 shrink-0 text-muted" />
                            )}
                            <span className="truncate">{task.title}</span>
                            <CriticalTaskBadge priority={task.priority} />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-soft">
                          <Avatar
                            initials={owner.initials}
                            name={owner.name}
                            size="sm"
                          />
                          <span className="truncate">
                            {owner.name.split(" ")[0]}
                          </span>
                        </span>
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-[12.5px] tabular-nums",
                          overdueIds.has(task.id)
                            ? "text-rose"
                            : "text-ink-soft",
                        )}
                      >
                        {journeyDate(task.dueAt)}
                      </td>
                      <td className="px-3 py-1.5">
                        <ActionMenu
                          label={`Status de ${task.title}`}
                          className="h-7 px-1"
                          trigger={<StatusBadge status={task.status} />}
                          actions={STATUS.map((status) => ({
                            label: status.label,
                            icon: (
                              <span
                                aria-hidden
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  statusDot[status.id],
                                )}
                              />
                            ),
                            disabled:
                              status.id === task.status || !canEditTasks || busy,
                            onSelect: () =>
                              onChangeStatus(task, status.id as DeliveryStatus),
                          }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              {cycle && !group.tasks.length && (
                <tr className="border-t border-line">
                  <td
                    colSpan={4}
                    className="px-3 py-2 pl-[52px] text-[12px] text-muted"
                  >
                    {totalItems && visibleCount !== totalItems
                      ? "Nenhuma tarefa deste ciclo no filtro."
                      : "Sem tarefas ainda."}{" "}
                    <button
                      type="button"
                      onClick={onCreate}
                      className="text-blue hover:underline"
                    >
                      Adicionar tarefa
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
