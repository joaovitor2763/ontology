import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { encodeCompressedStateBody } from '../state-body.ts';
import { deliveryMapOrder, partitionClientDelivery } from '../delivery-client-slices.ts';
import { effectiveDeliveryRows } from '../delivery-effective.ts';
import { historyObservations } from '../delivery-history.ts';
import { deliveryPlanClaims } from './delivery-client-plan-claims.ts';
import { deliveryDeadlineDependencies } from './delivery-client-deadline-dependencies.ts';
import { ClientScopeRequiresBridge } from './delivery-client-task-write.ts';
import { markSliceWrite } from './delivery-client-summary-sync.ts';

export type NewClientAuthority = {
  generation: string; version: number; clientsVersion: number;
};

/** A new company must not replace an old, unregistered slice. Count all
 * authority indexes before choosing the create-only path. */
export async function readActiveNewClientAuthority(
  db: D1Database, workspace: string, company: string,
): Promise<NewClientAuthority | null> {
  const row = await db.prepare(`SELECT m.generation,m.compatibility_version,
      m.source_clients_version,m.source_delivery_version,m.expected_clients,
      m.expected_owners,m.expected_array_order,m.expected_map_order,m.expected_orphans,
      d.version AS delivery_version,c.version AS clients_version,
      (SELECT COUNT(*) FROM delivery_client_snapshots s
        WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation) AS clients,
      (SELECT COUNT(*) FROM delivery_entity_owners o
        WHERE o.workspace_id=m.workspace_id AND o.generation=m.generation) AS owners,
      (SELECT COUNT(*) FROM delivery_client_array_order a
        WHERE a.workspace_id=m.workspace_id AND a.generation=m.generation) AS array_order,
      (SELECT COUNT(*) FROM delivery_client_map_order p
        WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation) AS map_order,
      (SELECT COUNT(*) FROM delivery_client_orphans o
        WHERE o.workspace_id=m.workspace_id AND o.generation=m.generation) AS orphans,
      EXISTS(SELECT 1 FROM delivery_client_snapshots s
        WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation
          AND s.company=?) AS existing
    FROM delivery_client_shadow_meta m
    JOIN state_documents d ON d.workspace_id=m.workspace_id
      AND d.key='ontology.delivery.v2'
    JOIN state_documents c ON c.workspace_id=m.workspace_id
      AND c.key='ontology.clients.v3'
    WHERE m.workspace_id=? AND m.mode='active'`).bind(company, workspace)
    .first<{ generation: string; compatibility_version: number;
      source_clients_version: number; source_delivery_version: number;
      expected_clients: number; expected_owners: number;
      expected_array_order: number; expected_map_order: number;
      expected_orphans: number; delivery_version: number; clients_version: number;
      clients: number; owners: number; array_order: number; map_order: number;
      orphans: number; existing: number }>();
  if (!row || row.existing || row.expected_orphans !== 0 || row.orphans !== 0 ||
      row.clients !== row.expected_clients || row.owners !== row.expected_owners ||
      row.array_order !== row.expected_array_order ||
      row.map_order !== row.expected_map_order ||
      row.delivery_version !== row.source_delivery_version ||
      row.clients_version !== row.source_clients_version) return null;
  return { generation: row.generation, version: row.compatibility_version,
    clientsVersion: row.source_clients_version };
}

const digest = async (plain: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Create the first authoritative slice and every directly readable index in
 * the same guarded operation batch as the new clients document. */
export async function activeNewClientStatements(
  db: D1Database, workspace: string, company: string,
  authority: NewClientAuthority, after: DeliverySnapshot,
  enrollments: readonly { company: string; planId?: string | null }[],
  budget: number,
): Promise<D1PreparedStatement[]> {
  const partition = partitionClientDelivery(after, enrollments);
  if (partition.unassigned.length || partition.sharedPlanIds.length ||
      partition.slices.some(slice => slice.company !== company))
    throw new ClientScopeRequiresBridge();
  const rawTasks = after.extraTasks ?? [], rawCycles = after.extraCycles ?? [];
  const projected = projectDelivery(after, company);
  if (rawTasks.some(task => task.company !== company) ||
      rawCycles.some(cycle => cycle.company !== company) ||
      projected.tasks.some(task => task.company !== company) ||
      projected.cycles.some(cycle => cycle.company !== company))
    throw new ClientScopeRequiresBridge();
  const mapOrder = deliveryMapOrder(after), effective = effectiveDeliveryRows(after, company);
  const claims = deliveryPlanClaims(after, company);
  const dependencies = deliveryDeadlineDependencies(after, company);
  const ownerIds = [
    ...projected.tasks.map(task => ({ kind: 'task', id: task.id })),
    ...projected.cycles.map(cycle => ({ kind: 'cycle', id: cycle.id })),
  ];
  if (new Set(ownerIds.map(row => `${row.kind}\u0000${row.id}`)).size !== ownerIds.length)
    throw new ClientScopeRequiresBridge();
  const histories = (await historyObservations(after,
    new Set(projected.tasks.map(task => task.id))))
    .filter(entry => !entry.isLegacySummary);
  const identities = [...mapOrder.keys()];
  const collisions = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM delivery_client_map_order p
        WHERE p.workspace_id=? AND p.generation=?
          AND (p.kind || char(0) || p.id) IN (SELECT value FROM json_each(?))) AS maps,
      (SELECT COUNT(*) FROM delivery_entity_owners o
        WHERE o.workspace_id=? AND o.generation=?
          AND EXISTS(SELECT 1 FROM json_each(?) j
            WHERE json_extract(j.value,'$.kind')=o.kind
              AND json_extract(j.value,'$.id')=o.id)) AS owners`)
    .bind(workspace, authority.generation, JSON.stringify(identities),
      workspace, authority.generation, JSON.stringify(ownerIds))
    .first<{ maps: number; owners: number }>();
  if (!collisions || collisions.maps || collisions.owners)
    throw new ClientScopeRequiresBridge();
  const incarnation = crypto.randomUUID(), projection = crypto.randomUUID();
  const body = JSON.stringify(after), now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    markSliceWrite(db, workspace, db.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES(?,?,?,1,?,?,?)`).bind(workspace, authority.generation, company,
      await encodeCompressedStateBody(after), await digest(body), incarnation),
    { company, generation: authority.generation, revision: 1, incarnation, plain: body }),
  ];
  for (const [kind, rows] of [['extraTasks', rawTasks], ['extraCycles', rawCycles]] as const)
    for (const row of rows) statements.push(db.prepare(`INSERT INTO delivery_client_array_order
      (workspace_id,generation,kind,id,ordinal,company)
      VALUES(?,?,?,?,(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_array_order
        WHERE workspace_id=? AND generation=? AND kind=?),?)`)
      .bind(workspace, authority.generation, kind, row.id,
        workspace, authority.generation, kind, company));
  for (const identity of mapOrder.keys()) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal)
      VALUES(?,?,?,?,(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_map_order
        WHERE workspace_id=? AND generation=? AND kind=?))`)
      .bind(workspace, authority.generation, kind, id,
        workspace, authority.generation, kind));
  }
  for (const row of ownerIds) statements.push(db.prepare(`INSERT INTO delivery_entity_owners
    (workspace_id,generation,kind,id,company) VALUES(?,?,?,?,?)`)
    .bind(workspace, authority.generation, row.kind, row.id, company));
  for (const planId of claims) statements.push(db.prepare(`INSERT INTO delivery_client_plan_claims
    (workspace_id,projection_generation,company,plan_id) VALUES(?,?,?,?)`)
    .bind(workspace, projection, company, planId));
  statements.push(db.prepare(`INSERT INTO delivery_client_plan_claim_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_claims,updated_at)
    VALUES(?,?,?,1,?,?,?,?)
    ON CONFLICT(workspace_id,company) DO UPDATE SET
      authority_generation=excluded.authority_generation,
      source_revision=excluded.source_revision,
      source_incarnation=excluded.source_incarnation,
      projection_generation=excluded.projection_generation,
      expected_claims=excluded.expected_claims,updated_at=excluded.updated_at`)
    .bind(workspace, company, authority.generation, incarnation,
      projection, claims.length, now));
  for (const dependency of dependencies) statements.push(db.prepare(`INSERT INTO delivery_client_deadline_dependencies
    (workspace_id,projection_generation,company,source_task_id,target_task_id)
    VALUES(?,?,?,?,?)`).bind(workspace, projection, company,
      dependency.sourceTaskId, dependency.targetTaskId));
  statements.push(db.prepare(`INSERT INTO delivery_client_deadline_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_dependencies,updated_at)
    VALUES(?,?,?,1,?,?,?,?)
    ON CONFLICT(workspace_id,company) DO UPDATE SET
      authority_generation=excluded.authority_generation,
      source_revision=excluded.source_revision,
      source_incarnation=excluded.source_incarnation,
      projection_generation=excluded.projection_generation,
      expected_dependencies=excluded.expected_dependencies,updated_at=excluded.updated_at`)
    .bind(workspace, company, authority.generation, incarnation,
      projection, dependencies.length, now));
  for (const task of effective.tasks) statements.push(db.prepare(`INSERT INTO delivery_effective_tasks
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,
     due_at,owner_id,milestone,kind,body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(workspace, projection, company, task.id, task.ordinal,
      task.enrollmentId, task.productId, task.status, task.dueAt, task.ownerId,
      task.milestone, task.kind, task.body));
  for (const cycle of effective.cycles) statements.push(db.prepare(`INSERT INTO delivery_effective_cycles
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,
     starts_at,ends_at,body) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(workspace, projection, company, cycle.id, cycle.ordinal,
      cycle.enrollmentId, cycle.productId, cycle.status, cycle.startsAt,
      cycle.endsAt, cycle.body));
  statements.push(db.prepare(`INSERT INTO delivery_client_effective_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_tasks,expected_cycles,updated_at)
    VALUES(?,?,?,1,?,?,?,?,?)
    ON CONFLICT(workspace_id,company) DO UPDATE SET
      authority_generation=excluded.authority_generation,
      source_revision=excluded.source_revision,
      source_incarnation=excluded.source_incarnation,
      projection_generation=excluded.projection_generation,
      expected_tasks=excluded.expected_tasks,
      expected_cycles=excluded.expected_cycles,updated_at=excluded.updated_at`)
    .bind(workspace, company, authority.generation, incarnation, projection,
      effective.tasks.length, effective.cycles.length, now));
  statements.push(db.prepare(`UPDATE delivery_client_shadow_meta SET
    expected_clients=expected_clients+1,expected_owners=expected_owners+?,
    expected_array_order=expected_array_order+?,expected_map_order=expected_map_order+?,
    source_clients_version=source_clients_version+1,
    compatibility_version=compatibility_version+1,updated_at=?
    WHERE workspace_id=? AND generation=? AND mode='active'
      AND compatibility_version=? AND source_clients_version=?`)
    .bind(ownerIds.length, rawTasks.length + rawCycles.length, mapOrder.size,
      now, workspace, authority.generation, authority.version, authority.clientsVersion));
  for (const entry of histories) statements.push(db.prepare(`INSERT INTO delivery_task_history
    (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,
     is_legacy_summary,source_first_version,source_last_version)
    VALUES(?,?,?,?,?,?,?,0,?,?)`)
    .bind(workspace, entry.taskId, crypto.randomUUID(), entry.entryHash,
      entry.occurrence, entry.entryJson, entry.eventAt,
      authority.version + 1, authority.version + 1));
  if (statements.length > budget) throw new ClientScopeRequiresBridge();
  return statements;
}
