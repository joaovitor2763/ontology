import { encodeStateBody } from '../state-body.ts';
import { forgetDocuments } from './request-context.ts';
import { readActiveDeliveryCompatibility } from './delivery-compatibility-read.ts';
import { OperationError } from './errors.ts';
import { decodeStateBody } from '../state-body.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';

/** Restore a complete, current global document before returning to shadow mode.
 * The mode switch and the document write are one D1 transaction; no old Worker
 * can observe a shadow marker with the frozen body. Caller must arrange a fresh
 * external backup and quiesce writers before running this maintenance action. */
export async function rollbackClientAuthority(
  db: D1Database, workspace: string, expectedVersion: number, actor: string,
): Promise<{ version: number }> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !actor)
    throw new OperationError(422, 'invalid_rollback', 'Informe a versão e o responsável pela reversão.');
  const reconstructed = await readActiveDeliveryCompatibility(db, workspace);
  if (!reconstructed || reconstructed.version !== expectedVersion)
    throw new OperationError(409, 'version_conflict', 'A execução mudou. Revise a versão antes de reverter.');
  const meta = await db.prepare(`SELECT generation,source_delivery_version,expected_owners,
      expected_clients
    FROM delivery_client_shadow_meta WHERE workspace_id=? AND mode='active'
      AND compatibility_version=?`).bind(workspace, expectedVersion)
    .first<{ generation: string; source_delivery_version: number;
      expected_owners: number; expected_clients: number }>();
  if (!meta) throw new OperationError(409, 'version_conflict',
    'A autoridade da execução mudou. Revise antes de reverter.');
  const [slices, owners] = await Promise.all([
    db.prepare(`SELECT body,body_sha256 FROM delivery_client_snapshots
      WHERE workspace_id=? AND generation=?`).bind(workspace, meta.generation)
      .all<{ body: string; body_sha256: string }>(),
    db.prepare(`SELECT kind,id,company FROM delivery_entity_owners
      WHERE workspace_id=? AND generation=? ORDER BY kind,id`)
      .bind(workspace, meta.generation).all<{ kind: string; id: string; company: string }>(),
  ]);
  const incomplete = () => new OperationError(503, 'execution_snapshot_incomplete',
    'A execução está sendo atualizada. Tente novamente.');
  if (slices.results.length !== meta.expected_clients ||
      owners.results.length !== meta.expected_owners) throw incomplete();
  for (const slice of slices.results) {
    const plain = JSON.stringify(await decodeStateBody(slice.body));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== slice.body_sha256) throw incomplete();
  }
  const effective = projectDelivery(reconstructed.snapshot);
  const projectedOwners = [
    ...effective.tasks.map(row => ({ kind: 'task', id: row.id, company: row.company })),
    ...effective.cycles.map(row => ({ kind: 'cycle', id: row.id, company: row.company })),
  ];
  const expectedOwners = new Map(projectedOwners.map(row => [`${row.kind}\u0000${row.id}`, row.company]));
  if (projectedOwners.length !== expectedOwners.size ||
      owners.results.some(row => expectedOwners.get(`${row.kind}\u0000${row.id}`) !== row.company))
    throw incomplete();
  const now = new Date().toISOString();
  const tx = crypto.randomUUID();
  const body = await encodeStateBody(reconstructed.snapshot);
  try {
    await db.batch([
      db.prepare(`INSERT INTO delivery_compatibility_guards
        (transaction_id,workspace_id,generation,expected_version) VALUES(?,?,?,?)`)
        .bind(tx, workspace, meta.generation, expectedVersion),
      db.prepare(`UPDATE delivery_client_shadow_meta SET mode='shadow',
        source_delivery_version=?,updated_at=? WHERE workspace_id=? AND generation=?
        AND mode='active' AND compatibility_version=?`)
        .bind(expectedVersion, now, workspace, meta.generation, expectedVersion),
      db.prepare(`UPDATE state_documents SET version=?,body=?,updated_at=?,updated_by=?
        WHERE workspace_id=? AND key='ontology.delivery.v2' AND version=?`)
        .bind(expectedVersion, body, now, actor, workspace, meta.source_delivery_version),
      db.prepare(`INSERT INTO state_history
        (workspace_id,key,version,updated_at,updated_by,body) VALUES(?,?,?,?,?,?)`)
        .bind(workspace, 'ontology.delivery.v2', expectedVersion, now, actor, body),
      db.prepare(`DELETE FROM state_history WHERE workspace_id=?
        AND key='ontology.delivery.v2' AND version<=?`)
        .bind(workspace, expectedVersion - 50),
      db.prepare('DELETE FROM delivery_compatibility_guards WHERE transaction_id=?').bind(tx),
    ]);
  } catch (error) {
    forgetDocuments(db);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('delivery_client_version_conflict') ||
        message.includes('delivery_global_write_disabled'))
      throw new OperationError(409, 'version_conflict', 'A execução mudou. Revise antes de reverter.');
    throw error;
  }
  forgetDocuments(db);
  return { version: expectedVersion };
}
