import { alerts, people } from "./seed.ts";
export function person(id: string) {
  return (
    people.find((p) => p.id === id) ?? {
      id,
      name: id,
      role: "",
      org: "praxis" as const,
      initials: id.slice(0, 2).toUpperCase(),
    }
  );
}

export function emailOf(p: { email?: string }) {
  return p.email?.trim() || "Não informado";
}

export function alertsFor(slug?: string, hidden?: Set<string>) {
  return alerts
    .filter((a) => !slug || a.company === slug)
    .filter((a) => !hidden?.has(a.id))
    .slice()
    .sort((a, b) => {
      const rank = { critico: 0, atencao: 1, info: 2 };
      return rank[a.severity] - rank[b.severity];
    });
}
