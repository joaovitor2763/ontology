import { company } from "@/modules/clients/infrastructure/queries";
import { deliveries } from "@/modules/delivery/infrastructure/seed";
import { threadsFor } from "@/modules/engagement/infrastructure/queries";
import { meetings } from "@/modules/engagement/infrastructure/seed";
import type { Ontology } from "@/modules/knowledge/domain/models";
import { person } from "@/modules/workspace/infrastructure/queries";
import { people } from "@/modules/workspace/infrastructure/seed";
export {
  emptyOntologyDraft,
  mergeOntology,
} from "../application/ontology-draft";

export { ontologyFor } from "./ontology-base";
import { ontologyFor } from "./ontology-base";

export function mentionsOf(nodeId: string) {
  const ms = meetings.filter((m) => m.relatedNodeIds?.includes(nodeId));
  const ds = deliveries.filter((d) => d.relatedNodeIds?.includes(nodeId));
  return { meetings: ms, deliveries: ds };
}

function hashN(s: string, mod: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function usageFor(slug: string, liveOntology?: Ontology) {
  const c = company(slug);
  const ont = liveOntology ?? ontologyFor(slug);
  const th = threadsFor(slug);
  const coverage = c?.coverage ?? 0;
  const praxisNames = new Set(
    people.filter((p) => p.org === "praxis").map((p) => p.name),
  );
  const byName = new Map<
    string,
    {
      name: string;
      role: string;
      lastAt: string;
      channel: string;
      queries: number;
    }
  >();

  if (c) {
    const sponsor = person(c.sponsorId);
    byName.set(sponsor.name, {
      name: sponsor.name,
      role: sponsor.role,
      lastAt: th[0]?.lastAt ?? c.startedAt,
      channel: "whatsapp",
      queries: Math.max(1, Math.round(coverage / 18)),
    });
  }

  for (const t of th) {
    for (const name of t.participants ?? [t.counterpart]) {
      if (!name || praxisNames.has(name)) continue;
      const known = people.find((p) => p.name === name);
      const prev = byName.get(name);
      const lastAt = !prev || t.lastAt > prev.lastAt ? t.lastAt : prev.lastAt;
      const channel =
        t.channel === "whatsapp" || t.channel === "call"
          ? t.channel
          : (prev?.channel ?? "whatsapp");
      byName.set(name, {
        name,
        role:
          known?.role ??
          (name.toLowerCase().includes("plantão") ? "Enfermagem" : "Operação"),
        lastAt,
        channel,
        queries: Math.max(
          1,
          Math.round((coverage / 100) * (6 + hashN(name, 42))),
        ),
      });
    }
  }

  const cutoff = "2026-09-05T00:00:00";
  const users = [...byName.values()]
    .map((u) => ({
      ...u,
      active: u.lastAt >= cutoff,
      copiloto: u.queries >= 8 && coverage >= 40,
    }))
    .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));

  const nodes = (ont?.nodes ?? []).filter((n) => n.coverageAssessed !== false);
  const weak = nodes.filter((n) => n.coverage < 40);
  const domains = (ont?.domains ?? [])
    .filter((d) => nodes.some((n) => n.domain === d.id))
    .map((d) => {
      const ns = nodes.filter((n) => n.domain === d.id);
      const avg = ns.length
        ? Math.round(ns.reduce((s, n) => s + n.coverage, 0) / ns.length)
        : 0;
      return { ...d, nodes: ns.length, coverage: avg };
    });

  const sessions7d = Math.round(
    coverage * 0.72 + users.filter((u) => u.active).length * 4,
  );
  const sessions30d = Math.round(sessions7d * 3.1);

  return {
    coverage,
    users,
    active7d: users.filter((u) => u.active).length,
    sessions7d,
    sessions30d,
    weak,
    domains,
    nodes: nodes.length,
    covered: nodes.filter((n) => n.coverage >= 40).length,
  };
}
