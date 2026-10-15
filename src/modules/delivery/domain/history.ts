import type {
  Delivery,
  DeliveryBlocker,
  DeliveryHistoryEntry,
} from "./models.ts";

const TRACKED = ["status", "ownerId", "dueAt", "priority"] as const;

/** History entries for the tracked fields that actually change in `patch`. */
export function recordHistory(
  previous: Partial<Delivery>,
  patch: Partial<Delivery>,
  by: string,
  at: string,
): DeliveryHistoryEntry[] {
  const entries: DeliveryHistoryEntry[] = [];
  for (const field of TRACKED) {
    if (!(field in patch)) continue;
    const from = previous[field];
    const to = patch[field];
    if (from === to) continue;
    entries.push({
      at,
      by,
      field,
      from: from == null ? undefined : String(from),
      to: to == null ? undefined : String(to),
    });
  }
  return entries;
}

/** Applies a blocker (or resolves the current one) keeping status and the legacy text in sync. */
export function blockerPatch(
  current: Pick<Delivery, "status" | "blocker" | "blockers">,
  blocker: Omit<DeliveryBlocker, "resolvedAt"> | null,
  at: string,
): Partial<Delivery> {
  if (blocker) {
    return {
      blocker: { ...blocker, resolvedAt: undefined },
      blockers: blocker.reason,
      status: "bloqueado",
    };
  }
  const resolved: DeliveryBlocker | undefined = current.blocker
    ? { ...current.blocker, resolvedAt: at }
    : current.blockers
      ? { reason: current.blockers, since: at, resolvedAt: at }
      : undefined;
  return {
    blocker: resolved,
    blockers: "",
    status: current.status === "bloqueado" ? "em-curso" : current.status,
  };
}

/**
 * Quantas alterações cada tarefa guarda inteiras.
 *
 * O histórico é a única parte do documento de execução que cresce por gesto e
 * nunca para: cada mudança de status acrescenta ~115 B e cada comentário ~86 B
 * de histórico, para sempre. Acima do limite, as mais antigas viram uma linha
 * de `resumo` com a contagem — a tarefa continua dizendo quantas alterações
 * teve, e as recentes, que são as que alguém lê, continuam inteiras.
 */
export const HISTORY_LIMIT = 40;

/** Quantas alterações uma entrada representa (uma, ou as que o resumo condensa). */
export function historyWeight(entry: DeliveryHistoryEntry) {
  return entry.field === "resumo" ? (entry.count ?? 0) : 1;
}

/** Total de alterações que o histórico representa, resumos incluídos. */
export function historyCount(entries: DeliveryHistoryEntry[] = []) {
  return entries.reduce((total, entry) => total + historyWeight(entry), 0);
}

/** Mantém as últimas `HISTORY_LIMIT` alterações e conta as anteriores em uma linha. */
export function compactHistory(entries: DeliveryHistoryEntry[] = []): DeliveryHistoryEntry[] {
  if (entries.length <= HISTORY_LIMIT) return entries;
  // Ordena por data antes de cortar: o corte é do passado, não do fim do array.
  const ordered = [...entries].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const kept = ordered.slice(ordered.length - HISTORY_LIMIT);
  const dropped = ordered.slice(0, ordered.length - HISTORY_LIMIT);
  const summary: DeliveryHistoryEntry = {
    at: dropped[dropped.length - 1].at,
    by: "",
    field: "resumo",
    count: historyCount(dropped),
  };
  return [summary, ...kept];
}

export const historyFieldLabel: Record<DeliveryHistoryEntry["field"], string> = {
  status: "Status",
  ownerId: "Responsável",
  dueAt: "Prazo",
  priority: "Prioridade",
  blocker: "Bloqueio",
  comment: "Comentário",
  resumo: "Resumo",
};
