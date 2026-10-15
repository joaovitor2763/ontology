type Entry = Record<string, unknown>;
export type HistoryObservation = {
  taskId: string;
  entryHash: string;
  occurrence: number;
  entryJson: string;
  eventAt: string | null;
  isLegacySummary: boolean;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Max multiplicity across task base and patch: both often repeat the same history. */
export async function historyObservations(raw: unknown, only?: ReadonlySet<string>): Promise<HistoryObservation[]> {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const candidates = new Map<string, Entry[][]>();
  const add = (taskId: string, source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    const history = (source as { history?: unknown }).history;
    if (!Array.isArray(history)) return;
    const entries = history.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)) as Entry[];
    candidates.set(taskId, [...(candidates.get(taskId) ?? []), entries]);
  };
  if (Array.isArray(value.extraTasks)) for (const task of value.extraTasks) {
    const id = task && typeof task === 'object' && typeof task.id === 'string' ? task.id : null;
    if (id && (!only || only.has(id))) add(id, task);
  }
  if (value.taskPatches && typeof value.taskPatches === 'object' && !Array.isArray(value.taskPatches))
    for (const [id, patch] of Object.entries(value.taskPatches)) if (!only || only.has(id)) add(id, patch);
  const hashCache = new Map<string, string>();
  const result: HistoryObservation[] = [];
  for (const [taskId, sources] of candidates) {
    const maximum = new Map<string, { count: number; entry: Entry }>();
    for (const source of sources) {
      const counts = new Map<string, { count: number; entry: Entry }>();
      for (const entry of source) {
        const identity = stable(entry);
        const current = counts.get(identity);
        counts.set(identity, { count: (current?.count ?? 0) + 1, entry });
      }
      for (const [identity, item] of counts) if (item.count > (maximum.get(identity)?.count ?? 0)) maximum.set(identity, item);
    }
    for (const [identity, item] of maximum) {
      let hash = hashCache.get(identity);
      if (!hash) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
        hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        hashCache.set(identity, hash);
      }
      for (let occurrence = 1; occurrence <= item.count; occurrence++)
        result.push({ taskId, entryHash: hash, occurrence, entryJson: JSON.stringify(item.entry),
          eventAt: typeof item.entry.at === 'string' ? item.entry.at : null,
          isLegacySummary: item.entry.field === 'resumo' });
    }
  }
  return result;
}
