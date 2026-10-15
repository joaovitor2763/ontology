import type { ProductVersion } from "../domain/product-versions.ts";
import type { Product } from "../domain/products.ts";
import type { JourneyTemplate } from "../domain/models.ts";
import { pinnedJourney, type JourneyVersion } from "../domain/publication.ts";
import { mergeJourneys, DEFAULT_JOURNEY_ID } from "./journey.ts";
import { seedProducts } from "./products.ts";
import { mergeLegacy, migrateProductMilestones, migrateProductVersions } from "../../../shared/infrastructure/migration.ts";
import type { Company } from "../../clients/domain/models.ts";
import type { DeliverySnapshot } from "../../delivery/infrastructure/snapshot.ts";
export type CatalogSnapshot = {
  productVersions: Record<string, ProductVersion[]>;
  productEdits: Record<string, Product>;
  extraProducts: Product[];
  extraJourneys: JourneyTemplate[];
  journeyEdits: Record<string, JourneyTemplate>;
  removedJourneys: string[];
  /** Immutable published snapshots per plan id. */
  journeyVersions: Record<string, JourneyVersion[]>;
};
export const CATALOG_INITIAL: CatalogSnapshot = {
  productVersions: {},
  productEdits: {},
  extraProducts: [],
  extraJourneys: [],
  journeyEdits: {},
  removedJourneys: [],
  journeyVersions: {},
};

export function normalizeCatalogSnapshot(state: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return migrateProductVersions(migrateProductMilestones(mergeLegacy(CATALOG_INITIAL, [state])));
}
export function projectCatalog(raw: Partial<CatalogSnapshot> = {}, productPlans: Record<string, JourneyTemplate> = {}) {
  const state = normalizeCatalogSnapshot(raw);
  return { products: [...seedProducts.map(p => state.productEdits[p.id] ?? p), ...state.extraProducts],
    journeys: [...Object.values(productPlans), ...mergeJourneys(state.extraJourneys, state.journeyEdits, state.removedJourneys)] };
}
export function resolveClientJourney(catalog: CatalogSnapshot, delivery: DeliverySnapshot, company: Pick<Company, "slug" | "journeyId">) {
  const { journeys } = projectCatalog(catalog, delivery.productPlans);
  const id = delivery.companyJourney[company.slug] ?? company.journeyId ?? DEFAULT_JOURNEY_ID;
  const head = journeys.find(j => j.id === id) ?? journeys[0];
  return pinnedJourney(head, catalog.journeyVersions[head.id] ?? [], delivery.companyJourneyVersion[company.slug]);
}
