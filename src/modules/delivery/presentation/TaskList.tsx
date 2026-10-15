"use client";
import { useTaskRemovalConfirmation } from "./useTaskRemovalConfirmation";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { ActionMenu } from "@/shared/ui/Menu";
import { useTaskOperations } from "./useTaskOperations";
import { requestCompletion } from "../infrastructure/completion-request";
import { CriticalTaskBadge } from "./CriticalTaskBadge";
import { Combobox } from "@/shared/ui/Combobox";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { directDueDatePatch } from "@/modules/delivery/domain/delivery-policy";
import { DatePicker } from "@/shared/ui/DatePicker";
import { EvidenceTag } from "@/modules/delivery/presentation/EvidenceBadge";
import { useServices } from "@/modules/delivery/presentation/state";
import { useEvidenceEvaluatorForCycles } from "@/modules/delivery/presentation/useEvidence";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  deliveryLabel,
  deliveryOrder,
  dueMeta,
  formatDate,
  padMilestone,
} from "@/shared/lib/format";
import { fieldClass } from "@/shared/ui/Drawer";
import { Button, StatusBadge } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { X, Trash2 } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@g4ai/ds";
import { Checkbox } from "@/shared/ui/Checkbox";

export function TaskList({
  tasks,
  company,
  onOpen,
  ownerName,
}: {
  tasks: Delivery[];
  company?: string;
  onOpen: (task: Delivery) => void;
  ownerName: (id: string) => string;
}) {
  const { cycles, products } = useServices();
  const { patchTasks, removeTask } = useDeliveryState();
  const operation = useTaskOperations();
  return <TaskListView tasks={tasks} company={company} onOpen={onOpen} ownerName={ownerName}
    cycles={cycles} products={products} operation={operation} onPatch={patchTasks} onRemoved={removeTask} />;
}

type ListOperation = {
  busy: boolean;
  error: string;
  retry: () => Promise<unknown>;
  run: (command: "tasks.update" | "tasks.remove", input: unknown, local: () => void,
    confirmed?: () => void) => Promise<boolean>;
};

/** Same list for document-backed and remote boards; the adapter owns the write. */
export function TaskListView({ tasks, company, onOpen, ownerName, cycles, products,
  operation, onPatch, onRemoved }: {
  tasks: Delivery[];
  company?: string;
  onOpen: (task: Delivery) => void;
  ownerName: (id: string) => string;
  cycles: readonly { company: string; taskIds: readonly string[]; name: string;
    acceptance: readonly { done: boolean; approvedBy?: string }[] }[];
  products: readonly { id: string; name: string }[];
  operation: ListOperation;
  onRemoved?: (id: string) => void;
  onPatch: (ids: string[], patch: Partial<Delivery>) => void;
}) {
  const { can } = usePermissions();
  const removal = useTaskRemovalConfirmation(operation, onRemoved);
  const evaluate = useEvidenceEvaluatorForCycles(cycles);
  const { active } = useTeam();
  const { clientBySlug } = useClientsState();
  const companyName = (slug: string) => clientBySlug(slug)?.name ?? slug;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<DeliveryStatus | "">("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkDue, setBulkDue] = useState("");
  const visible = tasks.filter((t) => selected.has(t.id));
  const allSelected = tasks.length > 0 && visible.length === tasks.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = visible.map((t) => t.id);
  const clear = () => setSelected(new Set());
  const apply = (patch: Partial<Delivery>) => {
    if (operation.busy) return;
    if (patch.status === "entregue") {
      for (const task of visible.filter(task => task.status !== "entregue")) requestCompletion(task, patch);
      setBulkStatus("");
      return;
    }
    // A new deadline before a task's start carries the start with it (the server applies the same rule per task).
    const local = () => {
      if (patch.dueAt === undefined) return onPatch(ids, patch);
      const groups = new Map<string, { ids: string[]; patch: Partial<Delivery> }>();
      for (const task of visible) {
        const own = { ...patch, ...directDueDatePatch(task, patch.dueAt) }, key = JSON.stringify(own);
        groups.set(key, { ids: [...(groups.get(key)?.ids ?? []), task.id], patch: own });
      }
      for (const group of groups.values()) onPatch(group.ids, group.patch);
    };
    void operation.run("tasks.update", { taskIds: ids, patch }, local, () => {
      setBulkStatus(""); setBulkOwner(""); setBulkDue("");
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {removal.dialog}
      {operation.error && <div role="alert" className="flex items-center gap-3 text-[13px] text-rose">{operation.error}<Button size="sm" disabled={operation.busy} onClick={() => void operation.retry()}>Tentar novamente</Button></div>}
      {visible.length > 0 && (
        <div
          role="toolbar"
          aria-label="Ações em lote"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-soft/50 px-3 py-2 text-[12.5px]"
        >
          <span className="font-medium">
            {visible.length} selecionada{visible.length === 1 ? "" : "s"}
          </span>
          <Select
            label="Novo status"
            disabled={operation.busy}
            size="compact"
            placeholder="Status…"
            value={bulkStatus}
            onValueChange={(value) => {
              const next = value as DeliveryStatus | "";
              setBulkStatus(next);
              if (next) apply({ status: next });
            }}
            options={deliveryOrder.map((s) => ({
              value: s,
              label: deliveryLabel[s],
            }))}
          />
          <Combobox
            label="Novo responsável"
            disabled={operation.busy}
            className={`${fieldClass} h-8 w-48 text-[12.5px]`}
            value={bulkOwner}
            placeholder="Responsável…"
            onValueChange={(value) => {
              setBulkOwner(value);
              if (value) apply({ ownerId: value });
            }}
            options={active.map((p) => ({ value: p.id, label: p.name }))}
          />
          <DatePicker
            label="Novo prazo"
            disabled={operation.busy}
            className="h-8 w-40 text-[12.5px]"
            value={bulkDue}
            onValueChange={(value) => {
              setBulkDue(value);
              apply({ dueAt: value });
            }}
          />
          <Button variant="ghost" size="sm" className="ml-auto" disabled={operation.busy} onClick={clear}>
            <X className="h-3.5 w-3.5" />
            Limpar seleção
          </Button>
        </div>
      )}
      <DataTable
        label="Tarefas"
        className="min-h-0 flex-1"
        maxHeight="none"
        rows={tasks}
        rowKey={(task) => task.id}
        rowSelected={(task) => selected.has(task.id)}
        columns={[
          {
            key: "select",
            selection: true,
            className: "w-8",
            header: (
              <Checkbox
                hideLabel
                disabled={operation.busy}
                label="Selecionar todas as tarefas visíveis"
                checked={allSelected}
                indeterminate={visible.length > 0 && !allSelected}
                onCheckedChange={(checked) =>
                  setSelected(
                    checked ? new Set(tasks.map((t) => t.id)) : new Set(),
                  )
                }
              />
            ),
            cell: (task) => (
              <Checkbox
                hideLabel
                disabled={operation.busy}
                label={`Selecionar ${task.title}`}
                checked={selected.has(task.id)}
                onCheckedChange={() => toggle(task.id)}
              />
            ),
          },
          {
            key: "title",
            header: "Tarefa",
            primary: true,
            cell: (task) => (
              <>
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="text-left font-medium hover:underline"
                >
                  {task.title}<CriticalTaskBadge priority={task.priority} />
                </button>
                {!company && (
                  <span className="mt-1 block text-caption font-normal text-muted">
                    {companyName(task.company)}
                  </span>
                )}
              </>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (task) => <StatusBadge status={task.status} />,
          },
          {
            key: "due",
            header: "Prazo",
            cell: (task) => {
              const due = dueMeta(task.dueAt);
              return (
                <span
                  className={
                    due.tone === "bad" && task.status !== "entregue"
                      ? "text-rose"
                      : "text-ink-soft"
                  }
                >
                  <span className="block whitespace-nowrap">
                    {formatDate(task.dueAt)}
                  </span>
                  <span className="text-meta">
                    {task.status === "entregue" ? "Concluída" : due.label}
                  </span>
                </span>
              );
            },
          },
          {
            key: "owner",
            header: "Responsável",
            cell: (task) => <span className="text-ink-soft">{ownerName(task.ownerId)}</span>,
          },
          {
            key: "cycle",
            header: "Ciclo ou marco",
            cell: (task) => (
              <span className="text-muted">
                {cycles.find((c) => c.taskIds.includes(task.id))?.name ??
                  (task.productId
                    ? products.find((p) => p.id === task.productId)?.name
                    : task.milestone
                      ? padMilestone(task.milestone)
                      : "—")}
              </span>
            ),
          },
          {
            key: "evidence",
            header: "Evidência",
            cell: (task) => <EvidenceTag evaluation={evaluate(task)} />,
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            action: true,
            cell: (task) =>
              can("entregas.remover", task.company) && (
                <ActionMenu
                  label={`Ações de ${task.title}`}
                  actions={[{ label: "Excluir tarefa", icon: <Trash2 />, tone: "danger", disabled: operation.busy, onSelect: () => removal.requestRemoval(task) }]}
                />
              ),
          },
        ]}
      />
    </div>
  );
}
