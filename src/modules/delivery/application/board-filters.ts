import type { Delivery } from "../domain/models.ts";
import { matchesTaskScope, type TaskScope } from "../domain/task-scope.ts";
import { addDays } from "../../catalog/domain/schedule.ts";

export type BoardPeriod = "all" | "overdue" | "today" | "next7" | "custom";

/** O recorte do quadro e da lista (o que as visões salvas guardam, menos a forma de exibir). */
export type BoardFilters = {
  scope: TaskScope;
  statuses: readonly string[];
  q: string;
  clients: readonly string[];
  owners: readonly string[];
  milestones: readonly string[];
  kinds: readonly string[];
  period: BoardPeriod;
  dateFrom: string;
  dateTo: string;
  dueOrder: "default" | "soonest";
};

/** O que o filtro consulta fora da tarefa. */
export type BoardFilterContext = {
  /** Data de hoje (só-data) para os períodos. */
  today: string;
  /** Clientes de "Meus clientes": onde a pessoa está alocada hoje. */
  mine: ReadonlySet<string>;
  companyName: (slug: string) => string;
  ownerName: (id: string) => string;
  /** A tarefa pertence a algum ciclo (origem "ciclo"). */
  inCycle: (id: string) => boolean;
};

/** Os campos da tarefa que o filtro e a ordem leem; nenhum outro. */
export type FilterableTask = Pick<Delivery, "id" | "company" | "title" | "description" | "status" |
  "ownerId" | "dueAt" | "milestone" | "kind" | "workstream">;

/**
 * Filtra e ordena as tarefas do quadro e da lista. Puro: o quadro global (só
 * com os campos do quadro) e o do documento local chegam ao mesmo resultado
 * para as mesmas tarefas. Ordena no lugar quando `dueOrder` é "soonest", como
 * antes (o resultado é uma lista nova; `items` não muda).
 */
export function filterBoardTasks<T extends FilterableTask>(items: readonly T[], filters: BoardFilters,
  context: BoardFilterContext): T[] {
  const { scope, statuses, clients, owners, milestones, kinds, period, dateFrom, dateTo } = filters;
  const { today, mine } = context;
  const query = filters.q.trim().toLowerCase();
  const horizon = addDays(today, 7);
  const result = items.filter((d) => {
    if (!matchesTaskScope(d, scope)) return false;
    if (statuses.length && !statuses.includes(d.status)) return false;
    // "Meus clientes" é dinâmico: os clientes em que a pessoa está alocada hoje.
    if (clients.length && !clients.includes(d.company) && !mine.has(d.company)) return false;
    if (owners.length && !owners.includes(d.ownerId)) return false;
    if (milestones.length && !milestones.includes(String(d.milestone))) return false;
    if (kinds.length) {
      const origin = d.kind === "request" ? "solicitacao" : context.inCycle(d.id) ? "ciclo" : "plano";
      if (!kinds.includes(origin)) return false;
    }
    // Tarefa sem prazo (Backlog) nunca está atrasada, para hoje ou num intervalo.
    if (period !== "all" && !d.dueAt) return false;
    if (period === "overdue" && (d.status === "entregue" || d.dueAt >= today)) return false;
    if (period === "today" && (d.status === "entregue" || d.dueAt !== today)) return false;
    if (period === "next7" && (d.status === "entregue" || d.dueAt < today || d.dueAt > horizon)) return false;
    if (period === "custom" && ((dateFrom && d.dueAt < dateFrom) || (dateTo && d.dueAt > dateTo))) return false;
    if (!query) return true;
    const hay =
      `${d.title} ${d.description} ${context.companyName(d.company)} ${context.ownerName(d.ownerId)} ${d.workstream}`.toLowerCase();
    return hay.includes(query);
  });
  return filters.dueOrder === "soonest"
    ? result.sort((a, b) => Number(!a.dueAt) - Number(!b.dueAt) || a.dueAt.localeCompare(b.dueAt) ||
      a.title.localeCompare(b.title, "pt-BR"))
    : result;
}
