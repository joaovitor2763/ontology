"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import {
  cycleProgress,
  cycleStatusLabel,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { AcceptanceWait } from "@/modules/delivery/presentation/CycleDetail";
import { formatDate, NOW } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/primitives";
import { DataTable } from "@g4ai/ds";

export function CycleList({
  cycles,
  tasks,
  company,
  ownerName,
  productName,
  milestoneLabel,
  onSelect,
}: {
  cycles: ServiceCycle[];
  tasks: Pick<Delivery, "id" | "company" | "status">[];
  company?: string;
  ownerName: (id: string) => string;
  productName: (id?: string) => string;
  /** Plan milestone of the cycle, e.g. "M03 · Plano aprovado"; shown inside a client. */
  milestoneLabel?: (cycle: ServiceCycle) => string | null;
  onSelect: (id: string) => void;
}) {
  const { clientBySlug } = useClientsState();
  return (
    <DataTable
      label="Ciclos"
      rows={cycles}
      rowKey={(cycle) => cycle.id}
      rowTone={(cycle) =>
        cycle.status !== "concluido" && cycle.endsAt < NOW.slice(0, 10) ? "bad" : undefined
      }
      columns={[
        {
          key: "name",
          header: "Ciclo",
          primary: true,
          cell: (cycle) => (
            <>
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => onSelect(cycle.id)}
              >
                {cycle.name}
              </button>
              <span className="mt-1 block text-meta font-normal text-muted">
                {milestoneLabel?.(cycle) ? (
                  <span className="mr-1.5 rounded-md bg-soft px-1.5 py-0.5 text-ink-soft">
                    {milestoneLabel(cycle)}
                  </span>
                ) : null}
                {productName(cycle.productId)}
              </span>
              {!company && (
                <span className="mt-1 block text-caption font-normal text-muted">
                  {clientBySlug(cycle.company)?.name}
                </span>
              )}
            </>
          ),
        },
        {
          key: "status",
          header: "Situação",
          cell: (cycle) => (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge
                tone={
                  cycle.status === "concluido"
                    ? "ok"
                    : cycle.status === "em-aceite"
                      ? "warn"
                      : "neutral"
                }
              >
                {cycleStatusLabel[cycle.status]}
              </Badge>
              <AcceptanceWait cycle={cycle} />
            </span>
          ),
        },
        {
          key: "period",
          header: "Período",
          cell: (cycle) => {
            const overdue = cycle.status !== "concluido" && cycle.endsAt < NOW.slice(0, 10);
            return (
              <span className={overdue ? "text-rose" : "text-muted"}>
                <span className="block text-caption">{formatDate(cycle.startsAt)}</span>
                <span className="block text-caption">até {formatDate(cycle.endsAt)}</span>
              </span>
            );
          },
        },
        {
          key: "tasks",
          header: "Tarefas",
          cell: (cycle) => {
            const progress = cycleProgress(cycle, tasks);
            return (
              <>
                <span className="tabular-nums">
                  {progress.done}/{progress.total}
                </span>
                <span className="ml-2 text-meta text-muted">{progress.percent}%</span>
              </>
            );
          },
        },
        {
          key: "owner",
          header: "Responsável",
          cell: (cycle) => <span className="text-ink-soft">{ownerName(cycle.ownerId)}</span>,
        },
      ]}
    />
  );
}
