"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useAllClientsProgress } from "@/modules/delivery/presentation/useClientProgress";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { deriveAlerts } from "@/modules/workspace/domain/derived-alerts";
import type { Alert, AlertSeverity } from "@/modules/workspace/domain/models";
import { alertsFor } from "@/modules/workspace/infrastructure/queries";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { NOW } from "@/shared/lib/format";
import { useMemo } from "react";

const rank: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Registered alerts plus the ones derived from deliveries, cycles and meetings,
 * minus what was marked as seen. Every screen reads the queue from here.
 */
export function useAlerts(slug?: string) {
  const { hiddenAlerts, alertRules } = useWorkspaceState();
  const { clients } = useClientsState();
  const { cycles } = useDeliveryState();
  const { allMeetings, allHypotheses } = useEngagementState();
  const { contacts } = useStakeholders();
  const progress = useAllClientsProgress();
  const alerts = useMemo(() => {
    const registered: Alert[] = alertsFor(slug, hiddenAlerts).map((a) => ({
      ...a,
      source: "registrado" as const,
    }));
    const scope = slug ? clients.filter((c) => c.slug === slug) : clients;
    const derived = deriveAlerts({
      today: NOW,
      now: NOW,
      clients: scope,
      deliveries: scope.flatMap((c) => progress[c.slug]?.all ?? []),
      cycles: cycles.filter((c) => !slug || c.company === slug),
      meetings: allMeetings,
      hypotheses: allHypotheses,
      stakeholders: contacts,
      rules: alertRules,
    }).filter((a) => !hiddenAlerts.has(a.id));
    return [...registered, ...derived].sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        b.openedAt.localeCompare(a.openedAt),
    );
  }, [
    slug,
    hiddenAlerts,
    alertRules,
    clients,
    cycles,
    allMeetings,
    allHypotheses,
    contacts,
    progress,
  ]);
  return { alerts, count: alerts.length };
}
