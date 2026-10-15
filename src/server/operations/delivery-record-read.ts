import { reconstructDeliverySnapshot, type DeliveryRecord } from '../delivery-records.ts';
import { readClientShadowSnapshot } from './delivery-client-shadow-read.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';

/** One indexed, consistent D1 read for a client's execution; null means legacy fallback. */
export async function scopedDeliverySnapshotWithVersion(db: D1Database, workspace: string, company: string):
  Promise<{ snapshot: DeliverySnapshot; sourceVersion: number; clientSnapshot?: string } | null> {
  const shadow = await readClientShadowSnapshot(db, workspace, company);
  if (shadow) return shadow;
  const result = await db.prepare(`
    WITH active AS (
      SELECT g.generation,g.source_version FROM delivery_generations g
      JOIN state_documents d ON d.workspace_id=g.workspace_id AND d.key='ontology.delivery.v2' AND d.version=g.source_version
      WHERE g.workspace_id=? AND g.status='active'
    )
    SELECT generation,source_version,NULL AS kind,NULL AS id,NULL AS ordinal,NULL AS company,
      NULL AS enrollment_id,NULL AS product_id,NULL AS status,NULL AS due_at,NULL AS body FROM active
    UNION ALL
    SELECT a.generation,a.source_version,r.kind,r.id,r.ordinal,r.company,r.enrollment_id,r.product_id,r.status,r.due_at,r.body
    FROM active a CROSS JOIN delivery_records r INDEXED BY idx_delivery_records_client
    WHERE r.workspace_id=? AND r.generation=a.generation AND r.company=?
    UNION ALL
    SELECT a.generation,a.source_version,r.kind,r.id,r.ordinal,r.company,r.enrollment_id,r.product_id,r.status,r.due_at,r.body
    FROM active a CROSS JOIN delivery_records r INDEXED BY idx_delivery_records_client
    WHERE r.workspace_id=? AND r.generation=a.generation AND r.company IS NULL
      AND r.kind IN ('taskPatches','statusMap','cycleEdits')
  `).bind(workspace, workspace, company, workspace).all<{
    generation:number;source_version:number;kind:string|null;id:string|null;ordinal:number|null;company:string|null;
    enrollment_id:string|null;product_id:string|null;status:string|null;due_at:string|null;body:string|null;
  }>();
  if (!result.results.length) return null;
  const rows = result.results.filter(row => row.kind !== null).map(row => ({
    kind: row.kind!, id: row.id!, ordinal: row.ordinal, company: row.company,
    enrollmentId: row.enrollment_id, productId: row.product_id, status: row.status,
    dueAt: row.due_at, body: row.body!,
  })) as DeliveryRecord[];
  return { snapshot: reconstructDeliverySnapshot(rows, { sparse: true }), sourceVersion: result.results[0].source_version };
}

export async function scopedDeliverySnapshot(db: D1Database, workspace: string, company: string) {
  return (await scopedDeliverySnapshotWithVersion(db, workspace, company))?.snapshot ?? null;
}
