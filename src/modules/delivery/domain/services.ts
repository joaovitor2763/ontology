import type { Delivery } from "./models.ts";

export type AcceptanceChannel =
  | "reuniao"
  | "email"
  | "whatsapp"
  | "documento"
  | "outro";

export const acceptanceChannelLabel: Record<AcceptanceChannel, string> = {
  reuniao: "Reunião",
  email: "E-mail",
  whatsapp: "WhatsApp",
  documento: "Documento assinado",
  outro: "Outro",
};

/** A criterion is only accepted when someone on the client side approved it. */
export type AcceptanceCriterion = {
  id: string;
  text: string;
  done: boolean;
  approvedBy?: string;
  approvedAt?: string;
  channel?: AcceptanceChannel;
  note?: string;
};

export type CycleStatus = "planejado" | "em-curso" | "em-aceite" | "concluido";

export type CycleTransition = { status: CycleStatus; at: string; by: string };

/** What the client said after the cycle closed: the "monitor recovery" stage. */
export type CycleDebrief = {
  at: string;
  by: string;
  /** 1–5. */
  score: number;
  comment: string;
  wouldRehire: boolean;
};

export function debriefError(d: Pick<CycleDebrief, "score" | "comment">) {
  if (!Number.isInteger(d.score) || d.score < 1 || d.score > 5)
    return "Escolha uma nota de 1 a 5.";
  if (d.comment.trim().length > 600)
    return "O comentário deve ter no máximo 600 caracteres.";
  return null;
}

export type ServiceCycle = {
  /** Independent purchase; absent on historical execution until safely associated. */
  enrollmentId?: string;
  productVersion?: number;
  productBaseline?: import("../../catalog/domain/products").CycleTemplate;
  /** Original generated owner; absent legacy copies are never assumed safe to destroy. */
  productOwnerBaseline?: string;
  productUpdates?: { version: number; at: string; by: string }[];
  debrief?: CycleDebrief;
  productId?: string;
  templateId?: string;
  templateName?: string;
  /** Milestone of the client's plan this cycle executes. */
  milestone?: number;
  /** Published plan version the cycle was opened from. */
  journeyVersion?: number;
  id: string;
  company: string;
  name: string;
  goal: string;
  startsAt: string;
  endsAt: string;
  ownerId: string;
  status: CycleStatus;
  taskIds: string[];
  acceptance: AcceptanceCriterion[];
  /** Every status change, with author and time. */
  transitions?: CycleTransition[];
  /** When the cycle was sent to the client for acceptance. */
  acceptanceRequestedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Seeded cycles cannot be deleted from the array; they are hidden instead. */
  removed?: boolean;
};
export const cycleStatusLabel: Record<ServiceCycle["status"], string> = {
  planejado: "Planejado",
  "em-curso": "Em andamento",
  "em-aceite": "Em aceite",
  concluido: "Concluído",
};

/** Dates are date-only values; noon avoids DST shifting calendar labels. */
export function serviceDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}
export function cycleProgress<T extends Pick<Delivery, "id" | "company" | "status">>(
  cycle: ServiceCycle, tasks: T[],
) {
  const linked = tasks.filter(
    (t) => t.company === cycle.company && cycle.taskIds.includes(t.id),
  );
  const done = linked.filter((t) => t.status === "entregue").length;
  return {
    tasks: linked,
    done,
    total: cycle.taskIds.length,
    percent: cycle.taskIds.length
      ? Math.round((done / cycle.taskIds.length) * 100)
      : 0,
  };
}

/** Records a status change and the acceptance request; identity when nothing changed. */
export function applyStatusChange(
  previous: ServiceCycle | undefined,
  next: ServiceCycle,
  by: string,
  at: string,
): ServiceCycle {
  if (previous && previous.status === next.status) return next;
  const transitions = [
    ...(next.transitions ?? previous?.transitions ?? []),
    { status: next.status, at, by },
  ];
  const acceptanceRequestedAt =
    next.status === "em-aceite"
      ? (next.acceptanceRequestedAt ?? at)
      : next.status === "concluido"
        ? next.acceptanceRequestedAt
        : undefined;
  return { ...next, transitions, acceptanceRequestedAt };
}

/** Whole days the client has been sitting on the acceptance request. */
export function acceptanceWaitingDays(cycle: ServiceCycle, today: string) {
  if (cycle.status !== "em-aceite" || !cycle.acceptanceRequestedAt) return null;
  const from = serviceDate(cycle.acceptanceRequestedAt).getTime();
  const to = serviceDate(today).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function cycleError(
  cycle: ServiceCycle,
  tasks: Delivery[],
): string | null {
  if (!cycle.name.trim() || !cycle.goal.trim())
    return "Dê um nome e um objetivo ao ciclo.";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = serviceDate(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.getFullYear() === Number(value.slice(0, 4)) &&
      date.getMonth() + 1 === Number(value.slice(5, 7)) &&
      date.getDate() === Number(value.slice(8, 10))
    );
  };
  if (!validDate(cycle.startsAt) || !validDate(cycle.endsAt))
    return "Informe datas válidas de início e término.";
  if (cycle.endsAt < cycle.startsAt)
    return "O término precisa ser igual ou posterior ao início.";
  if (
    new Set(cycle.taskIds).size !== cycle.taskIds.length ||
    cycle.taskIds.some(
      (id) => !tasks.some((t) => t.id === id && t.company === cycle.company),
    )
  )
    return "Vincule somente tarefas disponíveis desta conta.";
  if (cycle.status === "concluido") {
    if (!cycle.acceptance.length || cycle.acceptance.some((a) => !a.done))
      return "Valide os critérios de aceite antes de concluir o ciclo.";
    if (cycle.acceptance.some((a) => !a.approvedBy?.trim()))
      return "Registre quem aprovou cada critério de aceite antes de concluir o ciclo.";
    if (cycleProgress(cycle, tasks).tasks.some((t) => t.status !== "entregue"))
      return "Conclua as tarefas vinculadas antes de encerrar o ciclo.";
  }
  return null;
}
