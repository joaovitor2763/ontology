import { decodeStateBody } from '../state-body.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { OperationError } from './errors.ts';

/** A single consistent client read, accepted only while both source documents match. */
export async function readClientShadowSnapshot(
  db: D1Database, workspace: string, company: string, verifyHash = false,
  activeOnly = false,
): Promise<{ snapshot: DeliverySnapshot; sourceVersion: number; revision: number;
  clientSnapshot?: string } | null> {
  const row = await db.prepare(`SELECT s.body,s.body_sha256,s.revision,s.incarnation,m.generation,m.mode,
      d.version AS delivery_version,c.version AS clients_version,
      m.source_delivery_version,m.source_clients_version,
      CASE WHEN m.mode='active' THEN m.compatibility_version
        ELSE m.source_delivery_version END AS read_version
    FROM delivery_client_shadow_meta m
    LEFT JOIN state_documents d ON d.workspace_id=m.workspace_id
      AND d.key='ontology.delivery.v2'
    LEFT JOIN state_documents c ON c.workspace_id=m.workspace_id
      AND c.key='ontology.clients.v3'
    LEFT JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
      AND s.generation=m.generation AND s.company=?
    WHERE m.workspace_id=? ${activeOnly ? "AND m.mode='active'" : ''}`).bind(company, workspace)
    .first<{ body: string | null; body_sha256: string | null;
      revision: number | null; incarnation: string | null;
      generation: string; mode: string; read_version: number;
      delivery_version: number | null; clients_version: number | null;
      source_delivery_version: number; source_clients_version: number }>();
  if (!row) return null;
  if (row.delivery_version !== row.source_delivery_version ||
      row.clients_version !== row.source_clients_version) {
    if (row.mode === 'active') throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
    return null;
  }
  if (row.mode !== 'active' && row.body === null) return null;
  const snapshot = row.body === null ? {} as DeliverySnapshot : await decodeStateBody(row.body) as DeliverySnapshot;
  if (verifyHash && row.body) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== row.body_sha256) throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
  }
  return { snapshot,
    sourceVersion: row.read_version, revision: row.revision ?? 0,
    ...(row.mode === 'active'
      ? { clientSnapshot: `${row.generation}:${row.incarnation ?? 'missing'}:${row.revision ?? 0}` }
      : {}) };
}
