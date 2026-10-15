import type { Delivery } from "../domain/models";
import type { ServiceCycle } from "../domain/services.ts";
import { enrollmentIsCurrent, type ProductEnrollment } from "../../clients/domain/product-enrollments.ts";

/** Canceled/archived purchases remain in history, outside current operations. */
export function currentExecution(
  deliveries: Delivery[], cycles: ServiceCycle[], enrollments: ProductEnrollment[],
) {
  const inactive = new Set(enrollments.filter(enrollment => !enrollmentIsCurrent(enrollment))
    .map(enrollment => `${enrollment.company}\u0000${enrollment.id}`));
  const current = (row: { company: string; enrollmentId?: string }) =>
    !row.enrollmentId || !inactive.has(`${row.company}\u0000${row.enrollmentId}`);
  return { tasks: deliveries.filter(current), cycles: cycles.filter(current) };
}

export type ClientProgress = {
  /** Every delivery of the client after status and patches, requests included. */
  all: Delivery[];
  /** Planned work: reference tasks and cycle deliveries, without requests. */
  planned: Delivery[];
  requests: Delivery[];
  open: Delivery[];
  done: Delivery[];
  blocked: Delivery[];
  overdue: Delivery[];
  percent: number;
  hoursOpen: number;
  cycles: ServiceCycle[];
  openCycles: ServiceCycle[];
  currentCycle?: ServiceCycle;
  /** Deliveries linked to cycles, grouped by cycle id. */
  byCycle: Record<string, Delivery[]>;
};

const isBlocked = (d: Delivery) =>
  d.status !== "entregue" &&
  (d.status === "bloqueado" || Boolean(d.blockers?.trim()));

/**
 * The single projection every screen uses for a client: overview, plan, execution,
 * portfolio and home read the same numbers.
 */
export function clientProgress(
  deliveries: Delivery[],
  cycles: ServiceCycle[],
  today: string,
  enrollments: ProductEnrollment[] = [],
): ClientProgress {
  const current = currentExecution(deliveries, cycles, enrollments);
  const all = current.tasks;
  const requests = all.filter((d) => d.kind === "request");
  const planned = all.filter((d) => d.kind !== "request");
  const open = planned.filter((d) => d.status !== "entregue");
  const done = planned.filter((d) => d.status === "entregue");
  const day = today.slice(0, 10);
  const byCycle: Record<string, Delivery[]> = {};
  for (const cycle of current.cycles) {
    byCycle[cycle.id] = all.filter((d) => cycle.taskIds.includes(d.id));
  }
  const sorted = [...current.cycles].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  const openCycles = sorted.filter((c) => c.status !== "concluido");
  const running = openCycles.filter(c => c.status === "em-curso");
  const inWindow = running.filter(c => c.startsAt <= day && c.endsAt >= day);
  const currentCycle = inWindow.at(-1) ?? running.find(c => c.startsAt <= day) ?? running[0]
    ?? openCycles.find(c => c.status === "em-aceite") ?? openCycles[0];
  return {
    all,
    planned,
    requests,
    open,
    done,
    blocked: open.filter(isBlocked),
    overdue: open.filter((d) => d.dueAt && d.dueAt.slice(0, 10) < day),
    percent: planned.length
      ? Math.round((done.length / planned.length) * 100)
      : 0,
    hoursOpen: open.reduce((s, d) => s + d.hours, 0),
    cycles: sorted,
    openCycles,
    currentCycle,
    byCycle,
  };
}

/** Deliveries a milestone is responsible for: its own tasks plus those of the cycles linked to it. */
export function milestoneDeliveries(
  progress: Pick<ClientProgress, "planned" | "cycles" | "byCycle">,
  milestone: number,
) {
  const linkedCycles = progress.cycles.filter(
    (c) =>
      c.milestone === milestone ||
      (progress.byCycle[c.id] ?? []).some((d) => d.milestone === milestone),
  );
  const fromCycles = linkedCycles.flatMap((c) =>
    (progress.byCycle[c.id] ?? []).filter(
      (d) => c.milestone === milestone || d.milestone === milestone,
    ),
  );
  const ids = new Set(fromCycles.map((d) => d.id));
  const own = progress.planned.filter(
    (d) => d.milestone === milestone && !ids.has(d.id),
  );
  return {
    cycles: linkedCycles,
    items: [...own, ...fromCycles.filter((d) => d.kind !== "request")],
  };
}

/** Next actionable record is derived from open tasks; no parallel manual field. */
export function nextOpenTask(tasks: Delivery[]) {
  return tasks.filter(task=>task.status!=="entregue")
    .sort((a,b)=>(a.dueAt||"9999").localeCompare(b.dueAt||"9999")||a.id.localeCompare(b.id))[0];
}
