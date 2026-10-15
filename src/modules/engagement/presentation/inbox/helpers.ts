import { people } from "@/modules/workspace/infrastructure/seed";
import { dayMonthShort } from "@/shared/lib/dates";
import { NOW } from "@/shared/lib/format";
import type { Thread } from "@/modules/engagement/domain/models";

export function initials(name: string) {
  const p = name.replace(/\+.*/, "").trim().split(" ");
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

export function personOf(name: string) {
  const clean = name.replace(/\+.*/, "").trim();
  return people.find((p) => p.name === clean || clean.startsWith(p.name));
}

export function isPraxis(name: string) {
  return personOf(name)?.org === "praxis";
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date(NOW);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const diff = Math.round((b - a) / 86400000);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return dayMonthShort(d);
}

/** ISO instant → value of a `datetime-local` input, in the user's zone. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Team members seen in a space, by the participants and by who wrote. */
export function mastersOn(t: Thread) {
  const names = new Set<string>();
  (t.participants ?? []).forEach((n) => {
    if (isPraxis(n)) names.add(n.replace(/\+.*/, "").trim());
  });
  t.messages.forEach((m) => {
    if (isPraxis(m.from)) names.add(m.from);
  });
  return [...names];
}
