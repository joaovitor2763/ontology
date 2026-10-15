import type { DeliveryStatus } from "../domain/models.ts";
import { isBacklogTask } from "../domain/delivery-policy.ts";

/**
 * Coluna do quadro. "backlog" é derivada, não um status: tarefas em `fila` sem
 * prazo. A coluna `fila` ("A fazer") fica só com o que já tem data.
 */
export type BoardLane = DeliveryStatus | "backlog";
export const boardOrder: BoardLane[] = ["backlog", "fila", "em-curso", "revisao", "entregue", "bloqueado"];
export const boardLaneLabel: Record<BoardLane, string> = {
  backlog: "Backlog",
  fila: "A fazer",
  "em-curso": "Em curso",
  revisao: "Revisão",
  entregue: "Entregue",
  bloqueado: "Bloqueado",
};
export function boardLane(task: { status: DeliveryStatus; dueAt?: string }): BoardLane {
  return isBacklogTask({ status: task.status, dueAt: task.dueAt ?? "" }) ? "backlog" : task.status;
}
/** O status que um cartão recebe ao cair na coluna. */
export const laneStatus = (lane: BoardLane): DeliveryStatus => lane === "backlog" ? "fila" : lane;

/**
 * Quantas tarefas uma coluna do quadro mostra antes de pedir licença.
 *
 * O quadro global passa de trezentas tarefas, com a maioria em "Entregue" — uma
 * coluna que ninguém percorre até o fim e que, renderizada inteira, cobra por
 * tecla digitada no filtro. Acima deste volume a coluna mostra as primeiras e
 * oferece "Mostrar mais"; abaixo dele nada aparece, como manda
 * `docs/plano-de-refino-navegacao-e-densidade.md`.
 */
export const BOARD_PAGE = 40;

export type BoardColumn<T> = {
  status: BoardLane;
  /** Quantas tarefas a coluna tem, esteja mostrando quantas estiver. */
  total: number;
  visible: T[];
  /** Quantas ficaram de fora; zero quando a coluna cabe inteira. */
  hidden: number;
};

/**
 * Agrupa as tarefas por status na ordem do quadro e corta cada coluna no que
 * ela mostra. `shown` guarda o que cada coluna já expandiu; coluna ausente usa
 * `BOARD_PAGE`. Uma passada pela lista, não uma por coluna.
 *
 * `pinned` são tarefas que ficam à vista mesmo fora da janela, na posição que
 * teriam na coluna: é o que garante que a tarefa recém-movida não desapareça ao
 * cair numa coluna cortada.
 */
export function boardColumns<T extends { id: string; status: DeliveryStatus; dueAt?: string }>(
  tasks: readonly T[],
  order: readonly BoardLane[],
  shown: Partial<Record<BoardLane, number>> = {},
  pinned: readonly string[] = [],
): BoardColumn<T>[] {
  const groups = new Map<BoardLane, T[]>(order.map((status) => [status, []]));
  // Sem coluna Backlog no recorte, a tarefa sem prazo continua na coluna do seu status.
  const lane = (task: T) => { const value = boardLane(task); return groups.has(value) ? value : task.status; };
  for (const task of tasks) groups.get(lane(task))?.push(task);
  return order.map((status) => {
    const list = groups.get(status) ?? [];
    const limit = Math.min(Math.max(shown[status] ?? BOARD_PAGE, 0), list.length);
    if (limit === list.length)
      return { status, total: list.length, visible: list, hidden: 0 };
    const visible = pinned.length
      ? list.filter((task, index) => index < limit || pinned.includes(task.id))
      : list.slice(0, limit);
    return { status, total: list.length, visible, hidden: list.length - visible.length };
  });
}

/** Quanto a coluna passa a mostrar depois de um "Mostrar mais". */
export function expandColumn(
  shown: Partial<Record<BoardLane, number>>,
  status: BoardLane,
): Partial<Record<BoardLane, number>> {
  return { ...shown, [status]: (shown[status] ?? BOARD_PAGE) + BOARD_PAGE };
}
