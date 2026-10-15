import { playbookDeliveries } from "../../catalog/infrastructure/playbook.ts";
import { companies } from "../../clients/infrastructure/seed.ts";
import { company } from "../../clients/infrastructure/queries.ts";
import type { DeliveryStatus } from "@/modules/delivery/domain/models";
import { deliveries } from "./seed.ts";
import { selectDeliveries } from "../application/deliveries.ts";
export function deliveriesFor(
  slug?: string,
  statusMap?: Record<string, DeliveryStatus>,
  extras?: import("@/modules/delivery/domain/models").Delivery[],
  patches?: Record<
    string,
    Partial<import("@/modules/delivery/domain/models").Delivery>
  >,
  journeyId?: string,
) {
  /** Reference tasks of the client's plan are part of its work in every screen. */
  const resolvedJourney = slug
    ? (journeyId ?? company(slug)?.journeyId)
    : undefined;
  const extra =
    slug && resolvedJourney
      ? playbookDeliveries(slug, company(slug)?.milestone ?? 1, resolvedJourney)
      : !slug ? companies.flatMap(c => playbookDeliveries(c.slug, c.milestone ?? 1, c.journeyId)) : [];
  return selectDeliveries(
    [
      ...deliveries.filter((d) => !slug || d.company === slug),
      ...extra,
      ...(extras ?? []).filter((d) => !slug || d.company === slug),
    ],
    slug,
    statusMap,
    patches,
  ).filter((d) => {
    if (
      resolvedJourney &&
      !d.productId &&
      d.kind !== "request" &&
      (d.journeyId ?? company(d.company)?.journeyId ?? "founding-companies") !==
        resolvedJourney
    )
      return false;
    return true;
  });
}

export function deliveryById(id: string) {
  return deliveries.find((d) => d.id === id);
}
