"use client";

import { loadExecutionBoard, type ActiveExecutionBoard,
  type ExecutionBoardCollection } from '../infrastructure/execution-board-collection';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reads one complete revision and keeps an older complete board during refresh failures.
 * Background revalidation never aborts a read in flight and waits while a command holds the board.
 */
export function useExecutionBoard() {
  const [board, setBoard] = useState<ExecutionBoardCollection | null>(null);
  const [error, setError] = useState('');
  const current = useRef<ExecutionBoardCollection | null>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const inflight = useRef<Promise<ExecutionBoardCollection> | null>(null);
  const holds = useRef(0);
  const read = useCallback(async () => {
    const revision = ++sequence.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const next = await loadExecutionBoard({ signal: controller.signal,
        current: current.current?.mode === 'active' ? current.current : undefined });
      if (revision === sequence.current) {
        current.current = next;
        setBoard(next);
        setError('');
      }
      return next;
    } catch (failure) {
      if (revision === sequence.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as tarefas.');
      throw failure;
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, []);
  /** Explicit reads (commands, forms) restart; the newest gesture must see its own write. */
  const refresh = useCallback(() => {
    const promise = read();
    inflight.current = promise;
    void promise.catch(() => {}).finally(() => { if (inflight.current === promise) inflight.current = null; });
    return promise;
  }, [read]);
  /** Poll, focus and committed events join a read in flight instead of aborting it. */
  const revalidate = useCallback(() => holds.current > 0 ? null
    : inflight.current ?? refresh(), [refresh]);
  /** A command holds the board from its optimistic change until its confirmation read. */
  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => { if (!released) { released = true; holds.current -= 1; } };
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh().catch(() => {}); });
    return () => { cancelled = true; sequence.current += 1; pending.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    let retry = 0;
    const scheduled = () => {
      if (document.visibilityState !== 'visible') return;
      const reading = revalidate();
      /** A failed background read tries again soon instead of waiting the next 30 seconds. */
      void reading?.catch((failure: unknown) => {
        if (failure instanceof Error && failure.name === 'AbortError') return;
        if (!retry) retry = window.setTimeout(() => { retry = 0; scheduled(); }, 5_000);
      });
    };
    const timer = window.setInterval(scheduled, 30_000);
    window.addEventListener('focus', scheduled);
    document.addEventListener('visibilitychange', scheduled);
    window.addEventListener('ontology:execution-committed', scheduled);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(retry);
      window.removeEventListener('focus', scheduled);
      document.removeEventListener('visibilitychange', scheduled);
      window.removeEventListener('ontology:execution-committed', scheduled);
    };
  }, [revalidate]);
  /** A local gesture invalidates any read begun before that gesture. */
  const update = useCallback((change: (previous: ActiveExecutionBoard) => ActiveExecutionBoard) => {
    sequence.current += 1;
    pending.current?.abort();
    if (current.current?.mode === 'active')
      current.current = change(current.current);
    setBoard(current.current);
  }, []);
  return { board, error, loading: board === null && !error, refresh, hold, update };
}
