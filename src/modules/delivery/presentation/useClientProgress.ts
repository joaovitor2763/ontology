"use client";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  clientProgress,
  type ClientProgress,
} from "@/modules/delivery/application/progress";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { NOW } from "@/shared/lib/format";
import { useMemo } from "react";

/**
 * The one projection every screen reads for a client. Reference tasks of the
 * client's plan are always included, so overview, plan, execution and portfolio agree.
 */
export function useClientProgress(slug: string): ClientProgress {
  const { statusMap, extraTasks, taskPatches, cycles } = useDeliveryState();
  const { clientBySlug, enrollments } = useClientsState();
  const { journeyOf } = useCatalog();
  const client = clientBySlug(slug);
  const journeyId = client ? journeyOf(client).id : undefined;
  return useMemo(
    () => clientProgress(
      deliveriesFor(slug, statusMap, extraTasks, taskPatches, journeyId),
      cycles.filter((c) => c.company === slug),
      NOW,
      enrollments,
    ),
    [slug, statusMap, extraTasks, taskPatches, journeyId, cycles, enrollments],
  );
}

/** Same projection for every client at once, for home, portfolio and lists. */
export function useAllClientsProgress(): Record<string, ClientProgress> {
  const { statusMap, extraTasks, taskPatches, cycles } = useDeliveryState();
  const { clients, enrollments } = useClientsState();
  const { journeyOf } = useCatalog();
  return useMemo(() => {
    const result: Record<string, ClientProgress> = {};
    for (const client of clients) {
      result[client.slug] = clientProgress(
        deliveriesFor(
          client.slug,
          statusMap,
          extraTasks,
          taskPatches,
          journeyOf(client).id,
        ),
        cycles.filter((c) => c.company === client.slug),
        NOW,
        enrollments,
      );
    }
    return result;
  }, [clients, statusMap, extraTasks, taskPatches, cycles, journeyOf, enrollments]);
}
