"use client";
import { Suspense } from "react";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { EvidenceBadge } from "@/modules/delivery/presentation/EvidenceBadge";
import { DeliveryEditor } from "@/modules/delivery/presentation/TaskDrawer";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { dueMeta, priorityLabel } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Badge, Button, Empty, StatusBadge } from "@/shared/ui/primitives";
import { useParams } from "next/navigation";

/** Full page for one delivery: room for comments, history and the blocker. */
function DeliveryPageScreenContent() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const { statusMap, extraTasks, taskPatches, patchTask } = useDeliveryState();
  const { clientBySlug } = useClientsState();
  const task = deliveriesFor(slug, statusMap, extraTasks, taskPatches).find(
    (d) => d.id === id,
  );
  if (!task || !clientBySlug(slug))
    return (
      <Empty
        title="Tarefa não encontrada"
        hint="Ela pode ter sido removida ou pertencer a outro cliente."
        action={
          <Button href={paths.clientDeliveries(slug)} variant="ghost" size="sm">
            Ver tarefas
          </Button>
        }
      />
    );
  return <DeliveryPage task={task} onChange={patchTask} />;
}

function DeliveryPage({
  task,
  onChange,
}: {
  task: NonNullable<ReturnType<typeof deliveriesFor>[number]>;
  onChange: (id: string, patch: Partial<typeof task>) => void;
}) {
  const { resolve } = useTeam();
  const due = dueMeta(task.dueAt);
  return (
    <div className="space-y-6">
      <PageHeading
        compact
        breadcrumb={false}
        title={task.title || "Tarefa"}
        description={[
          resolve(task.ownerId).name,
          `prazo ${due.label}`,
          task.hours ? `${task.hours} h previstas` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <EvidenceBadge task={task} compact />
            {task.priority && task.priority !== "media" && (
              <Badge tone={task.priority === "critica" ? "bad" : "warn"}>
                {priorityLabel[task.priority]}
              </Badge>
            )}
            <Button
              href={paths.clientDeliveries(
                task.company,
                task.kind === "request" ? "solicitacoes" : "entregas",
              )}
              variant="ghost"
              size="sm"
            >
              Ver todas
            </Button>
          </div>
        }
      />
      <DeliveryEditor key={task.id} task={task} onChange={onChange} layout="page" />
    </div>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function DeliveryPageScreen() {
  return (
    <Suspense>
      <DeliveryPageScreenContent />
    </Suspense>
  );
}
