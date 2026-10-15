import type { Delivery } from '../domain/models';
import { earlyFetch } from '../../../shared/infrastructure/early-boot.ts';
import type { ServiceCycle } from '../domain/services';

export type CycleTaskSummary = Pick<Delivery, 'id' | 'company' | 'title' | 'status' | 'dueAt'>;
export type ActiveExecutionCycles = {
  mode: 'active';
  cycles: ServiceCycle[];
  tasks: CycleTaskSummary[];
  milestoneNames: Record<string, string>;
  clientSnapshots: Record<string, string>;
  compatibilityVersion: number;
  etag?: string;
};
export type ExecutionCyclesCollection = ActiveExecutionCycles | { mode: 'legacy' };

/** A refresh publishes all cycles and task summaries from one revision together. */
export async function loadExecutionCycles(options: {
  fetcher?: typeof fetch; signal?: AbortSignal; attempts?: number;
  current?: ActiveExecutionCycles;
} = {}): Promise<ExecutionCyclesCollection> {
  const fetcher = options.fetcher ?? earlyFetch;
  for (let attempt = 0; attempt < (options.attempts ?? 3); attempt++) {
    const response = await fetcher('/api/execution/cycles', {
      signal: options.signal, cache: 'no-store',
      headers: options.current?.etag ? { 'if-none-match': options.current.etag } : undefined,
    });
    if (response.status === 304) {
      if (options.current) return options.current;
      throw new Error('A resposta dos ciclos está incompleta. Tente novamente.');
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 409 && attempt < (options.attempts ?? 3) - 1) continue;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body &&
        typeof body.message === 'string' ? body.message : null;
      throw new Error(message ?? 'Não foi possível carregar os ciclos.');
    }
    if (!body || typeof body !== 'object' || !('mode' in body))
      throw new Error('A resposta dos ciclos está incompleta. Tente novamente.');
    if (body.mode === 'legacy') return { mode: 'legacy' };
    if (body.mode !== 'active' || !('cycles' in body) || !Array.isArray(body.cycles) ||
      !('tasks' in body) || !Array.isArray(body.tasks) ||
      !('milestoneNames' in body) || !body.milestoneNames ||
      typeof body.milestoneNames !== 'object' || Array.isArray(body.milestoneNames) ||
      !('clientSnapshots' in body) || !body.clientSnapshots ||
      typeof body.clientSnapshots !== 'object' || Array.isArray(body.clientSnapshots) ||
      !('compatibilityVersion' in body) || !Number.isSafeInteger(body.compatibilityVersion))
      throw new Error('A resposta dos ciclos está incompleta. Tente novamente.');
    const snapshots = body.clientSnapshots as Record<string, unknown>;
    const valid = (row: unknown) => row && typeof row === 'object' &&
      'id' in row && typeof row.id === 'string' &&
      'company' in row && typeof row.company === 'string' &&
      typeof snapshots[row.company] === 'string';
    if (Object.values(snapshots).some(value => typeof value !== 'string' || !value) ||
      body.cycles.some(row => !valid(row)) || body.tasks.some(row => !valid(row)))
      throw new Error('A resposta dos ciclos está incompleta. Tente novamente.');
    return { ...body as ActiveExecutionCycles,
      etag: response.headers.get('etag') ?? undefined };
  }
  throw new Error('Os ciclos mudaram durante a leitura. Tente novamente.');
}
