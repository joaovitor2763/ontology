import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';

export type DeadlineDependency = { sourceTaskId: string; targetTaskId: string };
export type ClientDeadlineHead = {
  authority_generation: string; source_revision: number; source_incarnation: string;
  projection_generation: string; expected_dependencies: number; actual_dependencies: number;
};

/** Reproduce the raw dependency check in removeUntouchedEnrollmentExecution.
 * A patch with its own deadline replaces the raw task deadline, even when
 * that replacement clears the reference. */
export function deliveryDeadlineDependencies(
  snapshot: Partial<DeliverySnapshot>, company: string,
): DeadlineDependency[] {
  const extraTasks = snapshot.extraTasks ?? [], patches = snapshot.taskPatches ?? {};
  const extras = new Set(extraTasks.map(task => task.id));
  const dependencies: DeadlineDependency[] = [];
  const include = (sourceTaskId: string, deadline: { mode?: string; taskId?: string } | undefined) => {
    if (deadline?.mode === 'task' && deadline.taskId)
      dependencies.push({ sourceTaskId, targetTaskId: deadline.taskId });
  };
  for (const task of extraTasks) {
    if (task.company !== company) continue;
    const patch = patches[task.id];
    include(task.id, patch && Object.hasOwn(patch, 'deadline')
      ? patch.deadline : task.deadline);
  }
  for (const [id, patch] of Object.entries(patches))
    if (!extras.has(id)) include(id, patch.deadline);
  // Match SQLite's binary ORDER BY used to certify a backfilled generation.
  return dependencies.sort((a, b) => a.sourceTaskId < b.sourceTaskId ? -1
    : a.sourceTaskId > b.sourceTaskId ? 1 : 0);
}

export async function readClientDeadlineHead(db: D1Database, workspace: string, company: string) {
  return db.prepare(`SELECT h.authority_generation,h.source_revision,h.source_incarnation,
      h.projection_generation,h.expected_dependencies,
      (SELECT COUNT(*) FROM delivery_client_deadline_dependencies d
        WHERE d.workspace_id=h.workspace_id AND d.projection_generation=h.projection_generation
          AND d.company=h.company) AS actual_dependencies
    FROM delivery_client_deadline_heads h WHERE h.workspace_id=? AND h.company=?`)
    .bind(workspace, company).first<ClientDeadlineHead>();
}

/** Certify the global absence rule before removing a client's raw task IDs.
 * The caller must guard compatibilityVersion in the eventual write batch.
 * The source task may itself be removed; only surviving sources veto removal. */
export async function noSurvivingDeadlineDependencies(
  db: D1Database, workspace: string, removedTaskIds: readonly string[],
  compatibilityVersion: number,
): Promise<boolean> {
  const ids = JSON.stringify(removedTaskIds);
  const row = await db.prepare(`SELECT m.expected_clients AS expected,
      COUNT(s.company) AS clients,
      SUM(CASE WHEN h.company IS NOT NULL AND
        h.authority_generation=m.generation AND h.source_revision=s.revision AND
        h.source_incarnation=s.incarnation AND h.expected_dependencies=(
          SELECT COUNT(*) FROM delivery_client_deadline_dependencies d
          WHERE d.workspace_id=h.workspace_id
            AND d.projection_generation=h.projection_generation AND d.company=h.company)
        THEN 1 ELSE 0 END) AS certified,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM delivery_client_deadline_dependencies d
        WHERE d.workspace_id=h.workspace_id
          AND d.projection_generation=h.projection_generation AND d.company=h.company
          AND d.target_task_id IN (SELECT value FROM json_each(?))
          AND d.source_task_id NOT IN (SELECT value FROM json_each(?))
      ) THEN 1 ELSE 0 END) AS surviving_dependencies
    FROM delivery_client_shadow_meta m
    JOIN state_documents source ON source.workspace_id=m.workspace_id
      AND source.key='ontology.delivery.v2' AND source.version=m.source_delivery_version
    JOIN state_documents clients_source ON clients_source.workspace_id=m.workspace_id
      AND clients_source.key='ontology.clients.v3' AND clients_source.version=m.source_clients_version
    LEFT JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
      AND s.generation=m.generation
    LEFT JOIN delivery_client_deadline_heads h ON h.workspace_id=s.workspace_id
      AND h.company=s.company
    WHERE m.workspace_id=? AND m.mode='active' AND m.compatibility_version=?
    GROUP BY m.workspace_id`).bind(ids, ids, workspace, compatibilityVersion)
    .first<{ expected: number; clients: number; certified: number;
      surviving_dependencies: number }>();
  return !!row && row.clients === row.expected && row.certified === row.expected &&
    row.surviving_dependencies === 0;
}

/** A stale head stays stale after the slice revision advances. */
export function clientDeadlineStatements(
  db: D1Database, workspace: string, company: string, generation: string,
  oldRevision: number, incarnation: string,
  before: Partial<DeliverySnapshot>, after: Partial<DeliverySnapshot>,
  head: ClientDeadlineHead | null, budget: number,
  observedBefore?: ReadonlyMap<string, string>,
): D1PreparedStatement[] {
  if (!head || head.authority_generation !== generation ||
      head.source_revision !== oldRevision || head.source_incarnation !== incarnation ||
      head.actual_dependencies !== head.expected_dependencies || budget < 1) return [];
  const prior = new Map(deliveryDeadlineDependencies(before, company)
    .map(row => [row.sourceTaskId, row.targetTaskId]));
  if (prior.size !== head.expected_dependencies ||
      observedBefore && (observedBefore.size !== prior.size ||
        [...prior].some(([id, target]) => observedBefore.get(id) !== target))) return [];
  const next = new Map(deliveryDeadlineDependencies(after, company)
    .map(row => [row.sourceTaskId, row.targetTaskId]));
  const statements: D1PreparedStatement[] = [];
  for (const [id, target] of prior) if (next.get(id) !== target)
    statements.push(db.prepare(`DELETE FROM delivery_client_deadline_dependencies
      WHERE workspace_id=? AND projection_generation=? AND company=? AND source_task_id=?`)
      .bind(workspace, head.projection_generation, company, id));
  for (const [id, target] of next) if (prior.get(id) !== target)
    statements.push(db.prepare(`INSERT INTO delivery_client_deadline_dependencies
      (workspace_id,projection_generation,company,source_task_id,target_task_id)
      VALUES(?,?,?,?,?)`).bind(workspace, head.projection_generation, company, id, target));
  if (statements.length + 1 > budget) return [];
  statements.push(db.prepare(`UPDATE delivery_client_deadline_heads SET
      source_revision=?,expected_dependencies=?,updated_at=?
    WHERE workspace_id=? AND company=? AND authority_generation=?
      AND source_revision=? AND source_incarnation=? AND projection_generation=?`)
    .bind(oldRevision + 1, next.size, new Date().toISOString(), workspace, company,
      generation, oldRevision, incarnation, head.projection_generation));
  return statements;
}
