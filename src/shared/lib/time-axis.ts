import type { ServiceCycle } from "@/modules/delivery/domain/services";

export function calendarDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

/** End dates are inclusive. Clip geometry, never the underlying dates. */
export function timelineSpan(
  start: string,
  end: string,
  from: string,
  days: number,
) {
  const origin = calendarDay(from);
  const left = Math.max(0, calendarDay(start) - origin);
  const right = Math.min(days, calendarDay(end) - origin + 1);
  if (right <= left) return null;
  return { left: (left / days) * 100, width: ((right - left) / days) * 100 };
}

export function cycleLanes(cycles: ServiceCycle[]) {
  const lanes: ServiceCycle[][] = [];
  for (const cycle of [...cycles].sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt),
  )) {
    const lane = lanes.find((l) => l[l.length - 1].endsAt < cycle.startsAt);
    if (lane) lane.push(cycle);
    else lanes.push([cycle]);
  }
  return lanes;
}
