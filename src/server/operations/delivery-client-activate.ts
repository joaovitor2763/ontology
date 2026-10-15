import { getDoc } from '../db.ts';
import { decodeStateBody } from '../state-body.ts';
import { DELIVERY_INITIAL, projectDelivery, type DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { effectiveDeliveryRows, type EffectiveTaskRow, type EffectiveCycleRow } from '../delivery-effective.ts';
import { readShadowDeliveryCompatibility } from './delivery-compatibility-read.ts';
import { OperationError } from './errors.ts';

type Marker = {
  generation: string; mode: string; source_delivery_version: number;
  source_clients_version: number; compatibility_version: number;
  expected_clients: number; expected_owners: number; expected_orphans: number;
  expected_array_order: number; expected_map_order: number;
};

export type ClientAuthorityInventory = Pick<Marker,
  'generation' | 'mode' | 'source_delivery_version' | 'source_clients_version' |
  'compatibility_version' | 'expected_clients' | 'expected_owners'>;

const incomplete = () => new OperationError(503, 'execution_snapshot_incomplete',
  'A cópia por cliente não está completa. Refaça a auditoria antes de ativar.');

export async function clientAuthorityInventory(db: D1Database, workspace: string): Promise<ClientAuthorityInventory | null> {
  return db.prepare(`SELECT generation,mode,source_delivery_version,source_clients_version,
      compatibility_version,expected_clients,expected_owners
    FROM delivery_client_shadow_meta WHERE workspace_id=?`).bind(workspace).first<ClientAuthorityInventory>();
}

/** Exact raw and effective equivalence, including hashes, owners and current SQL pages. */
export async function auditClientAuthority(db: D1Database, workspace: string, expected: {
  generation: string; deliveryVersion: number; clientsVersion: number;
}): Promise<{ clients: number; owners: number; tasks: number; cycles: number }> {
  const marker = await db.prepare(`SELECT generation,mode,source_delivery_version,
      source_clients_version,compatibility_version,expected_clients,expected_owners,
      expected_orphans,expected_array_order,expected_map_order
    FROM delivery_client_shadow_meta WHERE workspace_id=?`).bind(workspace).first<Marker>();
  if (!marker || marker.mode !== 'shadow' || marker.generation !== expected.generation ||
      marker.source_delivery_version !== expected.deliveryVersion ||
      marker.source_clients_version !== expected.clientsVersion)
    throw new OperationError(409, 'version_conflict', 'A geração ou os documentos mudaram. Refaça a auditoria.');
  const [delivery, clients, reconstructed] = await Promise.all([
    getDoc(db, workspace, 'ontology.delivery.v2'),
    getDoc(db, workspace, 'ontology.clients.v3'),
    readShadowDeliveryCompatibility(db, workspace),
  ]);
  if (!delivery || !clients || !reconstructed || delivery.version !== expected.deliveryVersion ||
      clients.version !== expected.clientsVersion || marker.expected_orphans !== 0)
    throw incomplete();
  const physical = { ...DELIVERY_INITIAL, ...(delivery.value as object) } as DeliverySnapshot;
  if (JSON.stringify(reconstructed.snapshot) !== JSON.stringify(physical)) throw incomplete();
  const [slices, owners, taskRows, cycleRows] = await Promise.all([
    db.prepare(`SELECT s.company,s.body,s.body_sha256,s.revision,s.incarnation,
        h.authority_generation,h.source_revision,h.source_incarnation,
        h.projection_generation,h.expected_tasks,h.expected_cycles,
        (SELECT COUNT(*) FROM delivery_effective_tasks t WHERE t.workspace_id=s.workspace_id
          AND t.generation=h.projection_generation AND t.company=s.company) AS actual_tasks,
        (SELECT COUNT(*) FROM delivery_effective_cycles c WHERE c.workspace_id=s.workspace_id
          AND c.generation=h.projection_generation AND c.company=s.company) AS actual_cycles
      FROM delivery_client_snapshots s LEFT JOIN delivery_client_effective_heads h
        ON h.workspace_id=s.workspace_id AND h.company=s.company
      WHERE s.workspace_id=? AND s.generation=? ORDER BY s.company`)
      .bind(workspace, expected.generation).all<{
        company: string; body: string; body_sha256: string; revision: number; incarnation: string;
        authority_generation: string | null; source_revision: number | null;
        source_incarnation: string | null; projection_generation: string | null;
        expected_tasks: number | null; expected_cycles: number | null;
        actual_tasks: number; actual_cycles: number;
      }>(),
    db.prepare(`SELECT kind,id,company FROM delivery_entity_owners
      WHERE workspace_id=? AND generation=? ORDER BY kind,id`)
      .bind(workspace, expected.generation).all<{ kind: string; id: string; company: string }>(),
    db.prepare(`SELECT t.company,t.id,t.ordinal,t.enrollment_id AS enrollmentId,
        t.product_id AS productId,t.status,t.due_at AS dueAt,t.owner_id AS ownerId,
        t.milestone,t.kind,t.body FROM delivery_effective_tasks t
      JOIN delivery_client_effective_heads h ON h.workspace_id=t.workspace_id
        AND h.company=t.company AND h.projection_generation=t.generation
      WHERE t.workspace_id=? AND h.authority_generation=?
      ORDER BY t.company,t.ordinal,t.id`).bind(workspace, expected.generation)
      .all<EffectiveTaskRow>(),
    db.prepare(`SELECT c.company,c.id,c.ordinal,c.enrollment_id AS enrollmentId,
        c.product_id AS productId,c.status,c.starts_at AS startsAt,
        c.ends_at AS endsAt,c.body FROM delivery_effective_cycles c
      JOIN delivery_client_effective_heads h ON h.workspace_id=c.workspace_id
        AND h.company=c.company AND h.projection_generation=c.generation
      WHERE c.workspace_id=? AND h.authority_generation=?
      ORDER BY c.company,c.ordinal,c.id`).bind(workspace, expected.generation)
      .all<EffectiveCycleRow>(),
  ]);
  if (slices.results.length !== marker.expected_clients || owners.results.length !== marker.expected_owners)
    throw incomplete();
  const tasksByCompany = new Map<string, EffectiveTaskRow[]>();
  const cyclesByCompany = new Map<string, EffectiveCycleRow[]>();
  for (const task of taskRows.results) {
    const group = tasksByCompany.get(task.company) ?? [];
    group.push(task); tasksByCompany.set(task.company, group);
  }
  for (const cycle of cycleRows.results) {
    const group = cyclesByCompany.get(cycle.company) ?? [];
    group.push(cycle); cyclesByCompany.set(cycle.company, group);
  }
  for (const row of slices.results) {
    const slice = await decodeStateBody(row.body) as DeliverySnapshot;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(slice)));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const effective = projectDelivery(slice, row.company);
    const expectedRows = effectiveDeliveryRows(slice, row.company);
    if (hash !== row.body_sha256 || row.authority_generation !== expected.generation ||
        row.source_revision !== row.revision || row.source_incarnation !== row.incarnation ||
        row.expected_tasks !== effective.tasks.length || row.expected_cycles !== effective.cycles.length ||
        row.actual_tasks !== row.expected_tasks || row.actual_cycles !== row.expected_cycles ||
        JSON.stringify(tasksByCompany.get(row.company) ?? []) !== JSON.stringify(expectedRows.tasks) ||
        JSON.stringify(cyclesByCompany.get(row.company) ?? []) !== JSON.stringify(expectedRows.cycles) ||
        JSON.stringify(effective) !== JSON.stringify(projectDelivery(physical, row.company)))
      throw incomplete();
  }
  const projected = projectDelivery(physical);
  const expectedOwners = new Map<string, string>([
    ...projected.tasks.map(row => [`task\u0000${row.id}`, row.company] as const),
    ...projected.cycles.map(row => [`cycle\u0000${row.id}`, row.company] as const),
  ]);
  if (expectedOwners.size !== projected.tasks.length + projected.cycles.length ||
      expectedOwners.size !== owners.results.length ||
      owners.results.some(row => expectedOwners.get(`${row.kind}\u0000${row.id}`) !== row.company))
    throw incomplete();
  return { clients: slices.results.length, owners: owners.results.length,
    tasks: projected.tasks.length, cycles: projected.cycles.length };
}

/** A single conditional UPDATE is the authority switch. Concurrent legacy writes
 * advance a source version, causing zero rows to change. The old Worker is then
 * fenced by the global document trigger. */
export async function activateClientAuthority(db: D1Database, workspace: string, expected: {
  generation: string; deliveryVersion: number; clientsVersion: number;
  compatibilityVersion: number; backupSha256: string;
}) {
  if (!/^[a-f0-9-]{36}$/.test(expected.generation) ||
      !/^[a-f0-9]{64}$/.test(expected.backupSha256) ||
      ![expected.deliveryVersion, expected.clientsVersion]
        .every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(expected.compatibilityVersion) || expected.compatibilityVersion < 0)
    throw new OperationError(422, 'invalid_cutover', 'Geração, versões ou comprovante do backup inválidos.');
  const audit = await auditClientAuthority(db, workspace, expected);
  const nextVersion = Math.max(expected.deliveryVersion, expected.compatibilityVersion) + 1;
  const changed = await db.prepare(`UPDATE delivery_client_shadow_meta
    SET mode='active',compatibility_version=?,updated_at=?
    WHERE workspace_id=? AND generation=? AND mode='shadow'
      AND source_delivery_version=? AND source_clients_version=?
      AND compatibility_version=? AND expected_orphans=0
      AND EXISTS (SELECT 1 FROM state_documents d WHERE d.workspace_id=?
        AND d.key='ontology.delivery.v2' AND d.version=?)
      AND EXISTS (SELECT 1 FROM state_documents c WHERE c.workspace_id=?
        AND c.key='ontology.clients.v3' AND c.version=?)
    RETURNING generation,compatibility_version`)
    .bind(nextVersion, new Date().toISOString(), workspace, expected.generation,
      expected.deliveryVersion, expected.clientsVersion, expected.compatibilityVersion,
      workspace, expected.deliveryVersion, workspace, expected.clientsVersion)
    .first<{ generation: string; compatibility_version: number }>();
  if (!changed) throw new OperationError(409, 'version_conflict',
    'A execução mudou durante a auditoria. Nenhuma autoridade foi trocada.');
  return { mode: 'active' as const, generation: changed.generation,
    compatibilityVersion: changed.compatibility_version, audit,
    backupSha256: expected.backupSha256 };
}
