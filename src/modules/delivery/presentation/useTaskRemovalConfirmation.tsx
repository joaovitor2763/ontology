"use client";

import { useState } from "react";
import type { Delivery } from "../domain/models";
import { Modal } from "@/shared/ui/Dialog";
import { Button } from "@/shared/ui/primitives";

export type RemovalOperation = {
  busy: boolean; error: string; blocking?: boolean; retry: () => Promise<unknown>;
  run: (command: "tasks.update" | "tasks.remove", input: unknown, local: () => void,
    confirmed?: () => void) => Promise<boolean>;
};

/** Uses the owning board's command queue and keeps uncertain deletions retryable. */
export function useTaskRemovalConfirmation(operation: RemovalOperation, onRemoved?: (id: string) => void) {
  const [task, setTask] = useState<Delivery | null>(null);
  const close = () => { if (!operation.busy) setTask(null); };
  const remove = async () => {
    if (!task || operation.busy) return;
    if (operation.blocking && operation.error) {
      await operation.retry();
      return;
    }
    await operation.run("tasks.remove", { taskId: task.id }, () => {}, () => {
      onRemoved?.(task.id);
      setTask(null);
    });
  };
  const dialog = <Modal open={Boolean(task)} onClose={close} title="Excluir tarefa?"
    description={`“${task?.title ?? ""}” sairá das listas e do ciclo. O histórico, os logs e os documentos serão preservados.`}
    footer={<><Button variant="ghost" disabled={operation.busy} onClick={close}>Cancelar</Button>
      <Button variant="danger" disabled={operation.busy} onClick={() => void remove()}>
        {operation.busy ? "Excluindo…" : operation.blocking && operation.error ? "Tentar novamente" : "Excluir tarefa"}
      </Button></>}>
    {operation.error && <p role="alert" className="text-sm text-rose">{operation.error}</p>}
  </Modal>;
  return { requestRemoval: setTask, dialog };
}
