"use client";

import type { DeliveryStatus } from '@/modules/delivery/domain/models';
import type { Alert } from '../domain/models';
import { earlyFetch } from '@/shared/infrastructure/early-boot';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AlertTaskPreview = { id: string; company: string; title: string; status: DeliveryStatus };
type Snapshot = { scope: string; data: Alert[] | null; relatedTasks: Record<string, AlertTaskPreview>;
  error: string | null; loading: boolean };

/** A whole queue without the browser's global execution document. */
export function useAlertQueue(company?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    scope: company ?? '', data: null, relatedTasks: {}, error: null, loading: true,
  });
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestNumber.current;
    const scope = company ?? '';
    setSnapshot(previous => previous.scope === scope
      ? { ...previous, loading: previous.data === null }
      : { scope, data: null, relatedTasks: {}, error: null, loading: true });
    try {
      const path = `/api/alerts${company ? `?company=${encodeURIComponent(company)}` : ''}`;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await earlyFetch(path, { cache: 'no-store' });
        if (response.status !== 409) break;
      }
      if (!response?.ok) throw new Error('Não foi possível atualizar os alertas. Tente novamente.');
      const body = await response.json() as { data?: Alert[];
        relatedTasks?: Record<string, AlertTaskPreview> };
      if (!Array.isArray(body.data) || !body.relatedTasks ||
          typeof body.relatedTasks !== 'object')
        throw new Error('A lista de alertas não está disponível.');
      if (current === requestNumber.current)
        setSnapshot({ scope, data: body.data, relatedTasks: body.relatedTasks, error: null, loading: false });
    } catch (error) {
      if (current === requestNumber.current)
        setSnapshot(previous => ({ ...previous, error: error instanceof Error ? error.message :
          'Não foi possível atualizar os alertas.', loading: false }));
    }
  }, [company]);
  useEffect(() => {
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
  }, [refresh]);
  return snapshot.scope === (company ?? '') ? { ...snapshot, retry: refresh } :
    { scope: company ?? '', data: null, relatedTasks: {}, error: null, loading: true, retry: refresh };
}
