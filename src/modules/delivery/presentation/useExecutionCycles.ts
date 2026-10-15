"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadExecutionCycles, type ExecutionCyclesCollection } from '../infrastructure/execution-cycles-collection';

export function useExecutionCycles() {
  const [collection, setCollection] = useState<ExecutionCyclesCollection | null>(null);
  const [error, setError] = useState('');
  const current = useRef<ExecutionCyclesCollection | null>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const revision = ++sequence.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const next = await loadExecutionCycles({ signal: controller.signal,
        current: current.current?.mode === 'active' ? current.current : undefined });
      if (revision === sequence.current) {
        current.current = next;
        setCollection(next);
        setError('');
      }
      return next;
    } catch (failure) {
      if (revision === sequence.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Não foi possível carregar os ciclos.');
      throw failure;
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh().catch(() => {}); });
    return () => { cancelled = true; sequence.current += 1; pending.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    let running = false;
    const revalidate = () => {
      if (document.visibilityState !== 'visible' || running) return;
      running = true;
      void refresh().catch(() => {}).finally(() => { running = false; });
    };
    const timer = window.setInterval(revalidate, 30_000);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('ontology:execution-committed', revalidate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('ontology:execution-committed', revalidate);
    };
  }, [refresh]);
  return { collection, error, refresh };
}
