"use client";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { useAlertAudience } from "@/modules/workspace/presentation/useAlertAudience";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { getAlertCount, refreshAlertCount, subscribeAlertCount } from "@/shared/infrastructure/persistence";

/**
 * O número ao lado de Alertas no menu, entregue a quem desenha o menu.
 *
 * Publicado, ele vem de `GET /api/v1/alerts/count`: o menu está em toda página
 * e derivar a fila no navegador obrigava qualquer tela a hidratar os seis
 * documentos de que os alertas dependem. No modo navegador (sem servidor) não
 * há de onde pedir, e a conta continua sendo a mesma de antes.
 */
export function AlertCount({ children }: { children: (count: number) => ReactNode }) {
  const { mode, resolved, user } = useSyncStatus();
  const remote = resolved && mode === "remote" && !!user;
  return remote ? <RemoteCount>{children}</RemoteCount> : <DerivedCount>{children}</DerivedCount>;
}

/** Modo navegador: a fila é derivada aqui mesmo, com o mesmo recorte do servidor. */
function DerivedCount({ children }: { children: (count: number) => ReactNode }) {
  const { alerts } = useAlerts();
  const audience = useAlertAudience();
  const count = audience ? alerts.filter((a) => audience.has(a.company)).length : alerts.length;
  return <>{children(count)}</>;
}
/**
 * O contador do servidor, da fila de quem pede. Ele chega no bootstrap da
 * página e na revalidação de 30 s do estado (a mesma chamada, `with=alerts`);
 * a leitura própria vem depois de uma ciência confirmada (`alertsAcknowledged`,
 * de `AlertList`) ou quando o arquivo compartilhado `hidden` muda por gesto —
 * não quando ele hidrata.
 */
function RemoteCount({ children }: { children: (count: number) => ReactNode }) {
  const { hiddenAlerts } = useWorkspaceState();
  const { hydrated } = useSyncStatus();
  const count = useSyncExternalStore(subscribeAlertCount, getAlertCount, () => null);
  const seen = hiddenAlerts.size;
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (last.current === null) {
      last.current = seen;
      if (count === null) void refreshAlertCount();
      return;
    }
    if (last.current !== seen) {
      last.current = seen;
      void refreshAlertCount();
    }
  }, [seen, hydrated, count]);
  return <>{children(count ?? 0)}</>;
}
