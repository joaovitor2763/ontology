import type { Delivery } from '../domain/models';
import { earlyFetch } from '../../../shared/infrastructure/early-boot.ts';
import { boardTaskOf, decodeBoardTasks, type BoardTaskTable } from './execution-board-wire.ts';

/**
 * Tarefas em tabela com dicionário (`execution-board-wire.ts`): ~1/6 do JSON
 * de objetos num quadro com dezenas de clientes no mesmo plano. A carga
 * antecipada (`early-boot.ts`) pede exatamente este endereço.
 */
export const EXECUTION_BOARD_URL = '/api/execution/board?formato=tabela';

export type ExecutionBoardCycle = {
  id: string;
  company: string;
  name: string;
  status: string;
  taskIds: string[];
  productId?: string;
  enrollmentId?: string;
  templateId?: string;
  milestone?: number;
  startsAt: string;
  endsAt: string;
  ownerId: string;
  acceptance: { done: boolean; approvedBy?: string }[];
};

export type ActiveExecutionBoard = {
  mode: 'active';
  /** Só os campos do quadro (`BOARD_TASK_FIELDS`); a gaveta carrega a tarefa completa. */
  tasks: Delivery[];
  cycles: ExecutionBoardCycle[];
  referenceTasks: { id: string; company: string; title: string; dueAt: string }[];
  compatibilityVersion: number;
  clientSnapshots: Record<string, string>;
  etag?: string;
};

export type ExecutionBoardCollection = ActiveExecutionBoard | { mode: 'legacy' };

/** Publish only one complete board revision; retry a read that raced a write. */
export async function loadExecutionBoard(options: {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  attempts?: number;
  current?: ActiveExecutionBoard;
} = {}): Promise<ExecutionBoardCollection> {
  const fetcher = options.fetcher ?? earlyFetch;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetcher(EXECUTION_BOARD_URL,
      { signal: options.signal, cache: 'no-store',
        headers: options.current?.etag ? { 'if-none-match': options.current.etag } : undefined });
    if (response.status === 304) {
      if (options.current) return options.current;
      throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 409 && attempt < attempts - 1) continue;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body &&
        typeof body.message === 'string' ? body.message : null;
      throw new Error(message ?? 'Não foi possível carregar as tarefas.');
    }
    if (!body || typeof body !== 'object' || !('mode' in body))
      throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
    if (body.mode === 'legacy') return { mode: 'legacy' };
    // Um Worker anterior (publicação em andamento) ignora `formato` e manda objetos.
    const objects = !('taskTable' in body) && 'tasks' in body && Array.isArray(body.tasks) ? body.tasks : null;
    if (body.mode !== 'active' || !('taskTable' in body || objects) ||
      !('cycles' in body) || !Array.isArray(body.cycles) ||
      !('referenceTasks' in body) || !Array.isArray(body.referenceTasks) ||
      !('compatibilityVersion' in body) ||
      !Number.isSafeInteger(body.compatibilityVersion) ||
      !('clientSnapshots' in body) || !body.clientSnapshots ||
      typeof body.clientSnapshots !== 'object' || Array.isArray(body.clientSnapshots))
      throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
    let tasks: Delivery[];
    try {
      tasks = objects ? objects.map(row => boardTaskOf(row as Partial<Delivery>) as Delivery)
        : decodeBoardTasks((body as unknown as { taskTable: BoardTaskTable }).taskTable);
    } catch {
      throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
    }
    const snapshots = body.clientSnapshots as Record<string, unknown>;
    const validRow = (row: unknown) => row && typeof row === 'object' &&
      'id' in row && typeof row.id === 'string' &&
      'company' in row && typeof row.company === 'string' &&
      typeof snapshots[row.company] === 'string';
    if (Object.values(snapshots).some(value => typeof value !== 'string' || !value) ||
      tasks.some(row => !validRow(row)) || body.cycles.some(row => !validRow(row)) ||
      body.referenceTasks.some(row => !validRow(row)))
      throw new Error('A resposta das tarefas está incompleta. Tente novamente.');
    const board = body as unknown as Omit<ActiveExecutionBoard, 'tasks' | 'etag'>;
    return { mode: 'active', tasks, cycles: board.cycles, referenceTasks: board.referenceTasks,
      compatibilityVersion: board.compatibilityVersion, clientSnapshots: board.clientSnapshots,
      etag: response.headers.get('etag') ?? undefined };
  }
  throw new Error('As tarefas mudaram durante a leitura. Tente novamente.');
}
