"use client";
import {
  operationalHealth,
  type HealthResult,
} from "@/modules/clients/domain/health";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { ClientProgress } from "@/modules/delivery/application/progress";
import {
  useAllClientsProgress,
  useClientProgress,
} from "@/modules/delivery/presentation/useClientProgress";
import type { Alert } from "@/modules/workspace/domain/models";
import { alertsFor } from "@/modules/workspace/infrastructure/queries";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { NOW } from "@/shared/lib/format";

function compute(
  client: { nextMilestone?: string; nextMilestoneAt?: string },
  progress: ClientProgress | undefined,
  registered: Alert[],
): HealthResult {
  const open = progress?.all ?? [];
  const current = progress?.currentCycle;
  return operationalHealth({
    today: NOW,
    openDeliveries: open.map((d) => ({
      id: d.id,
      status: d.status,
      dueAt: d.dueAt,
      priority: d.priority,
      blockers: d.blockers,
      blocker: d.blocker,
    })),
    currentCycle: current
      ? {
          status: current.status,
          endsAt: current.endsAt,
          acceptanceRequestedAt: (
            current as { acceptanceRequestedAt?: string }
          ).acceptanceRequestedAt,
        }
      : null,
    cycles: progress?.cycles,
    nextStep: client.nextMilestone
      ? { text: client.nextMilestone, dueAt: client.nextMilestoneAt || undefined }
      : null,
    openRisks: registered.map((a) => ({ severity: a.severity })),
  });
}

/** Explainable health of one client, from its live deliveries, cycle, next step and alerts. */
export function useClientHealth(slug: string): HealthResult {
  const { clientBySlug } = useClientsState();
  const { hiddenAlerts } = useWorkspaceState();
  const progress = useClientProgress(slug);
  const client = clientBySlug(slug);
  return compute(client ?? {}, progress, alertsFor(slug, hiddenAlerts));
}

/** Same computation for every active client, keyed by slug. */
export function useAllClientsHealth(): Record<string, HealthResult> {
  const { clients } = useClientsState();
  const { hiddenAlerts } = useWorkspaceState();
  const progress = useAllClientsProgress();
  const out: Record<string, HealthResult> = {};
  for (const client of clients)
    out[client.slug] = compute(
      client,
      progress[client.slug],
      alertsFor(client.slug, hiddenAlerts),
    );
  return out;
}
