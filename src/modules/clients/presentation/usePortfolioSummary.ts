"use client";

import type { HomeSummary, PortfolioSummary } from '../domain/portfolio-summary';
import { earlyFetch } from '@/shared/infrastructure/early-boot';
import { coalesced } from '@/shared/infrastructure/coalesce';
import { useDocumentHydrated, useSyncStatus } from '@/shared/infrastructure/useLocalStorageState';
import { useCallback, useEffect, useRef, useState } from 'react';

type Snapshot = { data: PortfolioSummary | null; home: HomeSummary | null; error: string | null; loading: boolean };

/** Small portfolio read, refreshed after local commands, focus and polling. */
export function usePortfolioSummary(refreshOn: unknown) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ data: null, home: null, error: null, loading: true });
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestNumber.current;
    setSnapshot(previous => ({ ...previous, loading: previous.data === null }));
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await earlyFetch('/api/portfolio', { cache: 'no-store' });
        if (response.status !== 409) break;
      }
      if (!response?.ok) throw new Error('Não foi possível atualizar a carteira. Tente novamente.');
      const body = await response.json() as { data?: PortfolioSummary; home?: HomeSummary };
      if (!body.data || typeof body.data !== 'object') throw new Error('A carteira não está disponível.');
      if (current === requestNumber.current)
        setSnapshot({ data: body.data, home: body.home ?? null, error: null, loading: false });
    } catch (error) {
      if (current === requestNumber.current)
        setSnapshot(previous => ({ ...previous, error: error instanceof Error ? error.message :
          'Não foi possível atualizar a carteira.', loading: false }));
    }
  }, []);
  // The first read waits for the clients document: its hydration changes
  // `refreshOn` right after mount and would otherwise repeat the whole read.
  const clientsReady = useDocumentHydrated('ontology.clients.v3');
  const { error: syncError } = useSyncStatus();
  const ready = clientsReady || Boolean(syncError);
  useEffect(() => {
    if (!ready) return;
    // Voltar à aba dispara foco e visibilidade juntos: uma leitura só (também
    // logo depois da primeira). A confirmação de um comando sempre relê.
    const onReturn = coalesced(refresh);
    onReturn();
    const onFocus = () => onReturn();
    const onCommitted = () => void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') onReturn(); };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('ontology:execution-committed', onCommitted);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      requestNumber.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('ontology:execution-committed', onCommitted);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, refreshOn, ready]);
  return { ...snapshot, retry: refresh };
}
