import { decodeStateBody } from '../state-body.ts';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot,
  type DeliveryRecord } from '../delivery-records.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { OperationError } from './errors.ts';

type Meta = { generation: string; compatibility_version: number; expected_clients: number;
  expected_orphans: number; expected_array_order: number; expected_map_order: number;
  updated_at: string };

/** Isolated active-mode compatibility read for the existing browser document protocol.
 * Its cost remains proportional to the workspace and must be retired after page hydration migrates. */
async function readDeliveryCompatibility(
  db: D1Database, workspace: string, mode: 'active' | 'shadow',
): Promise<{ snapshot: DeliverySnapshot; version: number; updatedAt: string } | null> {
  const marker = () => db.prepare(`SELECT generation,compatibility_version,updated_at,
      expected_clients,expected_orphans,expected_array_order,expected_map_order
    FROM delivery_client_shadow_meta WHERE workspace_id=? AND mode=?`)
    .bind(workspace, mode).first<Meta>();
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await marker();
    if (!meta) return null;
    const [slices, positions, mapPositions, orphans] = await Promise.all([
      db.prepare(`SELECT company,body FROM delivery_client_snapshots
        WHERE workspace_id=? AND generation=? ORDER BY company`)
        .bind(workspace, meta.generation).all<{ company: string; body: string }>(),
      db.prepare(`SELECT kind,id,ordinal FROM delivery_client_array_order
        WHERE workspace_id=? AND generation=?`)
        .bind(workspace, meta.generation).all<{ kind: string; id: string; ordinal: number }>(),
      db.prepare(`SELECT kind,id,ordinal FROM delivery_client_map_order
        WHERE workspace_id=? AND generation=?`)
        .bind(workspace, meta.generation).all<{ kind: string; id: string; ordinal: number }>(),
      db.prepare(`SELECT kind,id,ordinal,body FROM delivery_client_orphans
        WHERE workspace_id=? AND generation=?`)
        .bind(workspace, meta.generation).all<{ kind: DeliveryRecord['kind']; id: string;
          ordinal: number | null; body: string }>(),
    ]);
    const final = await marker();
    if (!final || final.generation !== meta.generation ||
        final.compatibility_version !== meta.compatibility_version) continue;
    if (slices.results.length !== meta.expected_clients ||
        positions.results.length !== meta.expected_array_order ||
        mapPositions.results.length !== meta.expected_map_order ||
        orphans.results.length !== meta.expected_orphans)
      throw new OperationError(503, 'execution_snapshot_incomplete',
        'A execução está sendo atualizada. Tente novamente.');
    const order = new Map(positions.results.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
    const mapOrder = new Map(mapPositions.results.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
    const records: DeliveryRecord[] = [];
    for (const slice of slices.results) {
      const raw = await decodeStateBody(slice.body);
      for (const row of partitionDeliverySnapshot(raw)) {
        const position = (row.kind === 'extraTasks' || row.kind === 'extraCycles'
          ? order : mapOrder).get(`${row.kind}\u0000${row.id}`);
        if (!Number.isSafeInteger(position)) throw new OperationError(503,
          'execution_snapshot_incomplete', 'A execução está sendo atualizada. Tente novamente.');
        row.ordinal = position!;
        records.push(row);
      }
    }
    for (const row of orphans.results) records.push({ kind: row.kind, id: row.id,
      ordinal: row.ordinal, body: JSON.stringify(await decodeStateBody(row.body)),
      company: null, enrollmentId: null, productId: null, status: null, dueAt: null });
    for (const row of records) if (row.kind !== 'extraTasks' && row.kind !== 'extraCycles') {
      const position = mapOrder.get(`${row.kind}\u0000${row.id}`);
      if (!Number.isSafeInteger(position)) throw new OperationError(503,
        'execution_snapshot_incomplete', 'A execução está sendo atualizada. Tente novamente.');
      row.ordinal = position!;
    }
    return { snapshot: reconstructDeliverySnapshot(records, { sparse: true }),
      version: meta.compatibility_version, updatedAt: meta.updated_at };
  }
  throw new OperationError(409, 'snapshot_changed', 'A execução mudou. Atualize e tente novamente.');
}

export const readActiveDeliveryCompatibility = (db: D1Database, workspace: string) =>
  readDeliveryCompatibility(db, workspace, 'active');

/** Read-only equivalence check used before the authority switch. */
export const readShadowDeliveryCompatibility = (db: D1Database, workspace: string) =>
  readDeliveryCompatibility(db, workspace, 'shadow');
