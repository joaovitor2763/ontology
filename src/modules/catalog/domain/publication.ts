import type { JourneyMilestone, JourneyTemplate } from "./models.ts";

/** An immutable, published snapshot of a plan. Clients are pinned to snapshots, never to the draft. */
export type JourneyVersion = {
  version: number;
  publishedAt: string;
  publishedBy: string;
  snapshot: JourneyTemplate;
};

export type PublishScope = "novos" | "todos";

export const publishScopeLabel: Record<PublishScope, string> = {
  novos: "Só novos ciclos e clientes",
  todos: "Também os clientes atuais deste plano",
};

/** Canonical form: only fields that change what a client executes. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function canonical(journey: JourneyTemplate) {
  return JSON.stringify(stable({
    id: journey.id,
    name: journey.name,
    description: journey.description,
    autoCreateCycles: Boolean(journey.autoCreateCycles),
    productId: journey.productId ?? "",
    milestones: journey.milestones.map((m) => ({
      n: m.n,
      period: m.period ?? null,
      cycleTemplateId: m.cycleTemplateId ?? "",
      stage: m.stage,
      name: m.name,
      owner: m.owner,
      goal: m.goal ?? "",
      durationWeeks: m.durationWeeks ?? null,
      exitCriteria: m.exitCriteria ?? [],
      tasks: (m.tasks ?? []).map((t) => ({
        id: t.id,
        period: t.period ?? null,
        legacyBaseDeliveryIds: t.legacyBaseDeliveryIds ?? [],
        title: t.title,
        description: t.description,
        hours: t.hours,
        completion: t.completion,
        ownerRole: t.ownerRole ?? "",
        party: t.party ?? "equipe",
        checklistItems: t.checklistItems ?? [],
        requiresEvidence: Boolean(t.requiresEvidence),
        approvalRequired: Boolean(t.approvalRequired),
        deliverableTemplateId: t.deliverableTemplateId ?? "",
        schedule: t.schedule ?? { mode: "none" },
      })),
    })),
  }));
}

/** Stable short fingerprint (FNV-1a over the canonical JSON), the same in Node and browsers. */
export function fingerprint(journey: JourneyTemplate): string {
  const text = canonical(journey);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let second = 0x9747b28c;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    second ^= text.charCodeAt(i);
    second = Math.imul(second, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export type JourneyDiff = {
  added: JourneyMilestone[];
  removed: JourneyMilestone[];
  renamed: { from: string; to: string; n: number }[];
  tasksBefore: number;
  tasksAfter: number;
  /** Milestones whose tasks, goal, criteria or duration changed. */
  changed: JourneyMilestone[];
  unchanged: boolean;
};

const taskKey = (m: JourneyMilestone) =>
  canonical({ id: "", name: "", description: "", milestones: [m] });

/** What the next publication changes for the people executing the plan. */
export function diffJourneys(
  previous: JourneyTemplate | undefined,
  next: JourneyTemplate,
): JourneyDiff {
  const before = previous?.milestones ?? [];
  const after = next.milestones;
  const byN = (list: JourneyMilestone[]) => new Map(list.map((m) => [m.n, m]));
  const beforeMap = byN(before);
  const afterMap = byN(after);
  const added = after.filter((m) => !beforeMap.has(m.n));
  const removed = before.filter((m) => !afterMap.has(m.n));
  const renamed = after
    .filter((m) => beforeMap.has(m.n) && beforeMap.get(m.n)!.name !== m.name)
    .map((m) => ({ from: beforeMap.get(m.n)!.name, to: m.name, n: m.n }));
  const changed = after.filter(
    (m) => beforeMap.has(m.n) && taskKey(beforeMap.get(m.n)!) !== taskKey(m),
  );
  const count = (list: JourneyMilestone[]) =>
    list.reduce((s, m) => s + (m.tasks?.length ?? 0), 0);
  return {
    added,
    removed,
    renamed,
    tasksBefore: count(before),
    tasksAfter: count(after),
    changed,
    unchanged:
      previous !== undefined && fingerprint(previous) === fingerprint(next),
  };
}

export function latestVersion(versions: JourneyVersion[] | undefined) {
  return versions?.length
    ? versions.reduce((a, b) => (b.version > a.version ? b : a))
    : undefined;
}

/** Appends a new snapshot and marks the head with the published version. */
export function publishSnapshot(
  head: JourneyTemplate,
  versions: JourneyVersion[] | undefined,
  by: string,
  at: string,
): { version: JourneyVersion; head: JourneyTemplate } {
  const number = (latestVersion(versions)?.version ?? 0) + 1;
  const snapshot: JourneyTemplate = {
    ...structuredClone(head),
    version: number,
    publishedAt: at,
  };
  return {
    version: { version: number, publishedAt: at, publishedBy: by, snapshot },
    head: { ...head, version: number, publishedAt: at },
  };
}

/**
 * The plan a client actually follows: the snapshot it is pinned to, else the
 * latest published snapshot, else the draft (plans never published).
 */
export function pinnedJourney(
  head: JourneyTemplate,
  versions: JourneyVersion[] | undefined,
  pinnedVersion?: number,
): JourneyTemplate {
  if (pinnedVersion != null) {
    const pinned = versions?.find((v) => v.version === pinnedVersion);
    if (pinned) return pinned.snapshot;
  }
  return latestVersion(versions)?.snapshot ?? head;
}

/** Draft differs from what clients follow. */
export function hasUnpublishedChanges(
  head: JourneyTemplate,
  versions: JourneyVersion[] | undefined,
) {
  const latest = latestVersion(versions);
  return latest ? fingerprint(latest.snapshot) !== fingerprint(head) : false;
}
