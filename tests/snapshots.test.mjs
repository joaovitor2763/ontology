import test from "node:test";
import assert from "node:assert/strict";
import { CLIENTS_INITIAL, normalizeClientsSnapshot, projectClients } from "../src/modules/clients/infrastructure/snapshot.ts";
import { CATALOG_INITIAL, projectCatalog, resolveClientJourney } from "../src/modules/catalog/infrastructure/snapshot.ts";
import { DELIVERY_INITIAL, projectDelivery } from "../src/modules/delivery/infrastructure/snapshot.ts";
import { projectStakeholders } from "../src/modules/clients/infrastructure/stakeholders-snapshot.ts";
import { migrateAllocationScopes, migrateClientEnrollments, migrateRoleCatalogs } from "../src/shared/infrastructure/migration.ts";

test("effective client snapshot preserves seeds, patches, archives, allocations and configuration", () => {
  const seed = projectClients().clients[0];
  const state = normalizeClientsSnapshot({ clientEdits: { [seed.slug]: { name: "Alterado" } }, archivedClients: [seed.slug], assignments: { [seed.slug]: { leadId: "new-lead", csId: "new-cs" } } });
  const result = projectClients(state);
  assert.equal(result.allClients.find(c => c.slug === seed.slug).name, "Alterado");
  assert.equal(result.clients.some(c => c.slug === seed.slug), false);
  assert.equal(result.assigned(seed).leadId, "new-lead");
  assert.ok(result.configFor(seed.slug).productIds.length);
  assert.equal(CLIENTS_INITIAL.archivedClients.length, 0);
});

test("new relationship migration never infers purchases or drops existing links", () => {
  const legacy = { configs: { acme: { productIds: ["p"] } } };
  const migrated = migrateClientEnrollments(legacy);
  assert.deepEqual(migrated.enrollments, []);
  assert.deepEqual(migrated.participations, []);
  const existing = { ...migrated, enrollments: [{ id: "e" }], participations: [{ id: "p" }] };
  assert.deepEqual(migrateClientEnrollments(existing), {...existing,enrollments:[{id:"e",milestoneHistory:[],lifecycleHistory:[]}]});
  const advanced={...existing,enrollments:[{id:"e",milestone:3,milestoneHistory:[{from:2,to:3,by:"admin",at:"2026-09-17",pendingTaskIds:[]}]}]};
  assert.deepEqual(migrateClientEnrollments(advanced),{...advanced,enrollments:[{...advanced.enrollments[0],lifecycleHistory:[]}]});
  assert.equal(migrateClientEnrollments(existing).enrollments[0].milestone,undefined);
  assert.equal(legacy.enrollments, undefined);
});

test("role and allocation scope migration keeps old data client-wide", () => {
  assert.deepEqual(migrateRoleCatalogs({ extraMembers: [] }), { extraMembers: [], memberRoles: [], allocationRoles: [] });
  const scoped = migrateAllocationScopes({ allocations: [{ id: "a", company: "c", memberId: "m", role: "consultor", enrollmentId: "", percent: 10 }] });
  assert.equal(scoped.allocations[0].enrollmentId, undefined);
  assert.equal(migrateAllocationScopes(scoped), scoped);
});

test("catalog projection and client plan respect edits, private plans and published pins", () => {
  const product = projectCatalog().products[0];
  assert.equal(projectCatalog({ productEdits: { [product.id]: { ...product, name: "Alterado" } } }).products[0].name, "Alterado");
  const plan = { id: "private", name: "Head", milestones: [], description: "" };
  const catalog = { ...CATALOG_INITIAL, journeyVersions: { private: [{ version: 1, snapshot: { ...plan, name: "Pinned" } }] } };
  const delivery = { ...DELIVERY_INITIAL, productPlans: { private: plan }, companyJourney: { acme: "private" }, companyJourneyVersion: { acme: 1 } };
  assert.equal(resolveClientJourney(catalog, delivery, { slug: "acme", journeyId: "" }).name, "Pinned");
});

test("execution projection overlays status/patches and excludes removed cycles", () => {
  const seed = projectDelivery().tasks[0];
  const state = { statusMap: { [seed.id]: "bloqueado" }, taskPatches: { [seed.id]: { title: "Editado" } }, extraCycles: [{ id: "removed", company: seed.company, startsAt: "2026-01-01", removed: true }] };
  const projected = projectDelivery(state);
  assert.equal(projected.tasks.find(t => t.id === seed.id).title, "Editado");
  assert.equal(projected.tasks.find(t => t.id === seed.id).status, "bloqueado");
  assert.equal(projected.cycles.some(c => c.id === "removed"), false);
  assert.ok(projectStakeholders().length > 0);
  assert.equal(projectStakeholders({ contacts: [] }).length, 0, "explicitly removed contacts must not be seeded again");
});
