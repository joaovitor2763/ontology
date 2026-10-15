"use client";
import { useEffect, useRef, useState } from "react";
import { deliveryOperationBaseline, operationAttempt } from "@/shared/infrastructure/operations";
import { useConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { notify } from "@/shared/ui/Feedback";
import { useScopedClientExecution } from '../infrastructure/ClientExecutionProvider';
import type { DeliverySnapshot } from '../infrastructure/snapshot';
import { executeScopedClientCommand, ScopedCommandError } from '../infrastructure/client-operations';
import { isFinalRefusal, shouldResendMove, taskFailureMessage } from '../application/board-moves';

type TaskCommand = "tasks.remove" | "tasks.update" | "tasks.comment" | "tasks.checklist" | "tasks.blocker";
/**
 * Edição de tarefa aplicada na hora e confirmada em seguida: o card muda de
 * coluna, o checklist marca e o comentário aparece antes da resposta; a falha
 * desfaz a alteração e deixa o retry com a mesma chave de idempotência.
 */
export function useTaskOperations(onPendingChange?: (pending: boolean) => void) {
  const scoped = useScopedClientExecution();
  const operation = useConfirmedOperation({
    baseline: deliveryOperationBaseline,
    optimistic: ["tasks.update", "tasks.comment", "tasks.checklist", "tasks.blocker"],
    replacePending: true,
    fallback: "Não foi possível salvar. Tente novamente.",
  });
  const [scopedBusy, setScopedBusy] = useState(false);
  const [scopedError, setScopedError] = useState('');
  const [scopedBlocking, setScopedBlocking] = useState(false);
  const locked = useRef(false);
  const marker = useRef(scoped?.clientSnapshot);
  const confirmedSnapshot = useRef<DeliverySnapshot | undefined>(scoped?.snapshot);
  const pending = useRef<{
    command: TaskCommand; input: unknown; local: () => void; confirmed?: () => void;
    key: string; written?: boolean; resent?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!scoped || locked.current) return;
    marker.current = scoped.clientSnapshot;
    confirmedSnapshot.current = scoped.snapshot;
  }, [scoped]);
  const report = useRef(onPendingChange);
  useEffect(() => {
    report.current = onPendingChange;
  }, [onPendingChange]);
  useEffect(() => {
    report.current?.(scoped ? scopedBusy : operation.busy);
  }, [operation.busy, scoped, scopedBusy]);

  /** Names the task in a tasks.update failure; other commands keep the server's text. */
  function failureText(request: NonNullable<typeof pending.current>, cause: string) {
    const input = request.input as { taskId?: unknown; taskIds?: unknown; patch?: unknown };
    if (request.command !== 'tasks.update' || !input?.patch || typeof input.patch !== 'object') return cause;
    const ids = new Set(Array.isArray(input.taskIds) ? input.taskIds : [input.taskId]);
    const titles = (scoped?.tasks ?? []).filter(task => ids.has(task.id)).map(task => task.title);
    return taskFailureMessage(titles, input.patch, cause);
  }
  async function reread() {
    if (!scoped) return false;
    const fresh = await scoped.refresh();
    if (fresh.mode !== 'active') return false;
    marker.current = fresh.clientSnapshot;
    confirmedSnapshot.current = fresh.snapshot;
    return true;
  }
  async function runScoped(request: NonNullable<typeof pending.current>) {
    if (!scoped || locked.current) return false;
    locked.current = true;
    setScopedBusy(true);
    setScopedError('');
    setScopedBlocking(false);
    let before = confirmedSnapshot.current ?? scoped.snapshot;
    try {
      if (!request.written) {
        if (request.command !== 'tasks.remove') request.local();
        const send = () => executeScopedClientCommand(request.command, request.input,
          request.key, marker.current ?? scoped.clientSnapshot);
        let result: Awaited<ReturnType<typeof send>>;
        try {
          result = await send();
        } catch (failure) {
          const patch = (request.input as { patch?: unknown })?.patch;
          if (request.command !== 'tasks.update' || !patch || typeof patch !== 'object' ||
            !(failure instanceof ScopedCommandError) ||
            !shouldResendMove(failure, patch, Boolean(request.resent))) throw failure;
          /** Another write moved the client ahead: re-read it and resend the same status once. */
          request.resent = true;
          if (!await reread().catch(() => false)) throw failure;
          before = confirmedSnapshot.current ?? before;
          request.key = operationAttempt(request.command, request.input).key;
          request.local();
          result = await send();
        }
        request.written = true;
        if (result.clientSnapshot) marker.current = result.clientSnapshot;
      }
      /** The write is confirmed; a failed read keeps it and the next revalidation reconciles. */
      await reread().catch(() => false);
      request.confirmed?.();
      pending.current = null;
      notify(request.command === 'tasks.remove' ? 'Tarefa excluída' : 'Tarefa atualizada');
      return true;
    } catch (failure) {
      if (!request.written) scoped.setSnapshot(before);
      const refused = failure instanceof ScopedCommandError && isFinalRefusal(failure);
      if (refused) pending.current = null;
      if (refused && failure.code === 'snapshot_changed')
        await reread().catch(() => false);
      setScopedBlocking(!refused);
      setScopedError(failureText(request, failure instanceof Error && failure.message
        ? failure.message : 'Não foi possível salvar. Tente novamente.'));
      return false;
    } finally {
      locked.current = false;
      setScopedBusy(false);
    }
  }
  async function run(command: TaskCommand, input: unknown, local: () => void, confirmed?: () => void) {
    if (scoped) {
      /** An unsent failed intent may be replaced; a confirmed write never stays pending. */
      if (locked.current || pending.current?.written) {
        notify(failureText({ command, input, local, key: '' },
          'outra alteração ainda está sendo salva. Tente de novo em instantes.'));
        return false;
      }
      const body = structuredClone(input);
      pending.current = { command, input: body, local, confirmed,
        key: operationAttempt(command, body).key };
      return runScoped(pending.current);
    }
    const message = await operation.run(command, input, local, confirmed);
    if (!message) notify(command === "tasks.remove" ? "Tarefa excluída" : "Tarefa atualizada");
    return message === "";
  }
  return { busy: scoped ? scopedBusy : operation.busy,
    error: scoped ? scopedError : operation.error,
    blocking: scoped ? scopedBlocking : Boolean(operation.error), run,
    retry: scoped ? async () => pending.current ? runScoped(pending.current) : false : operation.retry };
}
