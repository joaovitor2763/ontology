import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { encodeCompressedStateBody } from '../state-body.ts';
import { deliveryMapOrder } from '../delivery-client-slices.ts';
import { historyObservations } from '../delivery-history.ts';
import { readClientShadowSnapshot } from './delivery-client-shadow-read.ts';
import { clientEffectiveStatements, readClientEffectiveHead } from './delivery-client-effective-sync.ts';
import { clientPlanClaimStatements, deliveryPlanClaims, readClientPlanClaimHead } from './delivery-client-plan-claims.ts';
import { clientDeadlineStatements, readClientDeadlineHead } from './delivery-client-deadline-dependencies.ts';
import { OperationError } from './errors.ts';
import { markSliceWrite } from './delivery-client-summary-sync.ts';

type ActiveTaskSlice = { company: string; generation: string; incarnation: string;
  revision: number; version: number; snapshot: DeliverySnapshot };
export class ClientScopeRequiresBridge extends Error {}
export const clientSnapshotFor = (slice: ActiveTaskSlice, revision = slice.revision) =>
  `${slice.generation}:${slice.incarnation}:${revision}`;

/** Resolve a task owner before loading only that client's slice. */
export async function readActiveTaskSlice(
  db: D1Database, workspace: string, taskId: string,
): Promise<ActiveTaskSlice | null> {
  const owner = await db.prepare(`SELECT m.mode,o.company FROM delivery_client_shadow_meta m
    LEFT JOIN delivery_entity_owners o ON o.workspace_id=m.workspace_id
      AND o.generation=m.generation AND o.kind='task' AND o.id=?
    WHERE m.workspace_id=?`).bind(taskId, workspace)
    .first<{ mode: string; company: string | null }>();
  if (owner?.mode !== 'active' || !owner.company) return null;
  const slice = await readClientShadowSnapshot(db, workspace, owner.company, true, true);
  if (!slice?.clientSnapshot) return null;
  const [generation, incarnation] = slice.clientSnapshot.split(':');
  if (!generation || !incarnation || incarnation === 'missing')
    throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
  return { company: owner.company, generation, incarnation,
    revision: slice.revision, version: slice.sourceVersion, snapshot: slice.snapshot };
}

/** A batch without a client marker can use one slice only when every unique
 * task is currently indexed under the same active generation and client. */
export async function readActiveTaskBatchSlice(
  db: D1Database, workspace: string, taskIds: unknown,
): Promise<ActiveTaskSlice | null> {
  if (!Array.isArray(taskIds) || taskIds.length < 2 || taskIds.length > 500 ||
      taskIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id) || id.length > 180) ||
      new Set(taskIds).size !== taskIds.length) return null;
  const indexed = await db.prepare(`WITH requested AS (
      SELECT value AS id FROM json_each(?)
    ) SELECT m.mode,COUNT(*) AS requested,COUNT(o.id) AS matched,
      COUNT(DISTINCT o.company) AS owners,MIN(o.company) AS company
    FROM delivery_client_shadow_meta m CROSS JOIN requested r
    LEFT JOIN delivery_entity_owners o ON o.workspace_id=m.workspace_id
      AND o.generation=m.generation AND o.kind='task' AND o.id=r.id
    WHERE m.workspace_id=? GROUP BY m.mode`)
    .bind(JSON.stringify(taskIds), workspace)
    .first<{ mode: string; requested: number; matched: number; owners: number; company: string | null }>();
  if (indexed?.mode !== 'active' || indexed.requested !== taskIds.length ||
      indexed.matched !== taskIds.length || indexed.owners !== 1 || !indexed.company)
    return null;
  const slice = await readActiveCompanySlice(db, workspace, indexed.company);
  if (!slice) return null;
  const present = new Set(projectDelivery(slice.snapshot).tasks.map(task => task.id));
  return taskIds.every(id => present.has(id)) ? slice : null;
}

export async function readActiveCompanySlice(
  db: D1Database, workspace: string, company: string,
): Promise<ActiveTaskSlice | null> {
  const slice = await readClientShadowSnapshot(db, workspace, company, true, true);
  if (!slice?.clientSnapshot) return null;
  const [generation, incarnation] = slice.clientSnapshot.split(':');
  if (!generation || !incarnation || incarnation === 'missing')
    throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
  return { company, generation, incarnation, revision: slice.revision,
    version: slice.sourceVersion, snapshot: slice.snapshot };
}

export async function readActiveCycleCompany(
  db: D1Database, workspace: string, cycleId: string,
) {
  const row = await db.prepare(`SELECT m.mode,o.company FROM delivery_client_shadow_meta m
    LEFT JOIN delivery_entity_owners o ON o.workspace_id=m.workspace_id
      AND o.generation=m.generation AND o.kind='cycle' AND o.id=?
    WHERE m.workspace_id=?`).bind(cycleId, workspace)
    .first<{ mode: string; company: string | null }>();
  return row?.mode === 'active' ? row.company : null;
}

const digest = async (plain: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** The domain transformation is shared with delivery.ts. This only persists
 * its result and the derived indexes within the operation's D1 batch. */
export async function activeTaskStatements(
  db: D1Database, workspace: string, slice: ActiveTaskSlice,
  after: DeliverySnapshot, budget: number, command: string,
  publicJourneyIds: ReadonlySet<string> = new Set(),
  taskCreatedInsideCycle = false,
  composedClientVersion?: number,
  certifiedPrivatePlanCreation = false,
  certifiedPrivatePlanDeletionIds: ReadonlySet<string> = new Set(),
  certifiedPrivatePlanReplacementIds: ReadonlySet<string> = new Set(),
  rebuildTail?: { enrollmentId: string; extraTasks: string[]; extraCycles: string[] },
): Promise<D1PreparedStatement[]> {
  const beforeProjected = projectDelivery(slice.snapshot);
  const afterProjected = projectDelivery(after);
  const scoped = <T extends { id: string; company: string }>(rows: T[]) =>
    new Set(rows.filter(row => row.company === slice.company).map(row => row.id));
  const beforeTasks = scoped(beforeProjected.tasks), afterTasks = scoped(afterProjected.tasks);
  const beforeCycles = scoped(beforeProjected.cycles), afterCycles = scoped(afterProjected.cycles);
  const previousPlans = slice.snapshot.productPlans ?? {};
  const nextPlans = after.productPlans ?? {};
  const addedPlans = Object.keys(nextPlans).filter(id => !Object.hasOwn(previousPlans, id));
  const removedPlans = Object.keys(previousPlans).filter(id => !Object.hasOwn(nextPlans, id));
  const unchangedPriorPlans = Object.entries(previousPlans).every(([id, plan]) =>
    !Object.hasOwn(nextPlans, id) || JSON.stringify(nextPlans[id]) === JSON.stringify(plan));
  const allowedCreation = (composedClientVersion !== undefined || certifiedPrivatePlanCreation) &&
    removedPlans.length === 0 && addedPlans.length === publicJourneyIds.size &&
    addedPlans.every(id => publicJourneyIds.has(id)) && unchangedPriorPlans;
  const allowedDeletion = composedClientVersion !== undefined && addedPlans.length === 0 &&
    removedPlans.length === certifiedPrivatePlanDeletionIds.size &&
    removedPlans.every(id => certifiedPrivatePlanDeletionIds.has(id)) && unchangedPriorPlans;
  const allowedReplacement = composedClientVersion !== undefined &&
    addedPlans.length === 0 && removedPlans.length === 0 &&
    [...certifiedPrivatePlanReplacementIds].every(id => Object.hasOwn(previousPlans, id) &&
      Object.hasOwn(nextPlans, id)) &&
    Object.entries(previousPlans).every(([id, plan]) =>
      certifiedPrivatePlanReplacementIds.has(id) ||
      JSON.stringify(nextPlans[id]) === JSON.stringify(plan));
  if ((addedPlans.length || JSON.stringify(previousPlans) !== JSON.stringify(nextPlans)) &&
      !allowedCreation && !allowedDeletion && !allowedReplacement)
    throw new ClientScopeRequiresBridge();
  const previousClaims = new Set(deliveryPlanClaims(slice.snapshot, slice.company));
  const previousTasks = new Map(beforeProjected.tasks.map(task => [task.id, task]));
  const newClaims = [...new Set([
    ...deliveryPlanClaims(after, slice.company).filter(id => !previousClaims.has(id)),
    ...afterProjected.tasks.filter(task => task.company === slice.company && task.journeyId &&
      previousTasks.get(task.id)?.journeyId !== task.journeyId).map(task => task.journeyId!),
  ])].filter(id => !Object.hasOwn(previousPlans, id));
  if (newClaims.length) {
    const protection = await db.prepare(`SELECT
        m.expected_map_order AS expected,
        (SELECT COUNT(*) FROM delivery_client_map_order p
          WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation) AS actual,
        EXISTS(SELECT 1 FROM delivery_client_map_order p
          WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation
            AND p.kind='productPlans' AND p.id IN (SELECT value FROM json_each(?))) AS collision
      FROM delivery_client_shadow_meta m
      WHERE m.workspace_id=? AND m.generation=? AND m.mode='active'`)
      .bind(JSON.stringify(newClaims), workspace, slice.generation)
      .first<{ expected: number; actual: number; collision: number }>();
    if (!protection || protection.expected !== protection.actual || protection.collision)
      throw new ClientScopeRequiresBridge();
  }
  for (const task of afterProjected.tasks.filter(task => task.company === slice.company))
    if (task.journeyId && previousTasks.get(task.id)?.journeyId !== task.journeyId &&
      !publicJourneyIds.has(task.journeyId) &&
      !Object.hasOwn(slice.snapshot.productPlans ?? {}, task.journeyId))
      throw new ClientScopeRequiresBridge();
  const orderChanges: { kind: 'extraTasks' | 'extraCycles'; added: string[]; removed: string[];
    prepend: boolean; rebuildTail?: string[] }[] = [];
  const previousCycles = new Map((slice.snapshot.extraCycles ?? []).map(cycle => [cycle.id, cycle]));
  const reappendCycle = (command === 'cycles.save' || command === 'tasks.create')
    ? (after.extraCycles ?? []).find(cycle => {
        const previous = previousCycles.get(cycle.id);
        return previous && JSON.stringify(previous) !== JSON.stringify(cycle);
      })?.id
    : undefined;
  for (const kind of ['extraTasks', 'extraCycles'] as const) {
    const beforeRows = slice.snapshot[kind] ?? [], afterRows = after[kind] ?? [];
    const prior = beforeRows.map(row => row.id), next = afterRows.map(row => row.id);
    const old = new Set(prior), current = new Set(next);
    const commonBefore = prior.filter(id => current.has(id));
    const commonAfter = next.filter(id => old.has(id));
    const added = next.filter(id => !old.has(id));
    const removed = prior.filter(id => !current.has(id));
    const tail = command === 'enrollments.rebuild' ? rebuildTail?.[kind] : undefined;
    const tailSet = new Set(tail);
    const validRebuild = tail !== undefined && tailSet.size === tail.length &&
      JSON.stringify(next) === JSON.stringify([
        ...prior.filter(id => current.has(id) && !tailSet.has(id)), ...tail]) &&
      JSON.stringify(afterRows.filter(row => row.enrollmentId === rebuildTail?.enrollmentId)
        .map(row => row.id)) === JSON.stringify(tail) &&
      beforeRows.filter(row => row.enrollmentId === rebuildTail?.enrollmentId)
        .every(row => !current.has(row.id) || tailSet.has(row.id)) &&
      added.every(id => tailSet.has(id)) &&
      removed.every(id => beforeRows.find(row => row.id === id)?.enrollmentId ===
        rebuildTail?.enrollmentId);
    const reorderedCycle = kind === 'extraCycles' && reappendCycle &&
      JSON.stringify(commonAfter) === JSON.stringify([
        ...commonBefore.filter(id => id !== reappendCycle), reappendCycle,
      ]);
    if (new Set(next).size !== next.length ||
        (command === 'enrollments.rebuild' ? !validRebuild :
          !reorderedCycle && JSON.stringify(commonAfter) !== JSON.stringify(commonBefore)))
      throw new ClientScopeRequiresBridge();
    const prepend = kind === 'extraTasks' &&
      (command === 'cycles.save' || command === 'tasks.create' && taskCreatedInsideCycle);
    if (!tail && added.length && (prepend
      ? JSON.stringify(next.slice(0, added.length)) !== JSON.stringify(added)
      : JSON.stringify(next.slice(-added.length)) !== JSON.stringify(added)))
      throw new ClientScopeRequiresBridge();
    orderChanges.push({ kind, added, removed, prepend, rebuildTail: tail });
  }
  const beforeOrder = deliveryMapOrder(slice.snapshot), afterOrder = deliveryMapOrder(after);
  const added = [...afterOrder.keys()].filter(identity => !beforeOrder.has(identity));
  const removed = [...beforeOrder.keys()].filter(identity => !afterOrder.has(identity));
  const body = JSON.stringify(after), transactionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO delivery_client_guards
      (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
      VALUES(?,?,?,?,?,'active',?)`)
      .bind(transactionId, workspace, slice.company, slice.generation, slice.revision, slice.incarnation),
  ];
  if (newClaims.length) statements.push(db.prepare(`INSERT INTO delivery_compatibility_guards
    (transaction_id,workspace_id,generation,expected_version) VALUES(?,?,?,?)`)
    .bind(transactionId, workspace, slice.generation, slice.version));
  statements.push(markSliceWrite(db, workspace, db.prepare(`UPDATE delivery_client_snapshots SET revision=revision+1,body=?,body_sha256=?
      WHERE workspace_id=? AND generation=? AND company=? AND revision=? AND incarnation=?`)
      .bind(await encodeCompressedStateBody(after), await digest(body), workspace,
        slice.generation, slice.company, slice.revision, slice.incarnation),
    { company: slice.company, generation: slice.generation, revision: slice.revision + 1,
      incarnation: slice.incarnation, plain: body }));
  for (const identity of added) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal)
      VALUES(?,?,?,?,(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_map_order
        WHERE workspace_id=? AND generation=? AND kind=?))`)
      .bind(workspace, slice.generation, kind, id, workspace, slice.generation, kind));
  }
  for (const identity of removed) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`DELETE FROM delivery_client_map_order
      WHERE workspace_id=? AND generation=? AND kind=? AND id=?`)
      .bind(workspace, slice.generation, kind, id));
  }
  for (const [kind, previous, current] of [
    ['task', beforeTasks, afterTasks], ['cycle', beforeCycles, afterCycles],
  ] as const) {
    for (const id of current) if (!previous.has(id)) statements.push(db.prepare(`INSERT INTO delivery_entity_owners
      (workspace_id,generation,kind,id,company) VALUES(?,?,?,?,?)`)
      .bind(workspace, slice.generation, kind, id, slice.company));
    for (const id of previous) if (!current.has(id)) statements.push(db.prepare(`DELETE FROM delivery_entity_owners
      WHERE workspace_id=? AND generation=? AND kind=? AND id=? AND company=?`)
      .bind(workspace, slice.generation, kind, id, slice.company));
  }
  for (const change of orderChanges) {
    for (const id of change.removed) statements.push(db.prepare(`DELETE FROM delivery_client_array_order
      WHERE workspace_id=? AND generation=? AND kind=? AND id=?`)
      .bind(workspace, slice.generation, change.kind, id));
    if (change.rebuildTail) {
      const fresh = new Set(change.added);
      for (const id of change.rebuildTail) if (fresh.has(id))
        statements.push(db.prepare(`INSERT INTO delivery_client_array_order
          (workspace_id,generation,kind,id,ordinal,company)
          VALUES(?,?,?, ?, (SELECT COALESCE(MAX(ordinal)+1,0)
            FROM delivery_client_array_order WHERE workspace_id=? AND generation=? AND kind=?),?)`)
          .bind(workspace, slice.generation, change.kind, id,
            workspace, slice.generation, change.kind, slice.company));
      else statements.push(db.prepare(`UPDATE delivery_client_array_order
        SET ordinal=(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_array_order
          WHERE workspace_id=? AND generation=? AND kind=?)
        WHERE workspace_id=? AND generation=? AND kind=? AND id=? AND company=?`)
        .bind(workspace, slice.generation, change.kind,
          workspace, slice.generation, change.kind, id, slice.company));
      continue;
    }
    const inserting = change.prepend ? [...change.added].reverse() : change.added;
    for (const id of inserting) statements.push(db.prepare(`INSERT INTO delivery_client_array_order
      (workspace_id,generation,kind,id,ordinal,company)
      VALUES(?,?,?, ?, (SELECT COALESCE(${change.prepend ? 'MIN(ordinal)-1' : 'MAX(ordinal)+1'},0)
        FROM delivery_client_array_order WHERE workspace_id=? AND generation=? AND kind=?),?)`)
      .bind(workspace, slice.generation, change.kind, id,
        workspace, slice.generation, change.kind, slice.company));
  }
  // saveCycleAggregate appends an edited cycle, including when a task is added
  // inside it. Reproduce that order across clients without reading their slices.
  if (reappendCycle) statements.push(db.prepare(`UPDATE delivery_client_array_order
    SET ordinal=(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_array_order
      WHERE workspace_id=? AND generation=? AND kind='extraCycles')
    WHERE workspace_id=? AND generation=? AND kind='extraCycles' AND id=?`)
    .bind(workspace, slice.generation, workspace, slice.generation, reappendCycle));
  const ownerDelta = afterTasks.size - beforeTasks.size + afterCycles.size - beforeCycles.size;
  const arrayDelta = orderChanges.reduce((sum, row) => sum + row.added.length - row.removed.length, 0);
  statements.push(db.prepare(`UPDATE delivery_client_shadow_meta SET
      expected_map_order=expected_map_order+?,expected_owners=expected_owners+?,
      expected_array_order=expected_array_order+?,compatibility_version=compatibility_version+1,
      source_clients_version=source_clients_version+?,
      updated_at=? WHERE workspace_id=? AND generation=? AND mode='active'
        AND (? IS NULL OR source_clients_version=?)`)
    .bind(added.length - removed.length, ownerDelta, arrayDelta,
      composedClientVersion === undefined ? 0 : 1,
      new Date().toISOString(), workspace, slice.generation,
      composedClientVersion ?? null, composedClientVersion ?? null));
  const taskIds = new Set(afterProjected.tasks.filter(task => task.company === slice.company)
    .map(task => task.id));
  const previous = new Set((await historyObservations(slice.snapshot, taskIds))
    .map(entry => `${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`));
  for (const entry of await historyObservations(after, taskIds)) {
    if (entry.isLegacySummary || previous.has(`${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`)) continue;
    statements.push(db.prepare(`INSERT INTO delivery_task_history
      (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,
       is_legacy_summary,source_first_version,source_last_version)
      SELECT ?,?,?,?,?,?,?,0,m.compatibility_version,m.compatibility_version
      FROM delivery_client_shadow_meta m WHERE m.workspace_id=? AND m.generation=? AND m.mode='active'`)
      .bind(workspace, entry.taskId, crypto.randomUUID(), entry.entryHash, entry.occurrence,
        entry.entryJson, entry.eventAt, workspace, slice.generation));
  }
  const claimHead = await readClientPlanClaimHead(db, workspace, slice.company);
  statements.push(...clientPlanClaimStatements(db, workspace, slice.company,
    slice.generation, slice.revision, slice.incarnation, slice.snapshot, after, claimHead,
    Math.max(0, Math.min(200, budget - statements.length - 1))));
  const deadlineHead = await readClientDeadlineHead(db, workspace, slice.company);
  statements.push(...clientDeadlineStatements(db, workspace, slice.company,
    slice.generation, slice.revision, slice.incarnation, slice.snapshot, after, deadlineHead,
    Math.max(0, Math.min(200, budget - statements.length - 1))));
  const head = await readClientEffectiveHead(db, workspace, slice.company);
  statements.push(...clientEffectiveStatements(db, workspace, slice.company,
    slice.generation, slice.revision, slice.incarnation, slice.snapshot, after, head,
    Math.max(0, Math.min(400, budget - statements.length - 1))));
  statements.push(db.prepare('DELETE FROM delivery_client_guards WHERE transaction_id=?')
    .bind(transactionId));
  if (newClaims.length) statements.push(db.prepare('DELETE FROM delivery_compatibility_guards WHERE transaction_id=?')
    .bind(transactionId));
  if (statements.length > budget) throw new OperationError(503, 'execution_write_too_large',
    'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
  return statements;
}
