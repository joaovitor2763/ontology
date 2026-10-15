"use client";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { effectiveAssignedMilestone, effectiveAssignedPlanId, effectiveAssignedPlanVersion } from "@/modules/delivery/application/plan-schedule";

import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import {
  latestVersion,
  pinnedJourney,
  type JourneyVersion,
} from "@/modules/catalog/domain/publication";
import {
  DEFAULT_JOURNEY_ID,
  mergeJourneys,
  milestoneByN,
} from "@/modules/catalog/infrastructure/journey";
import type { Company } from "@/modules/clients/domain/models";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useCallback, useMemo } from "react";

export function useCatalog() {
  const s_catalog = useCatalogState();
  const s_delivery = useDeliveryState();
  const { clients, enrollments } = useClientsState();
  const projectedTasks = useMemo(
    () => deliveriesFor(undefined, s_delivery.statusMap, s_delivery.extraTasks, s_delivery.taskPatches),
    [s_delivery.statusMap, s_delivery.extraTasks, s_delivery.taskPatches],
  );
  // Estável por documento: `journeyOf` entra nas dependências de outros memos.
  const journeys = useMemo(() => [
    ...Object.values(s_delivery.productPlans),
    ...mergeJourneys(
      s_catalog.extraJourneys,
      s_catalog.journeyEdits,
      s_catalog.removedJourneys,
    ),
  ], [s_delivery.productPlans, s_catalog.extraJourneys, s_catalog.journeyEdits, s_catalog.removedJourneys]);

  /** Draft head of a plan (what the catalog edits). */
  const headOf = useCallback(
    (id: string): JourneyTemplate | undefined => journeys.find((j) => j.id === id),
    [journeys],
  );
  const versionsOf = useCallback(
    (id: string): JourneyVersion[] => s_catalog.journeyVersions[id] ?? [],
    [s_catalog.journeyVersions],
  );
  /** The plan the client follows: pinned snapshot, else latest published, else the draft. */
  const journeyOf = useCallback((
    c: Pick<Company, "slug" | "journeyId" | "milestone">,
  ): JourneyTemplate => {
    const assignedId = s_delivery.companyJourney[c.slug] ?? c.journeyId;
    const id = effectiveAssignedPlanId(
      { cycles: s_delivery.cycles, tasks: projectedTasks },
      c.slug,
      assignedId,
      enrollments,
    ) ?? DEFAULT_JOURNEY_ID;
    const head = headOf(id) ?? journeys[0];
    return pinnedJourney(
      head,
      versionsOf(head.id),
      effectiveAssignedPlanVersion(assignedId, id, s_delivery.companyJourneyVersion[c.slug]),
    );
  }, [headOf, journeys, versionsOf, s_delivery.companyJourney, s_delivery.companyJourneyVersion, s_delivery.cycles, projectedTasks, enrollments]);
  /** Version a client is effectively on, for badges. */
  function versionOf(c: Pick<Company, "slug" | "journeyId" | "milestone">) {
    const followed = journeyOf(c);
    return (
      followed.version ??
      latestVersion(versionsOf(followed.id))?.version ??
      undefined
    );
  }

  const milestoneOf = useCallback((c: Pick<Company, "slug" | "journeyId" | "milestone">) => {
    const assignedId = s_delivery.companyJourney[c.slug] ?? c.journeyId;
    const j = journeyOf(c);
    const n = effectiveAssignedMilestone(
      assignedId,
      j.id,
      s_delivery.companyMilestone[c.slug] ?? c.milestone,
    );
    const max = j.milestones[j.milestones.length - 1]?.n ?? 1;
    const clamped = Math.min(Math.max(1, n), max);
    return { n: clamped, def: milestoneByN(clamped, j), journey: j };
  }, [journeyOf, s_delivery.companyJourney, s_delivery.companyMilestone]);

  const placed = useMemo(() => clients.map((c) => ({ company: c, ...milestoneOf(c) })), [clients, milestoneOf]);

  return {
    journeys,
    journeyOf,
    milestoneOf,
    placed,
    headOf,
    versionsOf,
    versionOf,
  };
}
