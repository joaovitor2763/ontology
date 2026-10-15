"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import type { ServiceCycle } from "@/modules/delivery/domain/services";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { CycleDetail } from "@/modules/delivery/presentation/CycleDetail";
import { CycleForm } from "@/modules/delivery/presentation/CycleForm";
import { NewDeliveryForm } from "@/modules/delivery/presentation/NewDeliveryForm";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { paths } from "@/shared/lib/routes";
import { Button, Empty } from "@/shared/ui/primitives";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";

/** The cycle as a page: the result contracted, its acceptance and its evidence. */
function CyclePageScreenContent() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const { cycles, statusMap, extraTasks, taskPatches, patchTask } =
    useDeliveryState();
  const { clientBySlug } = useClientsState();
  const [editing, setEditing] = useState<ServiceCycle | null>(null);
  const [adding, setAdding] = useState<ServiceCycle | null>(null);
  const [openTask, setOpenTask] = useState<Delivery | null>(null);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const cycle = cycles.find((c) => c.id === id && c.company === slug);
  const tasks = deliveriesFor(slug, statusMap, extraTasks, taskPatches);
  if (!cycle || !clientBySlug(slug))
    return (
      <Empty
        title="Ciclo não encontrado"
        hint="Ele pode ter sido excluído ou pertencer a outro cliente."
        action={
          <Button
            href={paths.clientPlan(slug, "ciclos")}
            variant="ghost"
            size="sm"
          >
            Ver ciclos
          </Button>
        }
      />
    );
  return (
    <div className="space-y-6">
      <CycleDetail
        key={cycle.id}
        cycle={cycle}
        tasks={tasks}
        layout="page"
        onEdit={(c) => setEditing(c)}
        onOpenTask={(task) => setOpenTask(task)}
        onAddDelivery={(c) => setAdding(c)}
        onDeleted={() => router.push(paths.clientPlan(slug, "ciclos"))}
        onDuplicated={(next) => router.push(paths.clientCycle(slug, next))}
      />
      {editing && hydrated && (
        <CycleForm
          cycle={editing}
          company={slug}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <NewDeliveryForm
          company={adding.company}
          cycle={cycles.find((c) => c.id === adding.id) ?? adding}
          onClose={() => setAdding(null)}
        />
      )}
      <TaskDrawer
        task={openTask}
        onClose={() => setOpenTask(null)}
        onChange={patchTask}
      />
    </div>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function CyclePageScreen() {
  return (
    <Suspense>
      <CyclePageScreenContent />
    </Suspense>
  );
}
