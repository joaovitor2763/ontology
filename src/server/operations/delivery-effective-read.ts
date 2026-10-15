import { OperationError } from './errors.ts';

export type EffectivePageFilters = {
  status?: string; dueFrom?: string; dueTo?: string;
  ownerId?: string; enrollmentId?: string; sort?: 'position' | 'dueAt';
};

/** Returns null only when the read model is absent or behind the authority document. */
export async function readEffectiveDeliveryPage(
  db: D1Database, workspace: string, company: string, kind: 'tasks' | 'cycles',
  cursor: number, limit: number, filters: EffectivePageFilters,
  expectedVersion?: number, expectedClientSnapshot?: string,
) {
  const table = kind === 'tasks' ? 'delivery_effective_tasks' : 'delivery_effective_cycles';
  const conditions = ['r.workspace_id=m.workspace_id', 'r.generation=m.generation', 'r.company=?'];
  const values: (string | number)[] = [company];
  if (filters.status) { conditions.push('r.status=?'); values.push(filters.status); }
  if (filters.enrollmentId) { conditions.push('r.enrollment_id=?'); values.push(filters.enrollmentId); }
  if (kind === 'tasks') {
    if (filters.ownerId) { conditions.push('r.owner_id=?'); values.push(filters.ownerId); }
    if (filters.dueFrom || filters.dueTo) conditions.push("r.due_at IS NOT NULL AND r.due_at<>''");
    if (filters.dueFrom) { conditions.push('r.due_at>=?'); values.push(filters.dueFrom); }
    if (filters.dueTo) { conditions.push('r.due_at<=?'); values.push(filters.dueTo); }
  }
  const expectedCount = kind === 'tasks' ? 'expected_tasks' : 'expected_cycles';
  const current = (verifyCount: boolean) => `WITH m AS (SELECT p.workspace_id,p.generation,p.source_version,
      NULL AS client_snapshot FROM delivery_effective_meta p
    JOIN state_documents d ON d.workspace_id=p.workspace_id AND d.key='ontology.delivery.v2'
      AND d.version=p.source_version
    LEFT JOIN delivery_client_shadow_meta a ON a.workspace_id=p.workspace_id
    WHERE p.workspace_id=? AND (a.mode IS NULL OR a.mode<>'active')
    UNION ALL
    SELECT a.workspace_id,h.projection_generation,a.compatibility_version,
      a.generation||':'||s.incarnation||':'||s.revision
    FROM delivery_client_shadow_meta a
    JOIN state_documents d ON d.workspace_id=a.workspace_id
      AND d.key='ontology.delivery.v2' AND d.version=a.source_delivery_version
    JOIN state_documents c ON c.workspace_id=a.workspace_id
      AND c.key='ontology.clients.v3' AND c.version=a.source_clients_version
    JOIN delivery_client_snapshots s ON s.workspace_id=a.workspace_id
      AND s.generation=a.generation AND s.company=?
    JOIN delivery_client_effective_heads h ON h.workspace_id=a.workspace_id
      AND h.company=s.company AND h.authority_generation=a.generation
      AND h.source_revision=s.revision AND h.source_incarnation=s.incarnation
    WHERE a.workspace_id=? AND a.mode='active'
      ${verifyCount ? `AND (SELECT COUNT(*) FROM ${table} check_rows
        WHERE check_rows.workspace_id=a.workspace_id
          AND check_rows.generation=h.projection_generation
          AND check_rows.company=s.company)=h.${expectedCount}` : ''})`;
  const join = `${table} r ON ${conditions.join(' AND ')}`;
  const count = db.prepare(`${current(true)} SELECT m.source_version,m.client_snapshot,COUNT(r.id) AS total
    FROM m LEFT JOIN ${join} GROUP BY m.source_version,m.client_snapshot`).bind(workspace, company, workspace, ...values);
  const order = kind === 'tasks' && filters.sort === 'dueAt'
    ? filters.dueFrom || filters.dueTo ? 'r.due_at,r.id'
      : "CASE WHEN r.due_at IS NULL OR r.due_at='' THEN 1 ELSE 0 END,r.due_at,r.id"
    : 'r.ordinal,r.id';
  const page = db.prepare(`${current(false)} SELECT r.body FROM m JOIN ${join}
    ORDER BY ${order} LIMIT ? OFFSET ?`).bind(workspace, company, workspace, ...values, limit, cursor);
  const [countResult, pageResult] = await db.batch([count, page]);
  const summary = countResult.results[0] as { source_version: number; client_snapshot: string | null; total: number } | undefined;
  if (!summary) return null;
  if (expectedVersion !== undefined && expectedVersion !== summary.source_version)
    throw new OperationError(409, 'snapshot_changed', 'A lista mudou. Recomece pela primeira página.',
      { snapshotVersion: summary.source_version });
  if (expectedClientSnapshot !== undefined && expectedClientSnapshot !== summary.client_snapshot)
    throw new OperationError(409, 'snapshot_changed', 'A lista mudou. Recomece pela primeira página.',
      { clientSnapshot: summary.client_snapshot });
  const data = pageResult.results.map(row => JSON.parse((row as { body: string }).body) as unknown);
  return { data, total: summary.total, snapshotVersion: summary.source_version,
    ...(summary.client_snapshot ? { clientSnapshot: summary.client_snapshot } : {}),
    nextCursor: cursor + limit < summary.total ? String(cursor + limit) : null };
}
