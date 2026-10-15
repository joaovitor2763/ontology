"use client";
import { nextOpenTask } from "@/modules/delivery/application/progress";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { usePortfolioSummary } from "../usePortfolioSummary";
import type { PortfolioSummary } from "../../domain/portfolio-summary";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { primaryAlertFor } from "@/modules/workspace/domain/derived-alerts";
import { useAllClientsHealth } from "@/modules/clients/presentation/useClientHealth";
import { useAllClientsProgress } from "@/modules/delivery/presentation/useClientProgress";
import { NOW } from "@/shared/lib/format";
import { Page } from "@/shared/ui/primitives";
import { ClientesContent } from "./ClientesContent";

export default function ClientesScreen() {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <Page><p className="py-8 text-sm text-muted">Carregando clientes…</p></Page>;
  return mode === "remote" ? <RemoteClientesScreen /> : <LocalClientesScreen />;
}

function RemoteClientesScreen() {
  const { clients } = useClientsState();
  const { data, error, loading, retry } = usePortfolioSummary(clients);
  return <ClientesContent summary={data} summaryError={error} summaryLoading={loading} retrySummary={retry} />;
}

function LocalClientesScreen() {
  const { clients, allClients } = useClientsState();
  const { alerts } = useAlerts();
  const progress = useAllClientsProgress();
  const healthOf = useAllClientsHealth();
  const { cycles } = useDeliveryState();
  const activeSlugs = new Set(clients.map(client => client.slug));
  const summary: PortfolioSummary = Object.fromEntries(allClients.map(client => {
    const p = progress[client.slug];
    const next = nextOpenTask(p?.open ?? []);
    const primary = primaryAlertFor(client.slug, alerts, {
      today: NOW, health: healthOf[client.slug],
      nextStep: next ? { text: next.title, dueAt: next.dueAt } : null,
    });
    const cycle = cycles.find(row => row.company === client.slug && !row.removed &&
      (row.status === "em-curso" || row.status === "em-aceite"));
    return [client.slug, {
      planned: p?.planned.length ?? 0, done: p?.done.length ?? 0, percent: p?.percent ?? 0,
      nextTask: next ? { title: next.title, dueAt: next.dueAt } : null,
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
      health: activeSlugs.has(client.slug) ? healthOf[client.slug] : null,
      alertCount: alerts.filter(alert => alert.company === client.slug).length,
      primary: primary ? { kind: primary.kind, severity: primary.severity,
        title: primary.title, action: primary.action } : null,
    }];
  }));
  return <ClientesContent summary={summary} summaryError={null} summaryLoading={false} retrySummary={() => {}} />;
}
