import type { Company } from "../domain/models.ts";
import type { ProductEnrollment } from "../domain/product-enrollments.ts";
import type { ProductStakeholderParticipation } from "../domain/product-stakeholders.ts";
import { assignedFrom, seedAllocations, type Allocation } from "../domain/allocation.ts";
import { defaultService, type ServiceConfig } from "../domain/service-config.ts";
import { companies as seedClients } from "./seed.ts";
import { initialProducts } from "../../catalog/infrastructure/products.ts";
import { serviceConfigs } from "../../delivery/infrastructure/services.ts";
import { mergeLegacy, migrateAllocationScopes, migrateClientIdentity, migrateClientEnrollments } from "../../../shared/infrastructure/migration.ts";
export type ClientsSnapshot = {
  enrollments: ProductEnrollment[];
  participations: ProductStakeholderParticipation[];
  configs: Record<string, ServiceConfig>;
  /** Legacy lead/cs pairs; converted into allocations on first read. */
  assignments: Record<string, { leadId: string; csId: string }>;
  /** Field-level edits over seeded clients, keyed by slug. */
  clientEdits: Record<string, Partial<Company>>;
  /** Clients created in this workspace. */
  extraClients: Company[];
  archivedClients: string[];
  allocations: Allocation[];
  allocationsMigrated: boolean;
};
export const CLIENTS_INITIAL: ClientsSnapshot = {
  enrollments: [],
  participations: [],
  configs: {},
  assignments: {},
  clientEdits: {},
  extraClients: [],
  archivedClients: [],
  allocations: [],
  allocationsMigrated: false,
};

export function normalizeClientsSnapshot(state: Partial<ClientsSnapshot> = {}): ClientsSnapshot {
  return migrateAllocationScopes(migrateClientEnrollments(migrateClientIdentity(mergeLegacy(CLIENTS_INITIAL, [state]))));
}
export function projectClients(raw: Partial<ClientsSnapshot> = {}) {
  const state = normalizeClientsSnapshot(raw);
  const allClients = [...seedClients, ...state.extraClients].map(c => ({ ...c, ...state.clientEdits[c.slug] }));
  const clients = allClients.filter(c => !state.archivedClients.includes(c.slug));
  const allocations = state.allocationsMigrated ? state.allocations : seedAllocations(allClients, state.assignments);
  return { allClients, clients, allocations, enrollments: state.enrollments, participations: state.participations,
    assigned: (c: Pick<Company, "slug" | "leadId" | "csId">) => assignedFrom(allocations, c.slug, c),
    configFor(slug: string): ServiceConfig {
      const seed = serviceConfigs[slug] ?? defaultService, saved = state.configs[slug];
      return { ...seed, ...saved, productIds: saved?.productIds ?? initialProducts[slug] ?? [], modules: { ontology: saved?.modules?.ontology ?? seed.modules.ontology } };
    },
  };
}
