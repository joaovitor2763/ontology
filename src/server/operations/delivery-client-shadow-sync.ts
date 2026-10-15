import { getDoc } from '../db.ts';
import { encodeCompressedStateBody } from '../state-body.ts';
import { deliveryMapOrder, partitionClientDelivery } from '../delivery-client-slices.ts';
import { reconstructDeliverySnapshot } from '../delivery-records.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { OperationError } from './errors.ts';
import { markSliceWrite } from './delivery-client-summary-sync.ts';
import { clientEffectiveStatements, type ClientEffectiveHead } from './delivery-client-effective-sync.ts';
import { clientPlanClaimStatements, deliveryPlanClaims, type ClientPlanClaimHead } from './delivery-client-plan-claims.ts';
import { clientDeadlineStatements, deliveryDeadlineDependencies, type ClientDeadlineHead } from './delivery-client-deadline-dependencies.ts';

const DELIVERY = 'ontology.delivery.v2', CLIENTS = 'ontology.clients.v3';
type Write = { key: string; value: unknown };
type Meta = { generation: string; mode: string; source_delivery_version: number;
  source_clients_version: number; expected_clients: number; expected_owners: number;
  expected_array_order: number; expected_map_order: number; compatibility_version: number };
const hash = async (body: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
function view(raw: unknown, clientRaw: unknown) {
  const clients = projectClients(clientRaw ?? {});
  const partition = partitionClientDelivery(raw as object, clients.enrollments);
  const slices = new Map(partition.slices.map(row => [row.company, row.snapshot]));
  const effective = projectDelivery(raw as object);
  const owners = new Map([
    ...effective.tasks.map(task => [`task\u0000${task.id}`, task.company] as const),
    ...effective.cycles.map(cycle => [`cycle\u0000${cycle.id}`, cycle.company] as const),
  ]);
  const order = new Map(partition.slices.flatMap(slice => slice.records
    .filter(row => row.kind === 'extraTasks' || row.kind === 'extraCycles')
    .map(row => [`${row.kind}\u0000${row.id}`, { ordinal: row.ordinal!, company: slice.company }] as const)));
  const companies = new Set([...clients.allClients.map(client => client.slug), ...slices.keys(), ...owners.values()]);
  return { slices, owners, order, mapOrder: deliveryMapOrder(raw as object),
    companies, orphans: partition.unassigned, sharedPlans: partition.sharedPlanIds };
}

/** Para quem pede (`plans.publish`), acima deste número de fatias alteradas num
 * commit nenhuma página efetiva é sincronizada: o orçamento vai para fatias, reivindicações e prazos de todos os
 * clientes em vez de avançar só as páginas dos primeiros. As páginas ficam
 * defasadas (leitores por cliente caem na fatia) até o backfill. */
export const EFFECTIVE_SYNC_SLICE_LIMIT = 10;

/** Client fields outside this signature cannot change the delivery partition.
 * Plan claims are sets because duplicate purchases by one client own one plan. */
export function clientOwnership(raw: unknown) {
  const clients = projectClients(raw ?? {});
  return JSON.stringify({
    companies: clients.allClients.map(client => client.slug).sort(),
    plans: [...new Set(clients.enrollments
      .filter(enrollment => enrollment.planId)
      .map(enrollment => `${enrollment.company}\u0000${enrollment.planId}`))].sort(),
  });
}

/** Optional shadow mirror. Never makes the legacy command depend on a stale generation. */
export async function clientShadowStatements(
  db: D1Database, workspace: string, writes: readonly Write[], budget: number,
  mode: 'shadow' | 'active' = 'shadow',
  expectedCompatibility?: number,
  report?: { staleHeads: string[] },
  skipManyEffective = false,
): Promise<D1PreparedStatement[]> {
  if (!writes.some(write => write.key === DELIVERY || write.key === CLIENTS)) return [];
  if (budget < 1) {
    if (mode === 'active') throw new OperationError(503, 'execution_write_too_large',
      'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
    return [];
  }
  const meta = await db.prepare(`SELECT generation,mode,source_delivery_version,source_clients_version,
      expected_clients,expected_owners,expected_array_order,expected_map_order,compatibility_version
    FROM delivery_client_shadow_meta WHERE workspace_id=?`).bind(workspace).first<Meta>();
  if (!meta || meta.mode !== mode) {
    if (mode === 'active') throw new OperationError(409, 'version_conflict',
      'A autoridade da execução mudou. Atualize e tente novamente.');
    return [];
  }
  if (mode === 'active' && expectedCompatibility !== undefined &&
      meta.compatibility_version !== expectedCompatibility)
    throw new OperationError(409, 'version_conflict',
      'A execução mudou. Atualize e tente novamente.');
  const clientWrite = writes.find(write => write.key === CLIENTS);
  if (mode === 'active' && expectedCompatibility !== undefined && clientWrite &&
      !writes.some(write => write.key === DELIVERY)) {
    const current = await getDoc(db, workspace, CLIENTS);
    if (meta.source_clients_version !== (current?.version ?? 0))
      throw new OperationError(409, 'version_conflict',
        'O cadastro mudou. Atualize e tente novamente.');
    if (clientOwnership(current?.value) === clientOwnership(clientWrite.value))
      return [db.prepare(`UPDATE delivery_client_shadow_meta SET
        source_clients_version=source_clients_version+1,
        compatibility_version=compatibility_version+1,updated_at=?
        WHERE workspace_id=? AND generation=? AND mode='active'
          AND source_clients_version=? AND compatibility_version=?`)
        .bind(new Date().toISOString(), workspace, meta.generation,
          meta.source_clients_version, meta.compatibility_version)];
  }
  const deliveryDoc = await getDoc(db, workspace, DELIVERY);
  const clientsDoc = await getDoc(db, workspace, CLIENTS);
  if ((mode === 'active'
      ? meta.compatibility_version !== (deliveryDoc?.version ?? 0)
      : meta.source_delivery_version !== (deliveryDoc?.version ?? 0)) ||
      meta.source_clients_version !== (clientsDoc?.version ?? 0)) {
    if (mode === 'active') throw new OperationError(409, 'version_conflict',
      'A execução ou o cadastro mudou. Atualize e tente novamente.');
    return [];
  }
  const nextDelivery = writes.find(write => write.key === DELIVERY)?.value ?? deliveryDoc?.value ?? {};
  const nextClients = writes.find(write => write.key === CLIENTS)?.value ?? clientsDoc?.value ?? {};
  const before = view(deliveryDoc?.value ?? {}, clientsDoc?.value ?? {});
  const after = view(nextDelivery, nextClients);
  const [revisions, effectiveHeads, claimHeads, claimRows, deadlineHeads, deadlineRows] = mode === 'active' ? await Promise.all([
    db.prepare(`SELECT company,revision,incarnation FROM delivery_client_snapshots
      WHERE workspace_id=? AND generation=?`).bind(workspace, meta.generation)
      .all<{ company: string; revision: number; incarnation: string }>(),
    db.prepare(`SELECT company,authority_generation,source_revision,source_incarnation,projection_generation,
        expected_tasks,expected_cycles FROM delivery_client_effective_heads
      WHERE workspace_id=? AND authority_generation=?`).bind(workspace, meta.generation)
      .all<ClientEffectiveHead & { company: string }>(),
    db.prepare(`SELECT h.company,h.authority_generation,h.source_revision,h.source_incarnation,
        h.projection_generation,h.expected_claims,
        (SELECT COUNT(*) FROM delivery_client_plan_claims p
          WHERE p.workspace_id=h.workspace_id AND p.projection_generation=h.projection_generation
            AND p.company=h.company) AS actual_claims
      FROM delivery_client_plan_claim_heads h
      WHERE h.workspace_id=? AND h.authority_generation=?`).bind(workspace, meta.generation)
      .all<ClientPlanClaimHead & { company: string }>(),
    db.prepare(`SELECT p.company,p.plan_id FROM delivery_client_plan_claim_heads h
      JOIN delivery_client_plan_claims p ON p.workspace_id=h.workspace_id
        AND p.company=h.company AND p.projection_generation=h.projection_generation
      WHERE h.workspace_id=? AND h.authority_generation=?`)
      .bind(workspace, meta.generation).all<{ company: string; plan_id: string }>(),
    db.prepare(`SELECT h.company,h.authority_generation,h.source_revision,h.source_incarnation,
        h.projection_generation,h.expected_dependencies,
        (SELECT COUNT(*) FROM delivery_client_deadline_dependencies d
          WHERE d.workspace_id=h.workspace_id AND d.projection_generation=h.projection_generation
            AND d.company=h.company) AS actual_dependencies
      FROM delivery_client_deadline_heads h
      WHERE h.workspace_id=? AND h.authority_generation=?`)
      .bind(workspace, meta.generation).all<ClientDeadlineHead & { company: string }>(),
    db.prepare(`SELECT d.company,d.source_task_id,d.target_task_id
      FROM delivery_client_deadline_heads h
      JOIN delivery_client_deadline_dependencies d ON d.workspace_id=h.workspace_id
        AND d.company=h.company AND d.projection_generation=h.projection_generation
      WHERE h.workspace_id=? AND h.authority_generation=?`)
      .bind(workspace, meta.generation).all<{
        company: string; source_task_id: string; target_task_id: string }>(),
  ]) : [null, null, null, null, null, null];
  const revisionByClient = new Map(revisions?.results.map(row => [row.company, row]));
  const headByClient = new Map(effectiveHeads?.results.map(row => [row.company, row]));
  const claimHeadByClient = new Map(claimHeads?.results.map(row => [row.company, row]));
  const deadlineHeadByClient = new Map(deadlineHeads?.results.map(row => [row.company, row]));
  const observedDependencies = new Map(deadlineHeads?.results.map(row =>
    [row.company, new Map<string, string>()] as const));
  const observedClaims = new Map(claimHeads?.results.map(row =>
    [row.company, new Set<string>()] as const));
  for (const row of claimRows?.results ?? [])
    observedClaims.get(row.company)?.add(row.plan_id);
  for (const row of deadlineRows?.results ?? [])
    observedDependencies.get(row.company)?.set(row.source_task_id, row.target_task_id);
  // Migration 0035 needs a new validated generation before this writer can mirror it.
  if (meta.expected_map_order !== before.mapOrder.size) {
    if (mode === 'active') throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
    return [];
  }
  // Orphans and shared plans require explicit review before client authority.
  // A new one leaves the marker stale and never silently loses raw data.
  if (before.orphans.length || after.orphans.length || before.sharedPlans.length || after.sharedPlans.length) {
    if (mode === 'active') throw new OperationError(409, 'execution_ownership_ambiguous',
      'A alteração deixou registros sem cliente único. Revise a contratação e tente novamente.');
    return [];
  }
  const statements: D1PreparedStatement[] = [];
  const changedSlices: { company: string; before: object; after: object; revision: number; incarnation: string }[] = [];
  const newSlices: { company: string; after: object; incarnation: string }[] = [];
  for (const company of new Set([...before.companies, ...after.companies])) {
    if (!after.companies.has(company)) {
      statements.push(db.prepare(`DELETE FROM delivery_client_snapshots
        WHERE workspace_id=? AND generation=? AND company=?`)
        .bind(workspace, meta.generation, company));
      statements.push(db.prepare(`DELETE FROM delivery_client_effective_heads
        WHERE workspace_id=? AND company=? AND authority_generation=?`)
        .bind(workspace, company, meta.generation));
      statements.push(db.prepare(`DELETE FROM delivery_client_plan_claim_heads
        WHERE workspace_id=? AND company=? AND authority_generation=?`)
        .bind(workspace, company, meta.generation));
      statements.push(db.prepare(`DELETE FROM delivery_client_deadline_heads
        WHERE workspace_id=? AND company=? AND authority_generation=?`)
        .bind(workspace, company, meta.generation));
      continue;
    }
    const previous = before.slices.get(company) ?? reconstructDeliverySnapshot([], { sparse: true });
    const next = after.slices.get(company) ?? reconstructDeliverySnapshot([], { sparse: true });
    const beforeBody = JSON.stringify(previous), nextBody = JSON.stringify(next);
    if (beforeBody === nextBody && before.companies.has(company)) continue;
    const incarnation = crypto.randomUUID();
    const sliceStatement = db.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,generation,company) DO UPDATE SET
        revision=revision+1,body=excluded.body,body_sha256=excluded.body_sha256`)
      .bind(workspace, meta.generation, company, 1, await encodeCompressedStateBody(next), await hash(nextBody), incarnation);
    const revision = revisionByClient.get(company);
    // Em `active`, o resumo por cliente acompanha a fatia no mesmo lote (`commitOperation`).
    statements.push(mode === 'active' ? markSliceWrite(db, workspace, sliceStatement, { company, generation: meta.generation,
      revision: revision ? revision.revision + 1 : 1, incarnation: revision?.incarnation ?? incarnation,
      plain: nextBody }) : sliceStatement);
    if (mode === 'active' && revision !== undefined)
      changedSlices.push({ company, before: previous, after: next,
        revision: revision.revision, incarnation: revision.incarnation });
    else if (mode === 'active')
      newSlices.push({ company, after: next, incarnation });
  }
  for (const [identity, company] of after.owners) {
    if (before.owners.get(identity) === company) continue;
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
      VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,generation,kind,id)
      DO UPDATE SET company=excluded.company`).bind(workspace, meta.generation, kind, id, company));
  }
  for (const identity of before.owners.keys()) if (!after.owners.has(identity)) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`DELETE FROM delivery_entity_owners
      WHERE workspace_id=? AND generation=? AND kind=? AND id=?`)
      .bind(workspace, meta.generation, kind, id));
  }
  for (const [identity, current] of after.order) {
    const previous = before.order.get(identity);
    if (previous?.ordinal === current.ordinal && previous.company === current.company) continue;
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_client_array_order
      (workspace_id,generation,kind,id,ordinal,company) VALUES(?,?,?,?,?,?)
      ON CONFLICT(workspace_id,generation,kind,id) DO UPDATE SET
        ordinal=excluded.ordinal,company=excluded.company`)
      .bind(workspace, meta.generation, kind, id, current.ordinal, current.company));
  }
  for (const identity of before.order.keys()) if (!after.order.has(identity)) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`DELETE FROM delivery_client_array_order
      WHERE workspace_id=? AND generation=? AND kind=? AND id=?`)
      .bind(workspace, meta.generation, kind, id));
  }
  for (const [identity, ordinal] of after.mapOrder) {
    if (before.mapOrder.get(identity) === ordinal) continue;
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal) VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id,generation,kind,id) DO UPDATE SET ordinal=excluded.ordinal`)
      .bind(workspace, meta.generation, kind, id, ordinal));
  }
  for (const identity of before.mapOrder.keys()) if (!after.mapOrder.has(identity)) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`DELETE FROM delivery_client_map_order
      WHERE workspace_id=? AND generation=? AND kind=? AND id=?`)
      .bind(workspace, meta.generation, kind, id));
  }
  if (statements.length + 1 > budget) {
    if (mode === 'active') throw new OperationError(503, 'execution_write_too_large',
      'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
    return [];
  }
  const syncEffective = !skipManyEffective || changedSlices.length <= EFFECTIVE_SYNC_SLICE_LIMIT;
  const staleHeads: string[] = [];
  if (mode === 'active') for (const slice of changedSlices) {
    const claimBudget = Math.max(0, Math.min(200, budget - statements.length - 1));
    statements.push(...clientPlanClaimStatements(db, workspace, slice.company,
      meta.generation, slice.revision, slice.incarnation, slice.before, slice.after,
      claimHeadByClient.get(slice.company) ?? null, claimBudget,
      observedClaims.get(slice.company)));
    const deadlineBudget = Math.max(0, Math.min(200, budget - statements.length - 1));
    statements.push(...clientDeadlineStatements(db, workspace, slice.company,
      meta.generation, slice.revision, slice.incarnation, slice.before, slice.after,
      deadlineHeadByClient.get(slice.company) ?? null, deadlineBudget,
      observedDependencies.get(slice.company)));
    const available = Math.max(0, Math.min(400, budget - statements.length - 1));
    const head = headByClient.get(slice.company) ?? null;
    const effective = syncEffective ? clientEffectiveStatements(db, workspace, slice.company,
      meta.generation, slice.revision, slice.incarnation, slice.before, slice.after,
      head, available) : [];
    // Only a head that was current before this commit is reported: it became
    // stale here, by the skip above or by the budget.
    if (!effective.length && head?.source_revision === slice.revision &&
        head.source_incarnation === slice.incarnation) staleHeads.push(slice.company);
    statements.push(...effective);
  }
  // A newly created client has no prior head to advance. Certify its first
  // complete projection in this same guarded batch so global coverage survives.
  if (mode === 'active') for (const slice of newSlices) {
    const claims = deliveryPlanClaims(slice.after, slice.company);
    const dependencies = deliveryDeadlineDependencies(slice.after, slice.company);
    if (statements.length + claims.length + dependencies.length + 3 > budget) continue;
    const projection = crypto.randomUUID();
    for (const planId of claims) statements.push(db.prepare(`INSERT INTO delivery_client_plan_claims
      (workspace_id,projection_generation,company,plan_id) VALUES(?,?,?,?)`)
      .bind(workspace, projection, slice.company, planId));
    statements.push(db.prepare(`INSERT INTO delivery_client_plan_claim_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_claims,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,company) DO UPDATE SET
        authority_generation=excluded.authority_generation,source_revision=excluded.source_revision,
        source_incarnation=excluded.source_incarnation,projection_generation=excluded.projection_generation,
        expected_claims=excluded.expected_claims,updated_at=excluded.updated_at`)
      .bind(workspace, slice.company, meta.generation, 1, slice.incarnation,
        projection, claims.length, new Date().toISOString()));
    for (const dependency of dependencies) statements.push(db.prepare(`INSERT INTO delivery_client_deadline_dependencies
      (workspace_id,projection_generation,company,source_task_id,target_task_id)
      VALUES(?,?,?,?,?)`).bind(workspace, projection, slice.company,
        dependency.sourceTaskId, dependency.targetTaskId));
    statements.push(db.prepare(`INSERT INTO delivery_client_deadline_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_dependencies,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,company) DO UPDATE SET
        authority_generation=excluded.authority_generation,source_revision=excluded.source_revision,
        source_incarnation=excluded.source_incarnation,projection_generation=excluded.projection_generation,
        expected_dependencies=excluded.expected_dependencies,updated_at=excluded.updated_at`)
      .bind(workspace, slice.company, meta.generation, 1, slice.incarnation,
        projection, dependencies.length, new Date().toISOString()));
  }
  report?.staleHeads.push(...staleHeads.sort());
  const deliveryVersion = mode === 'active' ? meta.source_delivery_version
    : (deliveryDoc?.version ?? 0) + Number(writes.some(write => write.key === DELIVERY));
  const clientsVersion = (clientsDoc?.version ?? 0) + Number(writes.some(write => write.key === CLIENTS));
  statements.push(db.prepare(`UPDATE delivery_client_shadow_meta SET
    source_delivery_version=?,source_clients_version=?,expected_clients=?,expected_owners=?,
    expected_array_order=?,expected_map_order=?,compatibility_version=compatibility_version+1,updated_at=?
    WHERE workspace_id=? AND generation=? AND mode=?
      AND source_delivery_version=? AND source_clients_version=? AND compatibility_version=?`)
    .bind(deliveryVersion, clientsVersion,
      meta.expected_clients + after.companies.size - before.companies.size,
      meta.expected_owners + after.owners.size - before.owners.size,
      meta.expected_array_order + after.order.size - before.order.size,
      meta.expected_map_order + after.mapOrder.size - before.mapOrder.size,
      new Date().toISOString(), workspace, meta.generation, mode,
      meta.source_delivery_version, meta.source_clients_version, meta.compatibility_version));
  return statements;
}
