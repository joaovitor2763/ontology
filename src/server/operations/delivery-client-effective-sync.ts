import { effectiveDeliveryRows, type EffectiveCycleRow, type EffectiveTaskRow } from '../delivery-effective.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';

export type ClientEffectiveHead = {
  authority_generation: string; source_revision: number; projection_generation: string;
  source_incarnation: string;
  expected_tasks: number; expected_cycles: number;
};

/** A missing or stale head is harmless: readers fall back to the client slice. */
export async function readClientEffectiveHead(db: D1Database, workspace: string, company: string) {
  return db.prepare(`SELECT authority_generation,source_revision,source_incarnation,projection_generation,
      expected_tasks,expected_cycles FROM delivery_client_effective_heads
    WHERE workspace_id=? AND company=?`).bind(workspace, company).first<ClientEffectiveHead>();
}

/** Diff one client's effective page inside the same batch as its new snapshot.
 * Returning no statements deliberately leaves a stale head for safe fallback. */
export function clientEffectiveStatements(
  db: D1Database, workspace: string, company: string, generation: string,
  oldRevision: number, incarnation: string,
  before: Partial<DeliverySnapshot>, after: Partial<DeliverySnapshot>,
  head: ClientEffectiveHead | null, budget: number,
): D1PreparedStatement[] {
  if (!head || head.authority_generation !== generation ||
      head.source_revision !== oldRevision ||
      head.source_incarnation !== incarnation || budget < 1) return [];
  const prior = effectiveDeliveryRows(before, company);
  if (prior.tasks.length !== head.expected_tasks ||
      prior.cycles.length !== head.expected_cycles) return [];
  const next = effectiveDeliveryRows(after, company);
  const statements: D1PreparedStatement[] = [];
  const diff = <Row extends EffectiveTaskRow | EffectiveCycleRow>(
    kind: 'tasks' | 'cycles', previous: Row[], current: Row[],
  ) => {
    const table = kind === 'tasks' ? 'delivery_effective_tasks' : 'delivery_effective_cycles';
    const old = new Map(previous.map(row => [row.id, row]));
    const following = new Map(current.map(row => [row.id, row]));
    for (const id of old.keys()) if (!following.has(id))
      statements.push(db.prepare(`DELETE FROM ${table}
        WHERE workspace_id=? AND generation=? AND company=? AND id=?`)
        .bind(workspace, head.projection_generation, company, id));
    for (const [id, row] of following) if (JSON.stringify(row) !== JSON.stringify(old.get(id))) {
      if (kind === 'tasks') {
        const task = row as EffectiveTaskRow;
        statements.push(db.prepare(`INSERT INTO delivery_effective_tasks
          (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,generation,company,id) DO UPDATE SET
            ordinal=excluded.ordinal,enrollment_id=excluded.enrollment_id,product_id=excluded.product_id,
            status=excluded.status,due_at=excluded.due_at,owner_id=excluded.owner_id,
            milestone=excluded.milestone,kind=excluded.kind,body=excluded.body`)
          .bind(workspace, head.projection_generation, company, task.id, task.ordinal,
            task.enrollmentId, task.productId, task.status, task.dueAt, task.ownerId,
            task.milestone, task.kind, task.body));
      } else {
        const cycle = row as EffectiveCycleRow;
        statements.push(db.prepare(`INSERT INTO delivery_effective_cycles
          (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,generation,company,id) DO UPDATE SET
            ordinal=excluded.ordinal,enrollment_id=excluded.enrollment_id,product_id=excluded.product_id,
            status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,body=excluded.body`)
          .bind(workspace, head.projection_generation, company, cycle.id, cycle.ordinal,
            cycle.enrollmentId, cycle.productId, cycle.status, cycle.startsAt, cycle.endsAt, cycle.body));
      }
    }
  };
  diff('tasks', prior.tasks, next.tasks);
  diff('cycles', prior.cycles, next.cycles);
  if (statements.length + 1 > budget) return [];
  statements.push(db.prepare(`UPDATE delivery_client_effective_heads SET
      source_revision=?,expected_tasks=?,expected_cycles=?,updated_at=?
    WHERE workspace_id=? AND company=? AND authority_generation=?
      AND source_revision=? AND source_incarnation=? AND projection_generation=?`)
    .bind(oldRevision + 1, next.tasks.length, next.cycles.length,
      new Date().toISOString(), workspace, company, generation, oldRevision,
      incarnation, head.projection_generation));
  return statements;
}
