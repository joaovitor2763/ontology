import { effectiveDeliveryRows, type EffectiveTaskRow, type EffectiveCycleRow } from '../delivery-effective.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';

const identity = (row: { company: string; id: string }) => `${row.company}\u0000${row.id}`;
const equal = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
// Leave room in D1's per-invocation query limit for guards, raw records,
// history, the receipt, and audit. A stale projection is rebuilt separately.
const MAX_EFFECTIVE_STATEMENTS = 400;

/** Mirror only changed effective rows while the validated read model is current. */
export async function effectiveDeliveryStatements(
  db: D1Database, workspace: string, oldVersion: number, previous: unknown, next: unknown,
  remainingStatements = MAX_EFFECTIVE_STATEMENTS,
): Promise<D1PreparedStatement[]> {
  const meta = await db.prepare('SELECT generation,source_version FROM delivery_effective_meta WHERE workspace_id=?')
    .bind(workspace).first<{ generation: string; source_version: number }>();
  if (!meta || meta.source_version !== oldVersion) return [];
  const activeGeneration = meta.generation;
  const before = effectiveDeliveryRows(previous as Partial<DeliverySnapshot>);
  const after = effectiveDeliveryRows(next as Partial<DeliverySnapshot>);
  const statements: D1PreparedStatement[] = [];
  const changed = new Set<string>();
  function diff<Row extends EffectiveTaskRow | EffectiveCycleRow>(kind: 'tasks' | 'cycles', oldRows: Row[], newRows: Row[]) {
    const prior = new Map(oldRows.map(row => [identity(row), row]));
    const current = new Map(newRows.map(row => [identity(row), row]));
    const table = kind === 'tasks' ? 'delivery_effective_tasks' : 'delivery_effective_cycles';
    for (const [key, row] of prior) if (!current.has(key)) {
      changed.add(row.company);
      statements.push(db.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND generation=? AND company=? AND id=?`)
        .bind(workspace, activeGeneration, row.company, row.id));
    }
    for (const [key, row] of current) if (!prior.has(key) || !equal(prior.get(key)!, row)) {
      changed.add(row.company);
      if (kind === 'tasks') {
        const task = row as EffectiveTaskRow;
        statements.push(db.prepare(`INSERT INTO delivery_effective_tasks
          (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,generation,company,id) DO UPDATE SET
          ordinal=excluded.ordinal,enrollment_id=excluded.enrollment_id,product_id=excluded.product_id,
          status=excluded.status,due_at=excluded.due_at,owner_id=excluded.owner_id,
          milestone=excluded.milestone,kind=excluded.kind,body=excluded.body`)
          .bind(workspace, activeGeneration, task.company, task.id, task.ordinal, task.enrollmentId, task.productId,
            task.status, task.dueAt, task.ownerId, task.milestone, task.kind, task.body));
      } else {
        const cycle = row as EffectiveCycleRow;
        statements.push(db.prepare(`INSERT INTO delivery_effective_cycles
          (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,generation,company,id) DO UPDATE SET
          ordinal=excluded.ordinal,enrollment_id=excluded.enrollment_id,product_id=excluded.product_id,
          status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,body=excluded.body`)
          .bind(workspace, activeGeneration, cycle.company, cycle.id, cycle.ordinal, cycle.enrollmentId,
            cycle.productId, cycle.status, cycle.startsAt, cycle.endsAt, cycle.body));
      }
    }
  }
  diff('tasks', before.tasks, after.tasks);
  diff('cycles', before.cycles, after.cycles);
  if (statements.length + changed.size + 1 > Math.min(MAX_EFFECTIVE_STATEMENTS, remainingStatements)) return [];
  const counts = new Map<string, { tasks: number; cycles: number }>();
  for (const task of after.tasks) {
    const count = counts.get(task.company) ?? { tasks: 0, cycles: 0 };
    count.tasks++; counts.set(task.company, count);
  }
  for (const cycle of after.cycles) {
    const count = counts.get(cycle.company) ?? { tasks: 0, cycles: 0 };
    count.cycles++; counts.set(cycle.company, count);
  }
  for (const company of changed) {
    const count = counts.get(company) ?? { tasks: 0, cycles: 0 };
    statements.push(db.prepare(`INSERT INTO delivery_client_revisions(workspace_id,generation,company,revision,task_count,cycle_count)
      VALUES(?,?,?,1,?,?) ON CONFLICT(workspace_id,generation,company) DO UPDATE SET
      revision=revision+1,task_count=excluded.task_count,cycle_count=excluded.cycle_count`)
      .bind(workspace, activeGeneration, company, count.tasks, count.cycles));
  }
  statements.push(db.prepare(`UPDATE delivery_effective_meta SET source_version=?,expected_tasks=?,
    expected_cycles=?,updated_at=? WHERE workspace_id=? AND generation=? AND source_version=?`)
    .bind(oldVersion + 1, after.tasks.length, after.cycles.length, new Date().toISOString(), workspace, activeGeneration, oldVersion));
  return statements;
}
