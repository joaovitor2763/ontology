import { projectDelivery, type DeliverySnapshot } from '../modules/delivery/infrastructure/snapshot.ts';

export type EffectiveTaskRow = {
  company: string; id: string; ordinal: number; enrollmentId: string | null;
  productId: string | null; status: string; dueAt: string | null;
  ownerId: string | null; milestone: number | null; kind: string | null; body: string;
};
export type EffectiveCycleRow = {
  company: string; id: string; ordinal: number; enrollmentId: string | null;
  productId: string | null; status: string; startsAt: string | null;
  endsAt: string | null; body: string;
};

const optional = (value: string | undefined) => value ?? null;
const identity = (row: { company: string; id: string }) => `${row.company}\u0000${row.id}`;

/** The same effective projection used by the UI, including seed tasks and overlays. */
export function effectiveDeliveryRows(raw: Partial<DeliverySnapshot>, company?: string) {
  const projected = projectDelivery(raw, company);
  const taskOrder = new Map<string, number>(), cycleOrder = new Map<string, number>();
  const tasks: EffectiveTaskRow[] = projected.tasks.map(task => {
    const ordinal = taskOrder.get(task.company) ?? 0;
    taskOrder.set(task.company, ordinal + 1);
    return { company: task.company, id: task.id, ordinal,
      enrollmentId: optional(task.enrollmentId), productId: optional(task.productId),
      status: task.status, dueAt: optional(task.dueAt), ownerId: optional(task.ownerId),
      milestone: task.milestone ?? null, kind: optional(task.kind), body: JSON.stringify(task) };
  });
  const cycles: EffectiveCycleRow[] = projected.cycles.map(cycle => {
    const ordinal = cycleOrder.get(cycle.company) ?? 0;
    cycleOrder.set(cycle.company, ordinal + 1);
    return { company: cycle.company, id: cycle.id, ordinal,
      enrollmentId: optional(cycle.enrollmentId), productId: optional(cycle.productId),
      status: cycle.status, startsAt: optional(cycle.startsAt), endsAt: optional(cycle.endsAt),
      body: JSON.stringify(cycle) };
  });
  for (const [kind, rows] of [['task', tasks], ['cycle', cycles]] as const)
    if (new Set(rows.map(identity)).size !== rows.length)
      throw new Error(`Duplicate effective ${kind} IDs`);
  return { tasks, cycles };
}
