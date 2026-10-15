import { getDoc } from '../db.ts';
import { partitionDeliverySnapshot, type DeliveryRecord } from '../delivery-records.ts';
import { historyObservations } from '../delivery-history.ts';
import { effectiveDeliveryStatements } from './delivery-effective-sync.ts';
import { OperationError } from './errors.ts';

const KEY = 'ontology.delivery.v2';
const same = (a: DeliveryRecord, b: DeliveryRecord) =>
  a.body === b.body && a.ordinal === b.ordinal && a.company === b.company &&
  a.enrollmentId === b.enrollmentId && a.productId === b.productId &&
  a.status === b.status && a.dueAt === b.dueAt;

/** Durable task history remains mandatory when the global document is frozen. */
export async function activeDeliveryHistoryStatements(
  db: D1Database, workspace: string, oldVersion: number, next: unknown, budget: number,
): Promise<D1PreparedStatement[]> {
  const previous = (await getDoc(db, workspace, KEY))?.value ?? {};
  const oldHistory = new Set((await historyObservations(previous))
    .map(row => `${row.taskId}\u0000${row.entryHash}\u0000${row.occurrence}`));
  const statements: D1PreparedStatement[] = [];
  for (const entry of await historyObservations(next)) {
    if (entry.isLegacySummary || oldHistory.has(`${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`)) continue;
    statements.push(db.prepare(`INSERT INTO delivery_task_history
      (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,is_legacy_summary,source_first_version,source_last_version)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(workspace, entry.taskId, crypto.randomUUID(), entry.entryHash, entry.occurrence,
        entry.entryJson, entry.eventAt, 0, oldVersion + 1, oldVersion + 1));
  }
  if (statements.length > budget) throw new OperationError(503, 'execution_write_too_large',
    'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
  return statements;
}

/** Keep history in the command batch even when the relational generation is stale. */
export async function deliveryRecordStatements(
  db: D1Database, workspace: string, oldVersion: number, next: unknown, statementBudget = 850,
): Promise<D1PreparedStatement[]> {
  const generation = await db.prepare(
    "SELECT generation FROM delivery_generations WHERE workspace_id=? AND status='active' AND source_version=? ORDER BY generation DESC LIMIT 1",
  ).bind(workspace, oldVersion).first<{generation:number}>();
  const previous = (await getDoc(db, workspace, KEY))?.value ?? {};
  const oldRows = generation ? new Map(partitionDeliverySnapshot(previous).map(row => [`${row.kind}\u0000${row.id}`, row])) : new Map<string, DeliveryRecord>();
  const nextRows = generation ? new Map(partitionDeliverySnapshot(next).map(row => [`${row.kind}\u0000${row.id}`, row])) : new Map<string, DeliveryRecord>();
  const statements: D1PreparedStatement[] = [];
  const changedTasks = new Set<string>();
  for (const [identity, row] of nextRows) {
    const old = oldRows.get(identity);
    if (old && same(old, row)) continue;
    if (row.kind === 'extraTasks' || row.kind === 'taskPatches') changedTasks.add(row.id);
    statements.push(db.prepare(
      `INSERT INTO delivery_records(workspace_id,generation,kind,id,ordinal,company,enrollment_id,product_id,status,due_at,body)
       VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,generation,kind,id) DO UPDATE SET
       ordinal=excluded.ordinal,company=excluded.company,enrollment_id=excluded.enrollment_id,
       product_id=excluded.product_id,status=excluded.status,due_at=excluded.due_at,body=excluded.body`,
    ).bind(workspace, generation!.generation, row.kind, row.id, row.ordinal, row.company,
      row.enrollmentId, row.productId, row.status, row.dueAt, row.body));
  }
  for (const [identity, row] of oldRows) if (!nextRows.has(identity)) {
    if (row.kind === 'extraTasks' || row.kind === 'taskPatches') changedTasks.add(row.id);
    statements.push(db.prepare('DELETE FROM delivery_records WHERE workspace_id=? AND generation=? AND kind=? AND id=?')
      .bind(workspace, generation!.generation, row.kind, row.id));
  }
  const rawStatementCount = statements.length;
  const observedTasks = generation ? changedTasks : undefined;
  const oldHistory = new Set((await historyObservations(previous, observedTasks))
      .map(row => `${row.taskId}\u0000${row.entryHash}\u0000${row.occurrence}`));
  for (const entry of await historyObservations(next, observedTasks)) {
      if (entry.isLegacySummary || oldHistory.has(`${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`)) continue;
      statements.push(db.prepare(`INSERT INTO delivery_task_history
        (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,is_legacy_summary,source_first_version,source_last_version)
        VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .bind(workspace, entry.taskId, crypto.randomUUID(), entry.entryHash, entry.occurrence,
          entry.entryJson, entry.eventAt, 0, oldVersion + 1, oldVersion + 1));
  }
  // The mirrors are optional. Preserve the command and task history when a
  // bulk update would exceed D1's invocation limit; stale mirrors fall back.
  let mirrorRaw = Boolean(generation);
  if (statements.length + (generation ? 1 : 0) > statementBudget && rawStatementCount) {
    statements.splice(0, rawStatementCount);
    mirrorRaw = false;
  }
  statements.push(...await effectiveDeliveryStatements(db, workspace, oldVersion, previous, next,
    Math.max(0, statementBudget - statements.length - (mirrorRaw ? 1 : 0))));
  if (!mirrorRaw || !generation) return statements;
  const bytes = new TextEncoder().encode(JSON.stringify(next));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  statements.push(db.prepare(
    "UPDATE delivery_generations SET source_version=?,source_sha256=?,expected_records=? WHERE workspace_id=? AND generation=? AND source_version=? AND status='active'",
  ).bind(oldVersion + 1, hash, nextRows.size, workspace, generation.generation, oldVersion));
  return statements;
}
