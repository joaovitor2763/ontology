"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type SetStateAction } from 'react';
import { projectDelivery, type DeliverySnapshot } from './snapshot';
import { loadClientExecutionWorkspace, type ClientExecutionWorkspace } from './client-collection';
import type { Delivery } from '../domain/models';
import type { ServiceCycle } from '../domain/services';

type ActiveWorkspace = Extract<ClientExecutionWorkspace, { mode: 'active' }>;
type ScopedExecution = ActiveWorkspace & {
  company: string;
  setSnapshot: (action: SetStateAction<DeliverySnapshot>) => void;
  refresh: () => Promise<ClientExecutionWorkspace>;
};

const Context = createContext<ScopedExecution | null>(null);

export function useScopedClientExecution() {
  return useContext(Context);
}

function updateVisible<T extends { id: string }>(current: T[], projected: T[]) {
  const byId = new Map(projected.map(row => [row.id, row]));
  return current.map(row => byId.get(row.id) ?? row);
}

/** The active route mounts only after both its raw slice and paginated lists agree. */
export function ClientExecutionProvider({ company, children, loadingFallback, errorFallback }: {
  company: string;
  children: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}) {
  const [workspace, setWorkspace] = useState<ClientExecutionWorkspace | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const optimisticUntil = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    const result = await loadClientExecutionWorkspace(company);
    if (current === sequence.current) {
      setWorkspace(result);
      setError('');
      optimisticUntil.current = 0;
    }
    return result;
  }, [company]);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    void loadClientExecutionWorkspace(company, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || current !== sequence.current) return;
        setWorkspace(result);
        setError('');
      })
      .catch(failure => {
        if (controller.signal.aborted || current !== sequence.current) return;
        setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as tarefas.');
      });
    return () => { controller.abort(); };
  }, [company]);
  useEffect(() => {
    let busy = false;
    const revalidate = () => {
      if (document.visibilityState !== 'visible' || busy ||
          Date.now() < optimisticUntil.current) return;
      busy = true;
      void refresh().catch(() => { /* keep the last complete snapshot */ })
        .finally(() => { busy = false; });
    };
    const onCommitted = () => { void refresh().catch(() => { /* keep the confirmed view */ }); };
    const timer = window.setInterval(revalidate, 30_000);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('ontology:execution-committed', onCommitted);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('ontology:execution-committed', onCommitted);
    };
  }, [refresh]);
  const setSnapshot = useCallback((action: SetStateAction<DeliverySnapshot>) => {
    optimisticUntil.current = Date.now() + 30_000;
    setWorkspace(previous => {
      if (previous?.mode !== 'active') return previous;
      const snapshot = typeof action === 'function' ? action(previous.snapshot) : action;
      const projected = projectDelivery(snapshot, company, snapshot.companyJourney?.[company]);
      return { ...previous, snapshot,
        tasks: updateVisible<Delivery>(previous.tasks, projected.tasks),
        cycles: updateVisible<ServiceCycle>(previous.cycles, projected.cycles) };
    });
  }, [company]);
  const value = useMemo<ScopedExecution | null>(() => workspace?.mode === 'active'
    ? { ...workspace, company, setSnapshot, refresh } : null,
  [workspace, company, setSnapshot, refresh]);
  if (error && !workspace && errorFallback) return errorFallback;
  if (error && !workspace) return (
    <div role="alert" className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-page px-6 text-center text-sm text-rose">
      <p>{error}</p>
      <button type="button" className="rounded-lg border border-line bg-surface px-3 py-2 text-ink"
        onClick={() => void refresh().catch(failure => setError(failure instanceof Error ? failure.message : 'Falha ao carregar.'))}>
        Tentar novamente
      </button>
    </div>
  );
  if (!workspace) return loadingFallback ?? <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-page text-sm text-muted">Carregando tarefas…</div>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
