import { getDoc } from '../db.ts';
import { clientAccessRows } from '../client-access.ts';

const KEY = 'ontology.clients.v3';
type Meta = { generation: string; source_clients_version: number; expected_companies: number };

/** A stale or oversized mirror is skipped; authorization then reads the source document. */
export async function clientAccessStatements(
  db: D1Database, workspace: string, writes: readonly { key: string; value: unknown }[], budget: number,
): Promise<D1PreparedStatement[]> {
  const next = writes.find(write => write.key === KEY);
  if (!next || budget < 1) return [];
  const meta = await db.prepare(`SELECT generation,source_clients_version,expected_companies
    FROM client_access_meta WHERE workspace_id=?`).bind(workspace).first<Meta>();
  if (!meta) return [];
  const previous = await getDoc(db, workspace, KEY);
  if (meta.source_clients_version !== (previous?.version ?? 0)) return [];
  const before = clientAccessRows(previous?.value ?? {}), after = clientAccessRows(next.value);
  const statements: D1PreparedStatement[] = [];
  for (const [company, body] of after) if (before.get(company) !== body)
    statements.push(db.prepare(`INSERT INTO client_access_allocations
      (workspace_id,generation,company,body) VALUES(?,?,?,?)
      ON CONFLICT(workspace_id,generation,company) DO UPDATE SET body=excluded.body`)
      .bind(workspace, meta.generation, company, body));
  for (const company of before.keys()) if (!after.has(company))
    statements.push(db.prepare(`DELETE FROM client_access_allocations
      WHERE workspace_id=? AND generation=? AND company=?`)
      .bind(workspace, meta.generation, company));
  if (statements.length + 1 > budget) return [];
  statements.push(db.prepare(`UPDATE client_access_meta SET
    source_clients_version=?,expected_companies=?,updated_at=?
    WHERE workspace_id=? AND generation=? AND source_clients_version=?`)
    .bind(meta.source_clients_version + 1,
      meta.expected_companies + after.size - before.size, new Date().toISOString(),
      workspace, meta.generation, meta.source_clients_version));
  return statements;
}
