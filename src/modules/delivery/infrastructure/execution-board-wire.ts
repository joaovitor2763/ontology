import type { Delivery } from '../domain/models.ts';

/**
 * Os campos de tarefa que o quadro global de execução lê: cartão, lista,
 * filtros (escopo, cliente, responsável, marco, origem, período, busca em
 * título, descrição e frente), ordem por prazo, selo de evidência
 * (`inferEvidence`/`awaitingApproval`), movimento para o Backlog e edição de
 * prazo (`directDueDatePatch`). A gaveta, o aceite e a conclusão carregam a
 * tarefa completa do próprio cliente (`ClientExecutionProvider`). Um campo
 * novo lido pelo quadro entra aqui; o resumo por cliente (0042) passa a
 * guardá-lo e os resumos antigos ficam sem a parte do quadro até o backfill.
 */
export const BOARD_TASK_FIELDS = ['id', 'company', 'title', 'description', 'status', 'ownerId',
  'dueAt', 'milestone', 'kind', 'workstream', 'priority', 'productId', 'deadline', 'startsAt',
  'evidence', 'checklist', 'requiresEvidence', 'approvalRequired'] as const;
export type BoardTask = Pick<Delivery, typeof BOARD_TASK_FIELDS[number]>;

/** Só os campos do quadro; campo ausente continua ausente. */
export function boardTaskOf(task: Partial<Delivery>): BoardTask {
  const picked: Record<string, unknown> = {};
  for (const field of BOARD_TASK_FIELDS) if (task[field] !== undefined) picked[field] = task[field];
  return picked as BoardTask;
}

/**
 * As tarefas do quadro como tabela com dicionário. Num quadro com dezenas de
 * clientes no mesmo plano, título, descrição, frente e checklist se repetem
 * em cada cliente; cada valor distinto vai uma vez em `values` e cada linha
 * traz o `id` e, para cada campo de `fields`, o índice do valor (0 = campo
 * ausente). O dicionário vem ordenado por frequência, para os índices mais
 * usados serem os mais curtos.
 */
export type BoardTaskTable = { fields: string[]; values: unknown[]; rows: (string | number)[][] };

const VALUE_FIELDS = BOARD_TASK_FIELDS.filter(field => field !== 'id');

type Entry = { value: unknown; count: number; index: number; order: string };

export function encodeBoardTasks(tasks: readonly Partial<Delivery>[]): BoardTaskTable {
  // Texto, número e booleano são a própria chave (o `Map` não confunde 1 com "1");
  // objeto e lista entram pelo JSON.
  const primitives = new Map<unknown, Entry>(), objects = new Map<string, Entry>();
  const entryOf = (value: unknown) => {
    const object = value !== null && typeof value === 'object';
    const key = object ? JSON.stringify(value) : value;
    const map = (object ? objects : primitives) as Map<unknown, Entry>;
    let entry = map.get(key);
    if (!entry) map.set(key, entry = { value, count: 0, index: 0,
      order: `${object ? 'o' : typeof value}:${object ? key : String(value)}` });
    entry.count += 1;
    return entry;
  };
  // Laços simples: ~10 mil tarefas × 17 campos por leitura do quadro.
  const width = VALUE_FIELDS.length, slots: (Entry | null)[] = new Array(tasks.length * width);
  for (let row = 0; row < tasks.length; row++) {
    const task = tasks[row];
    for (let column = 0; column < width; column++) {
      const value = task[VALUE_FIELDS[column]];
      slots[row * width + column] = value === undefined ? null : entryOf(value);
    }
  }
  const order = [...primitives.values(), ...objects.values()].sort((x, y) =>
    y.count - x.count || (x.order < y.order ? -1 : x.order > y.order ? 1 : 0));
  order.forEach((entry, position) => { entry.index = position + 1; });
  const rows: (string | number)[][] = new Array(tasks.length);
  for (let row = 0; row < tasks.length; row++) {
    const line: (string | number)[] = new Array(width + 1);
    line[0] = tasks[row].id as string;
    for (let column = 0; column < width; column++)
      line[column + 1] = slots[row * width + column]?.index ?? 0;
    rows[row] = line;
  }
  return { fields: [...VALUE_FIELDS], values: [null, ...order.map(entry => entry.value)], rows };
}

/**
 * Tarefas de volta, uma por linha. Texto, número e booleano são imutáveis e
 * podem ser compartilhados; objeto e lista (prazo relativo, checklist) saem
 * novos em cada tarefa, como sairiam do JSON de objetos.
 */
export function decodeBoardTasks(table: BoardTaskTable): Delivery[] {
  if (!table || !Array.isArray(table.fields) || !Array.isArray(table.values) || !Array.isArray(table.rows) ||
    !table.fields.every(field => (VALUE_FIELDS as readonly string[]).includes(field)))
    throw new TypeError('Tabela de tarefas inválida.');
  const objects = table.values.map(value => value !== null && typeof value === 'object'
    ? JSON.stringify(value) : null);
  return table.rows.map(row => {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || row.length !== table.fields.length + 1)
      throw new TypeError('Linha de tarefa inválida.');
    const task: Record<string, unknown> = { id: row[0] };
    for (let column = 0; column < table.fields.length; column++) {
      const position = row[column + 1];
      if (position === 0) continue;
      if (typeof position !== 'number' || !(position > 0 && position < table.values.length))
        throw new TypeError('Linha de tarefa inválida.');
      const shared = objects[position];
      task[table.fields[column]] = shared === null ? table.values[position] : JSON.parse(shared);
    }
    return task as Delivery;
  });
}

/** O ciclo como o quadro global o recebe (`ExecutionBoardCycle`), na mesma ordem de campos. */
export type BoardCycle = { id: string; company: string; name: string; status: string;
  taskIds: string[]; productId?: string; enrollmentId?: string; templateId?: string;
  milestone?: number; startsAt: string; endsAt: string; ownerId: string;
  acceptance: { done: boolean; approvedBy?: string }[] };

export const compactCycle = (cycle: Omit<BoardCycle, 'acceptance'> &
  { acceptance: { done: boolean; approvedBy?: string }[] }): BoardCycle => ({
  id: cycle.id, company: cycle.company, name: cycle.name, status: cycle.status,
  taskIds: cycle.taskIds, productId: cycle.productId, enrollmentId: cycle.enrollmentId,
  templateId: cycle.templateId, milestone: cycle.milestone,
  startsAt: cycle.startsAt, endsAt: cycle.endsAt, ownerId: cycle.ownerId,
  acceptance: cycle.acceptance.map(item => ({ done: item.done, approvedBy: item.approvedBy })),
});
