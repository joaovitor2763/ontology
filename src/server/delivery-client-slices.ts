import { DELIVERY_RECORD_KINDS, partitionDeliverySnapshot, reconstructDeliverySnapshot,
  type DeliveryRecord } from './delivery-records.ts';
import type { DeliverySnapshot } from '../modules/delivery/infrastructure/snapshot.ts';

export type EnrollmentReference = { company: string; planId?: string | null };
type Slice = { company: string; snapshot: DeliverySnapshot; records: DeliveryRecord[] };

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Ordinals of every raw map, including entries whose owners are currently orphaned. */
export function deliveryMapOrder(raw: Partial<DeliverySnapshot>): Map<string, number> {
  const order = new Map<string, number>();
  for (const kind of DELIVERY_RECORD_KINDS) {
    if (kind === 'extraTasks' || kind === 'extraCycles') continue;
    const collection = raw[kind] ?? {};
    for (const [ordinal, id] of Object.keys(collection).entries())
      order.set(`${kind}\u0000${id}`, ordinal);
  }
  return order;
}

/** Exact raw partition. Shared and orphan records remain explicit for the cutover gate. */
export function partitionClientDelivery(
  raw: Partial<DeliverySnapshot>, enrollments: readonly EnrollmentReference[],
): { slices: Slice[]; unassigned: DeliveryRecord[]; sharedPlanIds: string[] } {
  const rows = partitionDeliverySnapshot(raw);
  const planOwners = new Map<string, Set<string>>();
  const claim = (planId: unknown, company: unknown) => {
    if (!nonempty(planId) || !nonempty(company)) return;
    const owners = planOwners.get(planId) ?? new Set<string>();
    owners.add(company);
    planOwners.set(planId, owners);
  };
  for (const enrollment of enrollments) claim(enrollment.planId, enrollment.company);
  for (const [company, planId] of Object.entries(raw.companyJourney ?? {})) claim(planId, company);
  for (const task of raw.extraTasks ?? []) claim(task.journeyId, task.company);

  const grouped = new Map<string, DeliveryRecord[]>();
  const unassigned: DeliveryRecord[] = [];
  const sharedPlanIds: string[] = [];
  for (const row of rows) {
    let owner = row.company;
    if (row.kind === 'productPlans') {
      const owners = planOwners.get(row.id);
      if (owners?.size === 1) owner = [...owners][0];
      else if (owners && owners.size > 1) sharedPlanIds.push(row.id);
    }
    const classified = owner === row.company ? row : { ...row, company: owner };
    if (!owner) { unassigned.push(classified); continue; }
    const group = grouped.get(owner) ?? [];
    group.push(classified);
    grouped.set(owner, group);
  }
  const slices = [...grouped].sort(([a], [b]) => a.localeCompare(b))
    .map(([company, records]) => ({ company, records,
      snapshot: reconstructDeliverySnapshot(records, { sparse: true }) }));
  return { slices, unassigned, sharedPlanIds: sharedPlanIds.sort() };
}
