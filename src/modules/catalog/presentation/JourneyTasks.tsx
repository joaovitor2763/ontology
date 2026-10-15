"use client";

import {
  isBlocked,
  journeyDate,
} from "@/modules/catalog/domain/journey-progress";
import { deliverableTemplates } from "@/modules/catalog/infrastructure/journey";
import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import type { Person } from "@/modules/workspace/domain/models";
import { cn } from "@/shared/lib/cn";
import { Avatar } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { CircleCheck, FileCheck2, ShieldAlert } from "lucide-react";
import { useState } from "react";

export const JOURNEY_TASK_STATUSES: { id: DeliveryStatus; label: string }[] = [
  { id: "fila", label: "A fazer" },
  { id: "em-curso", label: "Em curso" },
  { id: "revisao", label: "Em revisão" },
  { id: "bloqueado", label: "Bloqueada" },
  { id: "entregue", label: "Concluída" },
];
type Props = {
  tasks: Delivery[];
  layout: "list" | "board";
  overdueIds: Set<string>;
  ownerOf: (id: string) => Person;
  onOpen: (task: Delivery) => void;
  onStatus: (task: Delivery, status: DeliveryStatus) => void;
};

function TaskStatus({
  task,
  onStatus,
  compact = false,
}: Pick<Props, "onStatus"> & { task: Delivery; compact?: boolean }) {
  const tone =
    task.status === "entregue"
      ? "ok"
      : task.status === "bloqueado" || isBlocked(task)
        ? "bad"
        : task.status === "em-curso" || task.status === "revisao"
          ? "warn"
          : "neutral";
  return (
    <span className="relative inline-flex shrink-0">
      <Select
        label={`Status de ${task.title}`}
        size="compact"
        tone={tone}
        align="end"
        className={compact ? "h-7 w-[104px] text-[11px]" : "w-[118px]"}
        value={task.status}
        onValueChange={(value) => onStatus(task, value as DeliveryStatus)}
        options={JOURNEY_TASK_STATUSES.map((status) => ({
          value: status.id,
          label: status.label,
        }))}
      />
    </span>
  );
}

export function JourneyTasks({
  tasks,
  layout,
  overdueIds,
  ownerOf,
  onOpen,
  onStatus,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DeliveryStatus | null>(null);
  if (layout === "list")
    return (
      <div className="@container">
        <ul className="divide-y divide-line" data-journey-tasks>
          {tasks.map((task) => {
            const owner = ownerOf(task.ownerId);
            const template = deliverableTemplates.find(
              (item) => item.id === task.deliverable,
            );
            return (
              <li
                key={task.id}
                data-task-id={task.id}
                className="flex min-h-[52px] items-center gap-2 py-2 @min-[640px]:gap-3"
              >
                <button
                  aria-label={`${task.status === "entregue" ? "Reabrir" : isBlocked(task) ? "Revisar bloqueio de" : "Concluir"} tarefa: ${task.title}`}
                  onClick={() =>
                    isBlocked(task)
                      ? onOpen(task)
                      : onStatus(
                          task,
                          task.status === "entregue" ? "fila" : "entregue",
                        )
                  }
                  className={cn(
                    "flex h-8 w-7 shrink-0 items-center justify-center rounded-full",
                    task.status === "entregue"
                      ? "text-blue"
                      : isBlocked(task)
                        ? "text-rose"
                        : "text-line-strong hover:text-blue",
                  )}
                >
                  {isBlocked(task) ? (
                    <ShieldAlert className="h-4 w-4" />
                  ) : (
                    <CircleCheck className="h-4 w-4" />
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    onClick={() => onOpen(task)}
                    aria-label={`Abrir tarefa: ${task.title}`}
                    title={`${task.title} · ${template?.name ?? "Checklist"}`}
                    className={cn(
                      "flex min-w-0 basis-full items-center gap-1.5 text-left text-[12px] font-medium leading-5 hover:text-blue @min-[640px]:flex-1 @min-[640px]:basis-0",
                      task.status === "entregue" && "text-muted",
                    )}
                  >
                    {task.completion === "deliverable" && (
                      <FileCheck2 className="h-3 w-3 shrink-0 text-muted" />
                    )}
                    <span className="line-clamp-2 break-words @min-[640px]:block @min-[640px]:truncate">
                      {task.title}
                    </span>
                  </button>
                  <div className="flex max-w-full items-center gap-2 @min-[640px]:gap-3">
                    <Avatar
                      initials={owner.initials}
                      name={owner.name}
                      size="sm"
                    />
                    <span
                      className={cn(
                        "w-[64px] shrink-0 whitespace-nowrap text-[10px]",
                        overdueIds.has(task.id) ? "text-rose" : "text-muted",
                      )}
                      title={`Prazo: ${journeyDate(task.dueAt)}${overdueIds.has(task.id) ? " · em atraso" : ""}`}
                    >
                      {journeyDate(task.dueAt)}
                    </span>
                    <span className="hidden w-9 shrink-0 text-right text-[10px] text-muted @min-[1000px]:block">
                      {task.hours} h
                    </span>
                    <TaskStatus task={task} onStatus={onStatus} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );

  const columns = JOURNEY_TASK_STATUSES.filter(
    (status) =>
      status.id !== "bloqueado" ||
      tasks.some((task) => task.status === "bloqueado"),
  );
  return (
    <div className="@container mt-3" data-journey-board>
      <div
        className="overflow-x-auto pb-2"
        tabIndex={0}
        role="region"
        aria-label="Quadro de tarefas por status"
      >
        <div className="grid grid-flow-col auto-cols-[200px] gap-3 @min-[720px]:auto-cols-[minmax(176px,1fr)]">
          {columns.map((status) => {
            const items = tasks.filter((task) => task.status === status.id);
            return (
              <section
                key={status.id}
                data-status-column={status.id}
                aria-label={`${status.label}: ${items.length} tarefas`}
                onDragOver={(event) => {
                  if (dragging) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(status.id);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const task = tasks.find(
                    (item) =>
                      item.id ===
                      event.dataTransfer.getData("application/x-journey-task"),
                  );
                  if (task && task.status !== status.id)
                    onStatus(task, status.id);
                  setDragging(null);
                  setOver(null);
                }}
                className={cn(
                  "min-w-0 rounded-xl border p-2 transition-colors",
                  over === status.id
                    ? "border-line-strong bg-soft"
                    : "border-line bg-surface",
                )}
              >
                <h4 className="mb-3 flex items-center justify-between gap-2 px-1 pt-1 text-[11px] font-medium">
                  <span
                    className={
                      status.id === "bloqueado"
                        ? "text-rose"
                        : status.id === "entregue"
                          ? "text-blue"
                          : "text-ink-soft"
                    }
                  >
                    {status.label}
                  </span>
                  <span className="text-[10px] font-normal text-muted">
                    {items.length}
                  </span>
                </h4>
                <ul
                  className="max-h-[340px] space-y-2 overflow-y-auto lg:max-h-[max(340px,calc(100dvh-var(--outer-header-height,0px)-var(--pinned-header-height,0px)-132px))]"
                  aria-label={`Tarefas: ${status.label}`}
                >
                  {items.map((task) => {
                    const owner = ownerOf(task.ownerId);
                    return (
                      <li
                        key={task.id}
                        data-task-id={task.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "application/x-journey-task",
                            task.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(task.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={cn(
                          "cursor-grab rounded-lg border border-line bg-surface px-2.5 py-2 active:cursor-grabbing hover:border-line-strong",
                          dragging === task.id && "opacity-40",
                        )}
                      >
                        <button
                          onClick={() => onOpen(task)}
                          aria-label={`Abrir tarefa: ${task.title}`}
                          title={task.title}
                          className="block w-full text-left text-[12px] font-medium leading-[18px] hover:text-blue"
                        >
                          <span className="line-clamp-3 break-words">
                            {task.title}
                          </span>
                        </button>
                        {isBlocked(task) && (
                          <span className="mt-2 flex items-center gap-1 text-[10px] text-rose">
                            <ShieldAlert className="h-3 w-3" />
                            Com bloqueio
                          </span>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                          <Avatar
                            initials={owner.initials}
                            name={owner.name}
                            size="sm"
                          />
                          <span className="truncate">{owner.name.split(" ")[0]}</span>
                          <span
                            className={cn(
                              "ml-auto whitespace-nowrap tabular-nums",
                              overdueIds.has(task.id) && "text-rose",
                            )}
                          >
                            {journeyDate(task.dueAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {!items.length && (
                  <p className="rounded-lg border border-dashed border-line px-2 py-5 text-center text-[10px] text-muted">
                    Sem tarefas
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
