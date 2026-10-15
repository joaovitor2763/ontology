"use client";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { dueMeta, formatDate } from "@/shared/lib/format";
import { Avatar, Button, StatusBadge } from "@/shared/ui/primitives";
import type { Delivery } from "@/modules/delivery/domain/models";
import type { ServiceCycle } from "@/modules/delivery/domain/services";
import { CriticalTaskBadge } from "../CriticalTaskBadge";
import { DataTable } from "@g4ai/ds";

export function CycleTasks({
  cycle,
  rows,
  done,
  total,
  busy,
  layout,
  resolve,
  onOpenTask,
  onAddDelivery,
}: {
  cycle: ServiceCycle;
  rows: Delivery[];
  done: number;
  total: number;
  busy: boolean;
  layout: "drawer" | "page";
  resolve: (id: string) => { name: string; initials: string };
  onOpenTask: (task: Delivery) => void;
  onAddDelivery: (cycle: ServiceCycle) => void;
}) {
  return (
    <section aria-label="Tarefas do ciclo">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium">
          Tarefas · {done}/{total}
          {rows.some(
            (t) => t.priority === "critica" && t.status !== "entregue",
          ) && (
            <span className="ml-2 text-[12px] text-rose">
              {
                rows.filter(
                  (t) => t.priority === "critica" && t.status !== "entregue",
                ).length
              }{" "}
              críticas pendentes
            </span>
          )}
        </h3>
        {cycle.status !== "concluido" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAddDelivery(cycle)}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar tarefa
          </Button>
        )}
      </div>
      {layout === "page" ? (
        <DataTable
          label="Tarefas do ciclo"
          rows={rows}
          rowKey={(t) => t.id}
          onRowClick={onOpenTask}
          rowLabel={(t) => `Abrir tarefa ${t.title}`}
          columns={[
            {
              key: "title",
              header: "Tarefa",
              primary: true,
              cell: (t) => (
                <>
                  {t.title}
                  <CriticalTaskBadge priority={t.priority} />
                </>
              ),
            },
            {
              key: "owner",
              header: "Responsável",
              width: 150,
              cell: (t) => (
                <span className="inline-flex items-center gap-2 text-ink-soft">
                  <Avatar initials={resolve(t.ownerId).initials} size="sm" />
                  {resolve(t.ownerId).name.split(" ")[0]}
                </span>
              ),
            },
            {
              key: "due",
              header: "Prazo",
              width: 210,
              nowrap: true,
              cell: (t) => {
                const due = dueMeta(t.dueAt);
                return (
                  <span
                    className={cn(
                      "tabular-nums",
                      t.status !== "entregue" && due.tone === "bad" ? "text-rose" : "text-ink-soft",
                    )}
                  >
                    {formatDate(t.dueAt)}
                    {t.status !== "entregue" && (
                      <span className="ml-1.5 text-[11.5px] text-muted">{due.label}</span>
                    )}
                  </span>
                );
              },
            },
            {
              key: "status",
              header: "Status",
              width: 130,
              cell: (t) => <StatusBadge status={t.status} />,
            },
          ]}
        />
      ) : (
        <div className="divide-y divide-line">
          {rows.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpenTask(t)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] hover:bg-soft"
            >
              <span className="min-w-0">
                <span className="flex items-center">
                  <span className="truncate">{t.title}</span>
                  <CriticalTaskBadge priority={t.priority} />
                </span>
                <span className="mt-0.5 block text-[11.5px] text-muted">
                  {resolve(t.ownerId).name.split(" ")[0]} ·{" "}
                  {formatDate(t.dueAt)}
                </span>
              </span>
              <StatusBadge status={t.status} />
            </button>
          ))}
        </div>
      )}
      {!rows.length && (
        <p className="mt-2 text-[12px] text-muted">
          Nenhuma tarefa vinculada. Adicione uma tarefa ou vincule as existentes
          ao editar o ciclo.
        </p>
      )}
    </section>
  );
}
