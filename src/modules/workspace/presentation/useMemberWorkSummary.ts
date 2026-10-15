"use client";

import type { MemberWorkSummary } from '@/modules/clients/domain/portfolio-summary';
import { useDocumentHydrated, useSyncStatus } from '@/shared/infrastructure/useLocalStorageState';
import { useCallback, useEffect, useRef, useState } from 'react';

type Snapshot = { scope: string; data: MemberWorkSummary | null;
  error: string | null; loading: boolean };

/** Member details derived from client execution slices, without browser global state. */
export function useMemberWorkSummary(memberId: string, refreshOn: unknown) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: memberId, data: null,
    error: null, loading: true });
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestNumber.current;
    setSnapshot(previous => previous.scope === memberId
      ? { ...previous, loading: previous.data === null }
      : { scope: memberId, data: null, error: null, loading: true });
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(`/api/portfolio?member=${encodeURIComponent(memberId)}`, { cache: 'no-store' });
        if (response.status !== 409) break;
      }
      if (!response?.ok) throw new Error('Não foi possível atualizar o trabalho deste membro. Tente novamente.');
      const body = await response.json() as { member?: MemberWorkSummary };
      if (!body.member || !Array.isArray(body.member.tasks) || !Array.isArray(body.member.alerts))
        throw new Error('O trabalho deste membro não está disponível.');
      if (current === requestNumber.current)
        setSnapshot({ scope: memberId, data: body.member, error: null, loading: false });
    } catch (error) {
      if (current === requestNumber.current)
        setSnapshot(previous => ({ ...previous, error: error instanceof Error ? error.message :
          'Não foi possível atualizar o trabalho deste membro.', loading: false }));
    }
  }, [memberId]);
  // The first read waits for the clients document: its hydration changes
  // `refreshOn` right after mount and would otherwise repeat the whole read.
  const clientsReady = useDocumentHydrated('ontology.clients.v3');
  const { error: syncError } = useSyncStatus();
  const ready = clientsReady || Boolean(syncError);
  useEffect(() => {
    if (!ready) return;
    void refresh();
    const onFocus = () => void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('ontology:execution-committed', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      requestNumber.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('ontology:execution-committed', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, refreshOn, ready]);
  return snapshot.scope === memberId ? { ...snapshot, retry: refresh } :
    { scope: memberId, data: null, error: null, loading: true, retry: refresh };
}
