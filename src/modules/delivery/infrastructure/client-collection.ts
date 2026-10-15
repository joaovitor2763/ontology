import type { Delivery } from '../domain/models';
import type { ServiceCycle } from '../domain/services';
import type { DeliverySnapshot } from './snapshot';
import { earlyFetch } from '../../../shared/infrastructure/early-boot.ts';

type Page<T> = {
  data: T[];
  total: number;
  snapshotVersion: number;
  clientSnapshot?: string;
  nextCursor: string | null;
};

export type ClientDeliveryCollection = {
  tasks: Delivery[];
  cycles: ServiceCycle[];
  snapshotVersion: number;
  clientSnapshot?: string;
};

export class ClientCollectionChanged extends Error {}

export type ClientExecutionWorkspace =
  | { mode: 'legacy' }
  | ({ mode: 'active'; snapshot: DeliverySnapshot } & ClientDeliveryCollection & { clientSnapshot: string });

/**
 * Last execution mode this browser saw; lists are read in parallel only when
 * they may be used. The inline early boot reads the same hint.
 */
const MODE_HINT = 'g4.execution-mode';
let legacySeen = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(MODE_HINT) === 'legacy'; }
  catch { return false; }
})();

/** The editor snapshot and paginated board must describe the same client revision. */
export async function loadClientExecutionWorkspace(
  company: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; attempts?: number } = {},
): Promise<ClientExecutionWorkspace> {
  const fetcher = options.fetcher ?? earlyFetch;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // The raw slice and the paginated lists start together; the revision check
    // below still refuses to publish them unless all describe the same slice.
    // A workspace already seen in legacy mode skips the lists it will not use.
    const early = legacySeen ? null : loadClientDeliveryCollection(company,
      { fetcher, signal: options.signal, attempts: 1 });
    early?.catch(() => { /* awaited below, or discarded for a legacy client */ });
    const response = await fetcher(
      `/api/v1/clients/${encodeURIComponent(company)}/execution-snapshot`,
      { signal: options.signal, cache: 'no-store' },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readError(body) ?? 'Não foi possível carregar a execução do cliente.');
    const data = body && typeof body === 'object' && 'data' in body ? body.data : null;
    if (!data || typeof data !== 'object' || !('mode' in data))
      throw new Error('A resposta da execução está incompleta. Tente novamente.');
    legacySeen = data.mode === 'legacy';
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(MODE_HINT, legacySeen ? 'legacy' : 'active'); }
    catch { /* the hint is only an optimization */ }
    if (data.mode === 'legacy') return { mode: 'legacy' };
    if (data.mode !== 'active' || !('clientSnapshot' in data) ||
        typeof data.clientSnapshot !== 'string' || !('snapshot' in data) ||
        !data.snapshot || typeof data.snapshot !== 'object')
      throw new Error('A resposta da execução está incompleta. Tente novamente.');
    try {
      const collection = await (early ?? loadClientDeliveryCollection(company,
        { fetcher, signal: options.signal, attempts: 1 }));
      if (collection.clientSnapshot !== data.clientSnapshot) throw new ClientCollectionChanged();
      return { mode: 'active', snapshot: data.snapshot as DeliverySnapshot,
        ...collection, clientSnapshot: data.clientSnapshot };
    } catch (error) {
      if (!(error instanceof ClientCollectionChanged) || attempt === attempts - 1) throw error;
    }
  }
  throw new ClientCollectionChanged('A execução mudou durante a leitura. Tente novamente.');
}

function readError(body: unknown) {
  if (!body || typeof body !== 'object' || !('error' in body)) return null;
  const error = body.error;
  return error && typeof error === 'object' && 'message' in error &&
    typeof error.message === 'string' ? error.message : null;
}

/** An incomplete page must never replace a complete board. */
export async function loadClientDeliveryCollection(
  company: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; attempts?: number } = {},
): Promise<ClientDeliveryCollection> {
  const fetcher = options.fetcher ?? earlyFetch;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // Both first pages start together and must report the same revision;
      // later pages stay pinned to it by the guard.
      const [first, firstCycles] = await Promise.all([
        readPage<Delivery>('tasks', company, null, {}, fetcher, options.signal),
        readPage<ServiceCycle>('cycles', company, null, {}, fetcher, options.signal),
      ]);
      if (!sameRevision(first, firstCycles))
        throw new ClientCollectionChanged('As tarefas mudaram durante a leitura. Tente novamente.');
      const guard = first.clientSnapshot
        ? { clientSnapshot: first.clientSnapshot }
        : { snapshotVersion: first.snapshotVersion };
      const [cycles, tasks] = await Promise.all([
        readRest('cycles', company, firstCycles, guard, fetcher, options.signal),
        readRest('tasks', company, first, guard, fetcher, options.signal),
      ]);
      return { tasks, cycles, snapshotVersion: first.snapshotVersion,
        ...(first.clientSnapshot ? { clientSnapshot: first.clientSnapshot } : {}) };
    } catch (error) {
      if (!(error instanceof ClientCollectionChanged) || attempt === attempts - 1) throw error;
    }
  }
  throw new ClientCollectionChanged('As tarefas mudaram durante a leitura. Tente novamente.');
}

/** Read only the client's effective cycles for contextual selectors. */
export async function loadClientCycleCollection(
  company: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; attempts?: number } = {},
): Promise<ServiceCycle[]> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const first = await readPage<ServiceCycle>('cycles', company, null, {}, fetcher, options.signal);
      const guard = first.clientSnapshot
        ? { clientSnapshot: first.clientSnapshot }
        : { snapshotVersion: first.snapshotVersion };
      return await readRest('cycles', company, first, guard, fetcher, options.signal);
    } catch (error) {
      if (!(error instanceof ClientCollectionChanged) || attempt === attempts - 1) throw error;
    }
  }
  throw new ClientCollectionChanged('Os ciclos mudaram durante a leitura. Tente novamente.');
}

type Guard = { clientSnapshot: string } | { snapshotVersion: number };

/** Two unguarded first pages describe the same client revision. */
function sameRevision(a: Page<unknown>, b: Page<unknown>) {
  return a.clientSnapshot
    ? a.clientSnapshot === b.clientSnapshot
    : !b.clientSnapshot && a.snapshotVersion === b.snapshotVersion;
}

async function readRest<T>(
  kind: 'tasks' | 'cycles', company: string, first: Page<T>, guard: Guard,
  fetcher: typeof fetch, signal?: AbortSignal,
): Promise<T[]> {
  const rows = [...first.data];
  let cursor = first.nextCursor;
  while (cursor !== null) {
    const page = await readPage<T>(kind, company, cursor, guard, fetcher, signal);
    if (page.total !== first.total ||
        (!first.clientSnapshot && page.snapshotVersion !== first.snapshotVersion) ||
        page.clientSnapshot !== first.clientSnapshot)
      throw new ClientCollectionChanged('As tarefas mudaram durante a leitura. Tente novamente.');
    rows.push(...page.data);
    if (rows.length > first.total || page.nextCursor === cursor)
      throw new Error('A paginação das tarefas é inválida. Tente novamente.');
    cursor = page.nextCursor;
  }
  if (rows.length !== first.total)
    throw new ClientCollectionChanged('A lista veio incompleta. Tente novamente.');
  return rows;
}

async function readPage<T>(
  kind: 'tasks' | 'cycles', company: string, cursor: string | null, guard: Partial<Guard>,
  fetcher: typeof fetch, signal?: AbortSignal,
): Promise<Page<T>> {
  const query = new URLSearchParams({ company, limit: '100' });
  if (cursor !== null) query.set('cursor', cursor);
  if ('clientSnapshot' in guard && guard.clientSnapshot)
    query.set('expectedClientSnapshot', guard.clientSnapshot);
  else if ('snapshotVersion' in guard && guard.snapshotVersion !== undefined)
    query.set('expectedVersion', String(guard.snapshotVersion));
  const response = await fetcher(`/api/v1/${kind}?${query}`, { signal, cache: 'no-store' });
  if (response.status === 409) throw new ClientCollectionChanged('As tarefas mudaram durante a leitura. Tente novamente.');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(body) ?? 'Não foi possível carregar as tarefas. Tente novamente.');
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data) ||
      !('total' in body) || !Number.isSafeInteger(body.total) ||
      !('snapshotVersion' in body) || !Number.isSafeInteger(body.snapshotVersion) ||
      !('nextCursor' in body) ||
      !(body.nextCursor === null || typeof body.nextCursor === 'string'))
    throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
  return body as Page<T>;
}
