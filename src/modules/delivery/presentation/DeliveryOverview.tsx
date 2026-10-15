"use client";
import type { DeliveryStatus } from "@/modules/delivery/domain/models";
import { StatusBar, type WorkStatus } from "@g4ai/ds";
import { ChartNoAxesColumn } from "lucide-react";

/** Status de tarefa → status de trabalho do DS (cores e ordem do `StatusBar`). */
const workStatus: Record<DeliveryStatus, WorkStatus> = {
  fila: "queued",
  "em-curso": "active",
  revisao: "review",
  entregue: "done",
  bloqueado: "blocked",
};
const labels: Record<WorkStatus, string> = {
  queued: "A fazer",
  active: "Em andamento",
  review: "Em revisão",
  done: "Concluídas",
  blocked: "Bloqueadas",
};

export function DeliveryOverview({ counts: supplied }: { counts: Record<DeliveryStatus, number> }) {
  const counts = Object.fromEntries(
    (Object.keys(workStatus) as DeliveryStatus[]).map((id) => [workStatus[id], supplied[id]]),
  ) as Record<WorkStatus, number>;
  const total = Object.values(supplied).reduce((sum, count) => sum + count, 0);
  return (
    <div className="mt-5">
      <section className="rounded-xl border border-line bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <ChartNoAxesColumn className="h-4 w-4 text-muted" />
          <h2 className="text-control font-medium">Tarefas da carteira</h2>
          <span className="ml-auto text-meta text-muted">
            {total} no total
          </span>
        </div>
        <StatusBar className="mt-5" counts={counts} labels={labels} />
      </section>
    </div>
  );
}
