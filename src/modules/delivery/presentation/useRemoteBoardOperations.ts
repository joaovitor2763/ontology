"use client";

import type { Delivery } from '../domain/models';
import type { ActiveExecutionBoard } from '../infrastructure/execution-board-collection';
import { boardTaskOf } from '../infrastructure/execution-board-wire';
import { executeScopedClientCommand, ScopedCommandError } from '../infrastructure/client-operations';
import { isFinalRefusal, shouldResendMove, taskFailureMessage } from '../application/board-moves';
import { operationAttempt } from '@/shared/infrastructure/operations';
import { notify } from '@/shared/ui/Feedback';
import { useCallback, useEffect, useRef, useState } from 'react';

type Pending = { command: 'tasks.update' | 'tasks.remove'; taskIds: string[]; titles: string[]; patch: Partial<Delivery>; key: string;
  snapshot?: string; company?: string; local: () => void;
  confirmed?: () => void; written: boolean; resent?: boolean };

const FALLBACK = 'Não foi possível salvar. Tente novamente.';

function failureMessage(request: Pick<Pending, 'command' | 'titles' | 'patch'>, cause: string) {
  return request.command === 'tasks.remove'
    ? `«${request.titles.join('», «')}» não foi excluída: ${cause}`
    : taskFailureMessage(request.titles, request.patch, cause);
}

/**
 * One scoped command at a time; an uncertain retry keeps its key and observed revision.
 * Once the server confirms the write, the confirmation read is best effort: its failure
 * keeps the saved task and the next revalidation reconciles the board.
 */
export function useRemoteBoardOperations(board: ActiveExecutionBoard,
  update: (change: (previous: ActiveExecutionBoard) => ActiveExecutionBoard) => void,
  refresh: () => Promise<unknown>, hold: () => () => void = () => () => {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Only an uncertain write blocks the next gesture; a refusal was already undone. */
  const [blocking, setBlocking] = useState(false);
  const locked = useRef(false);
  const pending = useRef<Pending | null>(null);
  const boardRef = useRef(board);
  const snapshots = useRef(board.clientSnapshots);
  useEffect(() => {
    boardRef.current = board;
    snapshots.current = board.clientSnapshots;
  }, [board]);
  const patchTask = useCallback((id: string, patch: Partial<Delivery>) => {
    update(previous => ({ ...previous, tasks: previous.tasks.map(task =>
      task.id === id ? { ...task, ...patch } : task) }));
  }, [update]);
  const replaceTasks = useCallback((rows: readonly Delivery[]) => {
    if (!rows.length) return;
    const replacements = new Map(rows.map(task => [task.id, task]));
    update(current => ({ ...current, tasks: current.tasks.map(row =>
      replacements.get(row.id) ?? row) }));
  }, [update]);
  /** Reads a fresh board and returns what it says for the given tasks and client. */
  const reread = useCallback(async (request: Pending) => {
    const next = await refresh();
    const fresh = next && typeof next === 'object' && 'mode' in next && next.mode === 'active'
      ? next as ActiveExecutionBoard : boardRef.current;
    if (fresh !== boardRef.current) {
      boardRef.current = fresh;
      snapshots.current = fresh.clientSnapshots;
    }
    const ids = new Set(request.taskIds);
    return { snapshot: request.company ? fresh.clientSnapshots[request.company] : undefined,
      tasks: fresh.tasks.filter(task => ids.has(task.id)) };
  }, [refresh]);

  const attempt = useCallback(async (request: Pending) => {
    if (locked.current) {
      notify(failureMessage(request, 'outra alteração ainda está sendo salva. Tente de novo em instantes.'));
      return false;
    }
    locked.current = true;
    const release = hold();
    setBusy(true);
    setError('');
    setBlocking(false);
    let previous: Delivery[] = [];
    try {
      if (!request.written) {
        const ids = new Set(request.taskIds);
        previous = boardRef.current.tasks.filter(task => ids.has(task.id));
        if (request.command !== 'tasks.remove') request.local();
        const input = request.command === 'tasks.remove' ? { taskId: request.taskIds[0] } : request.taskIds.length === 1
          ? { taskId: request.taskIds[0], patch: request.patch }
          : { taskIds: request.taskIds, patch: request.patch };
        const send = () => executeScopedClientCommand<{ task?: Delivery; tasks?: Delivery[] }>(
          request.command, input, request.key, request.snapshot);
        let result: Awaited<ReturnType<typeof send>>;
        try {
          result = await send();
        } catch (failure) {
          if (request.command !== 'tasks.update' || !(failure instanceof ScopedCommandError) ||
            !shouldResendMove(failure, request.patch, Boolean(request.resent))) throw failure;
          /** Another write moved the client ahead: re-read it and resend the same status once. */
          request.resent = true;
          const fresh = await reread(request).catch(() => null);
          if (!fresh?.snapshot || fresh.tasks.length !== request.taskIds.length) throw failure;
          previous = fresh.tasks;
          request.snapshot = fresh.snapshot;
          request.key = operationAttempt('tasks.update', input).key;
          request.local();
          result = await send();
        }
        request.written = true;
        if (result.clientSnapshot && request.company) {
          const company = request.company;
          snapshots.current = { ...snapshots.current, [company]: result.clientSnapshot };
          update(current => ({ ...current,
            clientSnapshots: { ...current.clientSnapshots, [company]: result.clientSnapshot! },
          }));
        }
        if (request.command === 'tasks.remove') {
          const removed = request.taskIds[0];
          update(current => ({ ...current, tasks: current.tasks.filter(task => task.id !== removed),
            referenceTasks: current.referenceTasks.filter(task => task.id !== removed),
            cycles: current.cycles.map(cycle => ({ ...cycle, taskIds: cycle.taskIds.filter(id => id !== removed) })),
          }));
        }
        const saved = result.data.tasks ?? (result.data.task ? [result.data.task] : []);
        // O quadro guarda só os campos que lê; a próxima leitura traz o mesmo recorte.
        replaceTasks(saved.map(value => boardTaskOf(value) as Delivery));
      }
      /** The write is confirmed; a failed or superseded read must not undo nor block it. */
      await refresh().catch(() => {});
      pending.current = null;
      request.confirmed?.();
      notify(request.command === 'tasks.remove' ? 'Tarefa excluída' : 'Tarefa atualizada');
      return true;
    } catch (failure) {
      if (!request.written) replaceTasks(previous);
      const cause = failure instanceof Error && failure.message ? failure.message : FALLBACK;
      const refused = failure instanceof ScopedCommandError && isFinalRefusal(failure);
      if (refused) {
        pending.current = null;
        if (failure.code === 'snapshot_changed') void refresh().catch(() => {});
      }
      setBlocking(!refused);
      setError(failureMessage(request, cause));
      return false;
    } finally {
      locked.current = false;
      release();
      setBusy(false);
    }
  }, [hold, refresh, replaceTasks, reread, update]);

  const run = useCallback(async (command: 'tasks.update' | 'tasks.remove', input: unknown,
    local: () => void, confirmed?: () => void) => {
    if (!input || typeof input !== 'object') return false;
    if (command === 'tasks.update' && (!('patch' in input) || !input.patch || typeof input.patch !== 'object')) return false;
    const ids = 'taskIds' in input && Array.isArray(input.taskIds)
      ? input.taskIds : 'taskId' in input ? [input.taskId] : [];
    if (ids.length > 500) {
      notify('Selecione até 500 tarefas por vez para alterar em lote.');
      return false;
    }
    if (!ids.length || ids.some(id => typeof id !== 'string') ||
      new Set(ids).size !== ids.length) return false;
    const wanted = new Set(ids as string[]);
    const tasks = boardRef.current.tasks.filter(row => wanted.has(row.id));
    const patch = command === 'tasks.update' && 'patch' in input ? structuredClone(input.patch) as Partial<Delivery> : {};
    const titles = tasks.map(task => task.title);
    const refuse = (cause: string) => { notify(failureMessage({ command, titles, patch }, cause)); return false; };
    if (tasks.length !== ids.length) return refuse('a tarefa não está mais no quadro. Atualize a página.');
    if (pending.current) return refuse(`resolva antes a falha pendente. ${error}`.trim());
    if (locked.current) return refuse('outra alteração ainda está sendo salva. Tente de novo em instantes.');
    const companies = new Set(tasks.map(task => task.company));
    const company = companies.size === 1 ? tasks[0].company : undefined;
    const snapshot = company ? snapshots.current[company] : undefined;
    if (company && !snapshot) {
      void refresh().catch(() => {});
      return refuse('o quadro ainda está carregando este cliente. Tente de novo em instantes.');
    }
    const taskIds = ids as string[];
    if (command === 'tasks.remove' && taskIds.length !== 1) return false;
    const commandInput = command === 'tasks.remove' ? { taskId: taskIds[0] } : taskIds.length === 1
      ? { taskId: taskIds[0], patch } : { taskIds, patch };
    const key = operationAttempt(command, commandInput).key;
    const request = { command, taskIds, titles, patch, key, snapshot, company, local, confirmed, written: false };
    pending.current = request;
    return attempt(request);
  }, [attempt, error, refresh]);
  const retry = useCallback(async () => {
    if (pending.current) return attempt(pending.current);
    setError('');
    setBlocking(false);
    await refresh().catch(() => {});
    return true;
  }, [attempt, refresh]);
  return { busy, error, blocking, run, retry, patchTask };
}
