import { deliveriesFor } from '../modules/delivery/infrastructure/queries.ts';
import { serviceCycles } from '../modules/delivery/infrastructure/services.ts';
import { DELIVERY_INITIAL, type DeliverySnapshot } from '../modules/delivery/infrastructure/snapshot.ts';

export const DELIVERY_RECORD_KINDS = [
  'cycleEdits', 'extraCycles', 'statusMap', 'extraTasks', 'taskPatches',
  'productPlans', 'companyJourney', 'companyMilestone', 'companyJourneyVersion',
] as const;
export type DeliveryRecordKind = typeof DELIVERY_RECORD_KINDS[number];
export type DeliveryRecord = {
  kind: DeliveryRecordKind;
  id: string;
  ordinal: number | null;
  company: string | null;
  enrollmentId: string | null;
  productId: string | null;
  status: string | null;
  dueAt: string | null;
  body: string;
};

const ARRAY_KINDS = new Set<DeliveryRecordKind>(['extraCycles', 'extraTasks']);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;

/** Lossless structural split of the raw legacy body. Never run normalizeDeliverySnapshot here. */
export function partitionDeliverySnapshot(raw: unknown): DeliveryRecord[] {
  const state = record(raw);
  const kinds = new Set<string>(DELIVERY_RECORD_KINDS);
  const unknown = Object.keys(state).filter(key => !kinds.has(key));
  if (unknown.length) throw new Error(`Unknown delivery fields: ${unknown.join(', ')}`);
  // The built-in playbook also creates tasks. Its overlays must carry the
  // client's ownership even when the raw patch does not repeat `company`.
  const baseTasks = deliveriesFor();
  const tasks = new Map([...baseTasks, ...((state.extraTasks as typeof baseTasks | undefined) ?? [])]
    .map(task => [task.id, task.company]));
  const cycles = new Map([...serviceCycles, ...((state.extraCycles as typeof serviceCycles | undefined) ?? [])]
    .map(cycle => [cycle.id, cycle.company]));
  const result: DeliveryRecord[] = [];
  for (const kind of DELIVERY_RECORD_KINDS) {
    const collection = state[kind];
    if (collection === undefined) continue;
    const entries: [string, unknown, number | null][] = ARRAY_KINDS.has(kind)
      ? Array.isArray(collection)
        ? collection.map((value, index) => {
          const id = string(record(value).id);
          if (!id) throw new Error(`${kind}[${index}] has no ID`);
          return [id, value, index];
        })
        : (() => { throw new Error(`${kind} is not an array`); })()
      : collection && typeof collection === 'object' && !Array.isArray(collection)
        ? Object.entries(collection).map(([id, value]) => [id, value, null])
        : (() => { throw new Error(`${kind} is not a map`); })();
    for (const [id, value, ordinal] of entries) {
      const fields = record(value);
      const company = kind === 'extraTasks' || kind === 'extraCycles'
        ? string(fields.company)
        : kind === 'taskPatches' || kind === 'statusMap'
          ? string(fields.company) ?? tasks.get(id) ?? null
          : kind === 'cycleEdits'
            ? string(fields.company) ?? cycles.get(id) ?? null
            : kind.startsWith('company') ? id : string(fields.company);
      const body = JSON.stringify(value);
      if (body === undefined || new TextEncoder().encode(body).byteLength > 1_800_000)
        throw new Error(`${kind}/${id} exceeds one D1 record`);
      result.push({ kind, id, ordinal, company,
        enrollmentId: string(fields.enrollmentId), productId: string(fields.productId),
        status: kind === 'statusMap' ? string(value) : string(fields.status),
        dueAt: string(fields.dueAt), body });
    }
  }
  if (new Set(result.map(row => `${row.kind}\u0000${row.id}`)).size !== result.length)
    throw new Error('Duplicate delivery record IDs');
  return result;
}

/** Rebuild the old shape for migration validation and rollback tooling only. */
export function reconstructDeliverySnapshot(rows: DeliveryRecord[], options: { sparse?: boolean } = {}): DeliverySnapshot {
  const output: Record<string, unknown> = Object.fromEntries(
    DELIVERY_RECORD_KINDS.map(kind => [kind, ARRAY_KINDS.has(kind) ? [] : {}]),
  );
  for (const kind of DELIVERY_RECORD_KINDS) {
    const selected = rows.filter(row => row.kind === kind);
    if (ARRAY_KINDS.has(kind)) {
      const ordered = selected.sort((a, b) => (a.ordinal ?? -1) - (b.ordinal ?? -1));
      if (!options.sparse && ordered.some((row, index) => row.ordinal !== index)) throw new Error(`${kind} ordinal gap`);
      output[kind] = ordered.map(row => JSON.parse(row.body));
    } else {
      if (selected.length && selected.every(row => Number.isSafeInteger(row.ordinal)))
        selected.sort((a, b) => a.ordinal! - b.ordinal!);
      output[kind] = Object.fromEntries(selected.map(row => [row.id, JSON.parse(row.body)]));
    }
  }
  return { ...DELIVERY_INITIAL, ...output } as DeliverySnapshot;
}
