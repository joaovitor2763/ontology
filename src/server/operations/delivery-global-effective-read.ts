import { OperationError } from './errors.ts';
import type { EffectivePageFilters } from './delivery-effective-read.ts';
import { serviceCycles } from '../../modules/delivery/infrastructure/services.ts';
import { deliveries } from '../../modules/delivery/infrastructure/seed.ts';
import { companies } from '../../modules/clients/infrastructure/seed.ts';
import { playbookDeliveries } from '../../modules/catalog/infrastructure/playbook.ts';

type Authority = {
  generation: string;
  version: number;
  expected_clients: number;
  expected_owners: number;
  slices: number;
  valid_heads: number;
  owners: number;
  task_owners: number;
  task_rows: number;
  matched_task_owners: number;
  cycle_owners: number;
  cycle_rows: number;
  matched_cycle_owners: number;
};
type TaskPosition = { company: string; id: string; due_at: string | null;
  generation: string; extra_ordinal?: number | null };
type TaskBody = { company: string; id: string; body: string };
type CyclePosition = { company: string; id: string; starts_at: string;
  generation: string; extra_ordinal: number | null };

const seedCycleOrder = new Map(serviceCycles.map((cycle, index) => [cycle.id, index]));
const seedTaskOrder = new Map(deliveries.map((task, index) => [task.id, index]));
const playbookTaskOrder = new Map(companies.flatMap(company =>
  playbookDeliveries(company.slug, company.milestone ?? 1, company.journeyId))
  .map((task, index) => [task.id, index]));
const completeAuthority = (authority: Authority | undefined): authority is Authority => Boolean(authority &&
  authority.expected_clients > 0 && authority.slices === authority.expected_clients &&
  authority.valid_heads === authority.expected_clients &&
  authority.owners === authority.expected_owners &&
  authority.task_owners === authority.task_rows &&
  authority.matched_task_owners === authority.task_owners &&
  authority.cycle_owners === authority.cycle_rows &&
  authority.matched_cycle_owners === authority.cycle_owners);

const authoritySql = `SELECT a.generation,a.compatibility_version AS version,
  a.expected_clients,a.expected_owners,
  (SELECT COUNT(*) FROM delivery_client_snapshots s
    WHERE s.workspace_id=a.workspace_id AND s.generation=a.generation) AS slices,
  (SELECT COUNT(*) FROM delivery_client_snapshots s
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company AND h.authority_generation=s.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    WHERE s.workspace_id=a.workspace_id AND s.generation=a.generation
      AND (SELECT COUNT(*) FROM delivery_effective_tasks t
        WHERE t.workspace_id=s.workspace_id AND t.company=s.company
          AND t.generation=h.projection_generation)=h.expected_tasks
      AND (SELECT COUNT(*) FROM delivery_effective_cycles c
        WHERE c.workspace_id=s.workspace_id AND c.company=s.company
          AND c.generation=h.projection_generation)=h.expected_cycles) AS valid_heads,
  (SELECT COUNT(*) FROM delivery_entity_owners o
    WHERE o.workspace_id=a.workspace_id AND o.generation=a.generation) AS owners,
  (SELECT COUNT(*) FROM delivery_entity_owners o
    WHERE o.workspace_id=a.workspace_id AND o.generation=a.generation
      AND o.kind='task') AS task_owners,
  (SELECT COUNT(*) FROM delivery_client_snapshots s
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company AND h.authority_generation=s.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_tasks r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation
    WHERE s.workspace_id=a.workspace_id AND s.generation=a.generation) AS task_rows,
  (SELECT COUNT(*) FROM delivery_entity_owners o
    JOIN delivery_client_snapshots s ON s.workspace_id=o.workspace_id
      AND s.generation=o.generation AND s.company=o.company
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company AND h.authority_generation=s.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_tasks r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation AND r.id=o.id
    WHERE o.workspace_id=a.workspace_id AND o.generation=a.generation
      AND o.kind='task') AS matched_task_owners,
  (SELECT COUNT(*) FROM delivery_entity_owners o
    WHERE o.workspace_id=a.workspace_id AND o.generation=a.generation
      AND o.kind='cycle') AS cycle_owners,
  (SELECT COUNT(*) FROM delivery_client_snapshots s
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company AND h.authority_generation=s.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_cycles r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation
    WHERE s.workspace_id=a.workspace_id AND s.generation=a.generation) AS cycle_rows,
  (SELECT COUNT(*) FROM delivery_entity_owners o
    JOIN delivery_client_snapshots s ON s.workspace_id=o.workspace_id
      AND s.generation=o.generation AND s.company=o.company
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company AND h.authority_generation=s.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_cycles r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation AND r.id=o.id
    WHERE o.workspace_id=a.workspace_id AND o.generation=a.generation
      AND o.kind='cycle') AS matched_cycle_owners
  FROM delivery_client_shadow_meta a
  JOIN state_documents d ON d.workspace_id=a.workspace_id
    AND d.key='ontology.delivery.v2' AND d.version=a.source_delivery_version
  JOIN state_documents c ON c.workspace_id=a.workspace_id
    AND c.key='ontology.clients.v3' AND c.version=a.source_clients_version
  WHERE a.workspace_id=? AND a.mode='active'`;

/** All active heads must be current before a global page can use the SQL read model. */
export async function readActiveGlobalTaskPage(
  db: D1Database, workspace: string, cursor: number, limit: number,
  filters: EffectivePageFilters, permitted: string[] | null | undefined,
  expectedVersion?: number,
) {
  const where = [`a.workspace_id=?`, `a.mode='active'`];
  const values: (string | number)[] = [workspace];
  if (permitted !== null && permitted !== undefined) {
    if (permitted.length) {
      where.push('r.company IN (SELECT value FROM json_each(?))');
      values.push(JSON.stringify(permitted));
    } else where.push('0');
  }
  if (filters.status) { where.push('r.status=?'); values.push(filters.status); }
  if (filters.enrollmentId) { where.push('r.enrollment_id=?'); values.push(filters.enrollmentId); }
  if (filters.ownerId) { where.push('r.owner_id=?'); values.push(filters.ownerId); }
  if (filters.dueFrom || filters.dueTo) where.push("r.due_at IS NOT NULL AND r.due_at<>''");
  if (filters.dueFrom) { where.push('r.due_at>=?'); values.push(filters.dueFrom); }
  if (filters.dueTo) { where.push('r.due_at<=?'); values.push(filters.dueTo); }
  const byPosition = filters.sort !== 'dueAt';
  const from = `FROM delivery_client_shadow_meta a
    JOIN delivery_client_snapshots s ON s.workspace_id=a.workspace_id AND s.generation=a.generation
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id AND h.company=s.company
      AND h.authority_generation=s.generation AND h.source_revision=s.revision
      AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_tasks r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation
    ${byPosition ? `LEFT JOIN delivery_client_array_order p ON p.workspace_id=a.workspace_id
      AND p.generation=a.generation AND p.kind='extraTasks'
      AND p.id=r.id AND p.company=r.company` : ''}`;
  const positionsQuery = db.prepare(`SELECT r.company,r.id,r.due_at,h.projection_generation AS generation
      ${byPosition ? ',p.ordinal AS extra_ordinal' : ''}
    ${from} WHERE ${where.join(' AND ')}`).bind(...values);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [authorityResult, positionsResult] = await db.batch([
      db.prepare(authoritySql).bind(workspace), positionsQuery,
    ]);
    const authority = authorityResult.results[0] as Authority | undefined;
    if (!completeAuthority(authority)) return null;
    if (expectedVersion !== undefined && expectedVersion !== authority.version)
      throw new OperationError(409, 'snapshot_changed',
        'A lista mudou. Recomece pela primeira página.', { snapshotVersion: authority.version });
    const positions = positionsResult.results as TaskPosition[];
    if (byPosition) {
      const extraOrdinals = new Set<number>();
      for (const row of positions) {
        if (seedTaskOrder.has(row.id) || playbookTaskOrder.has(row.id)) continue;
        if (!Number.isSafeInteger(row.extra_ordinal) ||
            extraOrdinals.has(row.extra_ordinal!)) return null;
        extraOrdinals.add(row.extra_ordinal!);
      }
      const position = (row: TaskPosition): [number, number] =>
        seedTaskOrder.has(row.id) ? [0, seedTaskOrder.get(row.id)!] :
        playbookTaskOrder.has(row.id) ? [1, playbookTaskOrder.get(row.id)!] :
        [2, row.extra_ordinal!];
      positions.sort((first, second) => {
        const a = position(first), b = position(second);
        return a[0] - b[0] || a[1] - b[1];
      });
    } else positions.sort((first, second) =>
      Number(!first.due_at) - Number(!second.due_at) ||
      (first.due_at ?? '').localeCompare(second.due_at ?? '') ||
      first.id.localeCompare(second.id));
    const selected = positions.slice(cursor, cursor + limit);
    const marker = db.prepare(`SELECT compatibility_version AS version FROM delivery_client_shadow_meta
      WHERE workspace_id=? AND generation=? AND mode='active'`).bind(workspace, authority.generation);
    const bodies = selected.length ? db.prepare(`WITH selected AS MATERIALIZED (
        SELECT json_extract(value,'$[0]') AS company,
          json_extract(value,'$[1]') AS id,
          json_extract(value,'$[2]') AS generation FROM json_each(?))
      SELECT r.company,r.id,r.body FROM selected chosen
      CROSS JOIN delivery_effective_tasks r ON r.workspace_id=?
        AND r.company=chosen.company AND r.id=chosen.id AND r.generation=chosen.generation
      JOIN delivery_client_effective_heads h ON h.workspace_id=r.workspace_id
        AND h.company=r.company AND h.projection_generation=r.generation
      JOIN delivery_client_snapshots s ON s.workspace_id=h.workspace_id
        AND s.generation=h.authority_generation AND s.company=h.company
        AND s.revision=h.source_revision AND s.incarnation=h.source_incarnation
      JOIN delivery_client_shadow_meta a ON a.workspace_id=s.workspace_id
        AND a.generation=s.generation AND a.mode='active'
        AND a.compatibility_version=?`)
      .bind(JSON.stringify(selected.map(row => [row.company, row.id, row.generation])),
        workspace, authority.version) : null;
    const results = await db.batch(bodies ? [bodies, marker] : [marker]);
    const markerResult = (results.at(-1)!.results[0] as { version: number } | undefined);
    if (markerResult?.version !== authority.version) continue;
    const found = (bodies ? results[0].results : []) as TaskBody[];
    if (found.length !== selected.length) return null;
    const byId = new Map(found.map(row => [`${row.company}\u0000${row.id}`, row.body]));
    if (byId.size !== selected.length) return null;
    return {
      data: selected.map(row => JSON.parse(byId.get(`${row.company}\u0000${row.id}`)!) as unknown),
      total: positions.length,
      snapshotVersion: authority.version,
      nextCursor: cursor + limit < positions.length ? String(cursor + limit) : null,
    };
  }
  throw new OperationError(409, 'snapshot_changed',
    'A lista mudou. Recomece pela primeira página.');
}

/** Cycles have a workspace-wide start-date order. A stable tie keeps seed
 * cycles in their source order, followed by extra cycles in the global array. */
export async function readActiveGlobalCyclePage(
  db: D1Database, workspace: string, cursor: number, limit: number,
  filters: EffectivePageFilters, permitted: string[] | null | undefined,
  expectedVersion?: number,
) {
  const where = [`a.workspace_id=?`, `a.mode='active'`];
  const values: (string | number)[] = [workspace];
  if (permitted !== null && permitted !== undefined) {
    if (permitted.length) {
      where.push('r.company IN (SELECT value FROM json_each(?))');
      values.push(JSON.stringify(permitted));
    } else where.push('0');
  }
  if (filters.status) { where.push('r.status=?'); values.push(filters.status); }
  if (filters.enrollmentId) { where.push('r.enrollment_id=?'); values.push(filters.enrollmentId); }
  const from = `FROM delivery_client_shadow_meta a
    JOIN delivery_client_snapshots s ON s.workspace_id=a.workspace_id AND s.generation=a.generation
    JOIN delivery_client_effective_heads h ON h.workspace_id=s.workspace_id AND h.company=s.company
      AND h.authority_generation=s.generation AND h.source_revision=s.revision
      AND h.source_incarnation=s.incarnation
    JOIN delivery_effective_cycles r ON r.workspace_id=h.workspace_id
      AND r.company=h.company AND r.generation=h.projection_generation
    LEFT JOIN delivery_client_array_order p ON p.workspace_id=a.workspace_id
      AND p.generation=a.generation AND p.kind='extraCycles' AND p.id=r.id AND p.company=r.company`;
  const positionsQuery = db.prepare(`SELECT r.company,r.id,r.starts_at,
      h.projection_generation AS generation,p.ordinal AS extra_ordinal
    ${from} WHERE ${where.join(' AND ')}`).bind(...values);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [authorityResult, positionsResult] = await db.batch([
      db.prepare(authoritySql).bind(workspace), positionsQuery,
    ]);
    const authority = authorityResult.results[0] as Authority | undefined;
    if (!completeAuthority(authority)) return null;
    if (expectedVersion !== undefined && expectedVersion !== authority!.version)
      throw new OperationError(409, 'snapshot_changed',
        'A lista mudou. Recomece pela primeira página.', { snapshotVersion: authority!.version });
    const positions = positionsResult.results as CyclePosition[];
    const extraOrdinals = new Set<number>();
    for (const row of positions) {
      if (typeof row.starts_at !== 'string') return null;
      if (row.extra_ordinal === null) {
        if (!seedCycleOrder.has(row.id)) return null;
      } else if (!Number.isSafeInteger(row.extra_ordinal) ||
          extraOrdinals.has(row.extra_ordinal) || seedCycleOrder.has(row.id)) return null;
      else extraOrdinals.add(row.extra_ordinal);
    }
    positions.sort((first, second) => first.starts_at.localeCompare(second.starts_at) ||
      Number(first.extra_ordinal !== null) - Number(second.extra_ordinal !== null) ||
      (first.extra_ordinal ?? seedCycleOrder.get(first.id)!) -
        (second.extra_ordinal ?? seedCycleOrder.get(second.id)!));
    const selected = positions.slice(cursor, cursor + limit);
    const marker = db.prepare(`SELECT compatibility_version AS version FROM delivery_client_shadow_meta
      WHERE workspace_id=? AND generation=? AND mode='active'`).bind(workspace, authority!.generation);
    const bodies = selected.length ? db.prepare(`WITH selected AS MATERIALIZED (
        SELECT json_extract(value,'$[0]') AS company,
          json_extract(value,'$[1]') AS id,
          json_extract(value,'$[2]') AS generation FROM json_each(?))
      SELECT r.company,r.id,r.body FROM selected chosen
      CROSS JOIN delivery_effective_cycles r ON r.workspace_id=?
        AND r.company=chosen.company AND r.id=chosen.id AND r.generation=chosen.generation
      JOIN delivery_client_effective_heads h ON h.workspace_id=r.workspace_id
        AND h.company=r.company AND h.projection_generation=r.generation
      JOIN delivery_client_snapshots s ON s.workspace_id=h.workspace_id
        AND s.generation=h.authority_generation AND s.company=h.company
        AND s.revision=h.source_revision AND s.incarnation=h.source_incarnation
      JOIN delivery_client_shadow_meta a ON a.workspace_id=s.workspace_id
        AND a.generation=s.generation AND a.mode='active'
        AND a.compatibility_version=?`)
      .bind(JSON.stringify(selected.map(row => [row.company, row.id, row.generation])),
        workspace, authority!.version) : null;
    const results = await db.batch(bodies ? [bodies, marker] : [marker]);
    const markerResult = (results.at(-1)!.results[0] as { version: number } | undefined);
    if (markerResult?.version !== authority!.version) continue;
    const found = (bodies ? results[0].results : []) as TaskBody[];
    if (found.length !== selected.length) return null;
    const byId = new Map(found.map(row => [`${row.company}\u0000${row.id}`, row.body]));
    if (byId.size !== selected.length) return null;
    return {
      data: selected.map(row => JSON.parse(byId.get(`${row.company}\u0000${row.id}`)!) as unknown),
      total: positions.length,
      snapshotVersion: authority!.version,
      nextCursor: cursor + limit < positions.length ? String(cursor + limit) : null,
    };
  }
  throw new OperationError(409, 'snapshot_changed',
    'A lista mudou. Recomece pela primeira página.');
}
