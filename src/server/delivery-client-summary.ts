import { projectClients } from '../modules/clients/infrastructure/snapshot.ts';
import { enrollmentIsCurrent, type ProductEnrollment } from '../modules/clients/domain/product-enrollments.ts';
import { normalizeCatalogSnapshot, type CatalogSnapshot } from '../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, type DeliverySnapshot } from '../modules/delivery/infrastructure/snapshot.ts';
import { resolveCycles } from '../modules/delivery/infrastructure/cycles.ts';
import { followedPlanId, projectClientExecutionWithPlan, publicJourneyIds,
  type ClientExecutionPlan } from '../modules/delivery/infrastructure/client-projection.ts';
import type { Delivery } from '../modules/delivery/domain/models.ts';
import { BOARD_TASK_FIELDS, compactCycle, type BoardCycle }
  from '../modules/delivery/infrastructure/execution-board-wire.ts';
import type { ServiceCycle } from '../modules/delivery/domain/services.ts';

/**
 * Resumo persistido por cliente (`delivery_client_summary`, 0042): o resultado
 * de `projectClientExecution` para uma fatia, que a carteira, a fila e o
 * contador de alertas usam no lugar de decodificar e projetar as ~100 fatias a
 * cada leitura.
 *
 * A linha vale para uma fatia exata (geração, revisão, encarnação — conferidas
 * no SQL) **e** para os valores de fora da fatia que a projeção consultou: o
 * plano do cadastro, as contratações do cliente, os inícios usados pelos
 * prazos (`inputs`) e o plano seguido segundo o catálogo (`plan.followedId`).
 * O leitor recalcula esses valores com os documentos que já tem e cai na
 * fatia quando algum difere. Por isso o resumo nunca precisa de guarda de
 * versão do cadastro ou do catálogo: ele só registra com o que foi calculado.
 *
 * As regras de alerta dependem do relógio e continuam sendo aplicadas na
 * leitura (`deriveAlerts`); o resumo guarda só a execução, que não depende.
 */
export const SUMMARY_FORMAT = 1;

/**
 * Os campos de tarefa que carteira, fila e contador leem (`deriveAlerts`,
 * `clientProgress`, `operationalHealth`, `nextOpenTask`, `currentExecution`,
 * prévias da fila e do membro). Um leitor novo que use outro campo das
 * execuções precisa acrescentá-lo aqui e subir `SUMMARY_FORMAT` (os resumos
 * antigos passam a ser ignorados até o backfill).
 */
export const SUMMARY_TASK_FIELDS = ['id', 'company', 'title', 'status', 'dueAt', 'hours', 'ownerId',
  'kind', 'priority', 'blockers', 'blocker', 'enrollmentId', 'requestedBy'] as const;
export type SummaryTask = Pick<Delivery, typeof SUMMARY_TASK_FIELDS[number]>;
/**
 * Tarefas em colunas (a mesma lista de campos para todas): cada linha começa
 * por uma máscara dos campos definidos e traz só os valores deles, na ordem
 * de `fields`. `company` não entra: toda tarefa da projeção é do próprio
 * cliente (`projectDelivery` filtra por ele) e volta na leitura. Cerca de
 * metade do tamanho das tarefas como objetos, e um campo `undefined` continua
 * ausente (não vira `null`).
 */
export type SummaryTaskTable = { fields: string[]; rows: unknown[][] };
const PACKED_FIELDS = SUMMARY_TASK_FIELDS.filter(field => field !== 'company');
export function packTasks(company: string, tasks: readonly Partial<Delivery>[],
  fields: readonly string[] = PACKED_FIELDS): SummaryTaskTable {
  if (tasks.some(task => task.company !== company)) throw new Error('Tarefa de outro cliente na projeção.');
  return { fields: [...fields], rows: tasks.map(task => {
    let mask = 0;
    const values: unknown[] = [];
    fields.forEach((field, index) => {
      const value = task[field as keyof Delivery];
      if (value === undefined) return;
      mask |= 1 << index;
      values.push(value);
    });
    return [mask, ...values];
  }) };
}
export function unpackTasks(company: string, table: SummaryTaskTable,
  into: Record<string, unknown>[] = []): SummaryTask[] {
  return table.rows.map((row, position) => {
    const task: Record<string, unknown> = into[position] ?? { company };
    let next = 1;
    const mask = row[0] as number;
    table.fields.forEach((field, index) => {
      if (mask & (1 << index)) task[field] = row[next++];
    });
    return task as SummaryTask;
  });
}

/**
 * O que o quadro global de execução lê de um cliente, inteiro: as tarefas só
 * com `BOARD_TASK_FIELDS` (sem `company`, que volta na leitura), os ciclos
 * compactos do quadro (sem `company`) e as referências leves de todos os
 * planos — cada uma é o índice da tarefa com o mesmo `id`, título e prazo, ou a
 * tupla `[id, título, prazo]` quando difere. Vai na coluna `board` (0043),
 * comprimida e com o plano e os `inputs` (`delivery-client-summary-board.ts`):
 * o quadro lê só a coluna, nunca o corpo. Carteira, fila e contador leem o
 * corpo e não pagam por ela. Por isso ela não sobe `SUMMARY_FORMAT`.
 */
export const BOARD_PACKED_FIELDS: readonly string[] = BOARD_TASK_FIELDS.filter(field => field !== 'company');
export type SummaryBoardCycle = Omit<BoardCycle, 'company'>;
export type SummaryBoard = { tasks: SummaryTaskTable; cycles: SummaryBoardCycle[];
  references: (number | [string, string, string])[] };

export type ClientSummaryBody = {
  format: typeof SUMMARY_FORMAT;
  plan: ClientExecutionPlan;
  tasks: SummaryTaskTable;
  cycles: ServiceCycle[];
  /** O ciclo que a carteira mostra para cliente arquivado (só depende da fatia). */
  archivedCycle: { id: string; name: string } | null;
};
/** `board` só existe no lado de quem grava (a coluna `board` é lida à parte). */
export type ClientSummary = { inputs: string; body: ClientSummaryBody; board?: SummaryBoard | null };

export type SummaryContext = {
  clientState: ReturnType<typeof projectClients>;
  catalog: CatalogSnapshot;
  publicIds: string[];
  clientStarts: Record<string, string | undefined>;
  enrollmentStarts: Record<string, string | undefined>;
  enrollmentsByCompany: Map<string, ProductEnrollment[]>;
};

/** O que a projeção recebe dos documentos, montado como `projectAlerts` monta. */
export function summaryContext(clientsRaw: unknown, catalogRaw: unknown): SummaryContext {
  const clientState = projectClients((clientsRaw ?? {}) as object);
  const catalog = normalizeCatalogSnapshot((catalogRaw ?? {}) as object);
  const enrollmentsByCompany = new Map<string, ProductEnrollment[]>();
  for (const enrollment of clientState.enrollments) {
    const rows = enrollmentsByCompany.get(enrollment.company) ?? [];
    rows.push(enrollment);
    enrollmentsByCompany.set(enrollment.company, rows);
  }
  return { clientState, catalog, publicIds: publicJourneyIds(catalog),
    clientStarts: Object.fromEntries(clientState.clients.map(client => [client.slug, client.startedAt])),
    enrollmentStarts: Object.fromEntries(clientState.enrollments.map(row => [row.id, row.startsAt])),
    enrollmentsByCompany };
}

/** `undefined` e `null` não se confundem (o JSON trocaria um pelo outro). */
const value = (raw: unknown) => raw === undefined ? 0 : raw;

/**
 * Os valores de fora da fatia que a projeção leu, como texto estável: plano do
 * cadastro, contratações do cliente (plano e se é corrente, na ordem) e os
 * inícios que os prazos consultaram.
 */
export function summaryInputs(context: SummaryContext, company: string,
  journeyId: string | undefined, plan: Pick<ClientExecutionPlan, 'companies' | 'enrollmentIds'>) {
  return JSON.stringify({
    j: value(journeyId),
    e: (context.enrollmentsByCompany.get(company) ?? [])
      .map(row => [value(row.planId), enrollmentIsCurrent(row)]),
    s: plan.companies.map(slug => [slug, value(context.clientStarts[slug])]),
    r: plan.enrollmentIds.map(id => [id, value(context.enrollmentStarts[id])]),
  });
}

/** O cadastro que a fila usa para o cliente (o último ativo com o slug, como `Object.fromEntries`). */
function clientRecord(context: SummaryContext, company: string) {
  const find = (rows: { slug: string; journeyId?: string; milestone?: number }[]) =>
    rows.findLast(row => row.slug === company);
  return find(context.clientState.clients) ?? find(context.clientState.allClients) ?? { slug: company };
}

/** Projeta uma fatia e devolve o resumo com o que ele consultou. */
export function buildClientSummary(context: SummaryContext, company: string,
  raw: Partial<DeliverySnapshot>): ClientSummary {
  const client = clientRecord(context, company);
  const { execution, plan } = projectClientExecutionWithPlan(raw, context.catalog,
    client as Parameters<typeof projectClientExecutionWithPlan>[2], context.clientState.enrollments,
    context.clientStarts, context.enrollmentStarts, true);
  const tasks = packTasks(company, execution.tasks);
  return { inputs: summaryInputs(context, company, client.journeyId, plan),
    body: { format: SUMMARY_FORMAT, plan, tasks, cycles: execution.cycles,
      archivedCycle: archivedCycleOf(company, raw) },
    board: boardPart(company, execution) };
}

/**
 * A parte do quadro, ou `null` quando ela não cabe no formato (referência com
 * campo que não é texto, ciclo ou referência de outro cliente): sem ela, o
 * quadro projeta a fatia desse cliente (o resto do resumo vale).
 */
function boardPart(company: string, execution: { tasks: Delivery[]; cycles: ServiceCycle[];
  referenceTasks: { id: string; company: string; title: string; dueAt: string }[] }): SummaryBoard | null {
  if (!execution.referenceTasks.every(task => task.company === company &&
      [task.id, task.title, task.dueAt].every(value => typeof value === 'string')) ||
    !execution.cycles.every(cycle => cycle.company === company)) return null;
  const position = new Map<string, number>();
  execution.tasks.forEach((task, index) => { if (!position.has(task.id)) position.set(task.id, index); });
  return { tasks: packTasks(company, execution.tasks, BOARD_PACKED_FIELDS),
    cycles: execution.cycles.map(cycle => {
      const rest: Partial<BoardCycle> = compactCycle(cycle);
      delete rest.company;
      return rest as SummaryBoardCycle;
    }),
    references: execution.referenceTasks.map(reference => {
      const index = position.get(reference.id);
      const task = index === undefined ? undefined : execution.tasks[index];
      return task && task.title === reference.title && task.dueAt === reference.dueAt
        ? index! : [reference.id, reference.title, reference.dueAt];
    }) };
}

function archivedCycleOf(company: string, raw: Partial<DeliverySnapshot>) {
  const cycle = resolveCycles(normalizeDeliverySnapshot(raw)).find(row => row.company === company &&
    !row.removed && (row.status === 'em-curso' || row.status === 'em-aceite'));
  return cycle ? { id: cycle.id, name: cycle.name } : null;
}

/**
 * A execução guardada ainda é a que `projectClientExecution` daria agora para
 * este cadastro e este catálogo? `null` = não; quem lê cai na fatia.
 */
export function summaryExecution(context: SummaryContext,
  client: { slug: string; journeyId?: string }, summary: ClientSummary) {
  const { body } = summary;
  if (body?.format !== SUMMARY_FORMAT || !planStillHolds(context, client, summary.inputs, body.plan))
    return null;
  return { tasks: unpackTasks(client.slug, body.tasks) as Delivery[], cycles: body.cycles };
}

/**
 * O cadastro e o catálogo de agora dão os mesmos valores de fora da fatia
 * (`inputs`) e o mesmo plano seguido que a projeção registrou?
 */
export function planStillHolds(context: SummaryContext, client: { slug: string; journeyId?: string },
  inputs: string, plan: ClientExecutionPlan) {
  try {
    return inputs === summaryInputs(context, client.slug, client.journeyId, plan) &&
      followedPlanId(context.catalog, plan.privatePlanIds, plan.planId, plan.pinnedVersion,
        context.publicIds) === plan.followedId;
  } catch {
    return false;
  }
}

/** Lê uma linha do banco; corpo ilegível conta como ausente. */
export function parseSummary(inputs: string | null, body: string | null): ClientSummary | null {
  if (inputs === null || body === null) return null;
  try {
    const parsed = JSON.parse(body) as ClientSummaryBody;
    return parsed?.format === SUMMARY_FORMAT ? { inputs, body: parsed } : null;
  } catch {
    return null;
  }
}
