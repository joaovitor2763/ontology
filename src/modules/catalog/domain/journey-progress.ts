import type { Delivery } from "../../delivery/domain/models.ts";
import type { JourneyTemplate } from "./models.ts";
import { MONTHS_SHORT } from "../../../shared/lib/dates.ts";

export function isBlocked(task: Delivery) {
  return (
    task.status !== "entregue" &&
    (task.status === "bloqueado" || Boolean(task.blockers?.trim()))
  );
}

/**
 * Progress of one milestone. `extraItems` are deliveries owned by cycles linked
 * to the milestone; they count even when their own `milestone` field differs.
 */
export function milestoneProgress(
  tasks: Delivery[],
  milestone: number,
  today: string,
  extraItems: Delivery[] = [],
) {
  const own = tasks.filter(
    (task) => task.milestone === milestone && task.kind !== "request",
  );
  const seen = new Set(own.map((task) => task.id));
  const items = [
    ...own,
    ...extraItems.filter(
      (task) => task.kind !== "request" && !seen.has(task.id),
    ),
  ];
  const pending = items.filter((task) => task.status !== "entregue");
  const done = items.length - pending.length;
  const overdue = pending.filter(
    (task) => task.dueAt && task.dueAt.slice(0, 10) < today,
  );
  const priority = (task: Delivery) =>
    isBlocked(task)
      ? 0
      : overdue.includes(task)
        ? 1
        : task.status === "revisao"
          ? 2
          : task.status === "em-curso"
            ? 3
            : 4;
  const ordered = [...items].sort(
    (a, b) =>
      Number(a.status === "entregue") - Number(b.status === "entregue") ||
      priority(a) - priority(b) ||
      (a.dueAt || "9999").localeCompare(b.dueAt || "9999"),
  );
  return {
    items,
    ordered,
    pending,
    done,
    overdue,
    blocked: pending.filter(isBlocked),
    percent: items.length ? Math.round((done / items.length) * 100) : 0,
    complete: items.length > 0 && pending.length === 0,
    remainingHours: pending.reduce((sum, task) => sum + task.hours, 0),
    dueAt: items
      .map((task) => task.dueAt)
      .filter(Boolean)
      .sort()
      .at(-1),
    nextTask: ordered.find((task) => task.status !== "entregue"),
  };
}

export function milestoneAdvance(
  journey: JourneyTemplate,
  tasks: Delivery[],
  selected: number,
  current: number,
) {
  const index = journey.milestones.findIndex(
    (milestone) => milestone.n === selected,
  );
  const earlier = new Set(
    journey.milestones
      .slice(0, Math.max(0, index))
      .map((milestone) => milestone.n),
  );
  const items = tasks.filter(
    (task) => task.kind !== "request" && task.milestone === selected,
  );
  const pending = tasks.filter(
    (task) =>
      task.kind !== "request" &&
      task.status !== "entregue" &&
      (task.milestone === selected || earlier.has(task.milestone)),
  );
  return {
    ready:
      index >= 0 &&
      selected === current &&
      items.length > 0 &&
      pending.length === 0,
    pending,
    next: index >= 0 ? journey.milestones[index + 1] : undefined,
    empty: items.length === 0,
  };
}

/**
 * Every milestone with its progress and whether it is closed: complete and
 * behind the current one (or the whole journey is finished).
 */
export function milestoneSummaries(
  journey: JourneyTemplate,
  tasks: Delivery[],
  today: string,
  current: number,
  linkedItems: (milestone: number) => Delivery[] = () => [],
) {
  const currentIndex = journey.milestones.findIndex((item) => item.n === current);
  const finished =
    currentIndex === journey.milestones.length - 1 &&
    milestoneAdvance(journey, tasks, current, current).ready;
  return journey.milestones.map((item, index) => {
    const summary = milestoneProgress(tasks, item.n, today, linkedItems(item.n));
    return {
      ...item,
      ...summary,
      closed: summary.complete && (index < currentIndex || finished),
    };
  });
}

/** Dates in task records are calendar dates, independent of the browser timezone. */
export function journeyDate(value?: string) {
  if (!value) return "Sem prazo";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Sem prazo";
  const [, month, dayOfMonth] = day.split("-").map(Number);
  return `${dayOfMonth} de ${MONTHS_SHORT[month - 1]}.`;
}

/** An unambiguous historical purchase may inherit the existing client marker. */
export function enrollmentMilestone(
  enrollment: { milestone?: number },
  journey: JourneyTemplate,
  inherited?: number,
) {
  const value = enrollment.milestone ?? inherited;
  return journey.milestones.find(m => m.n === value)?.n ?? journey.milestones[0]?.n ?? 1;
}
