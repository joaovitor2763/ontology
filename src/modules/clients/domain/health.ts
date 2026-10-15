/**
 * Operational health of a client, explained. Deterministic: every deduction has
 * a code, a label and points, so the badge can say why it has that colour.
 * Hard caps keep a client with an active blocker or a milestone late for more
 * than a week from ever showing green.
 */
export type HealthFlag = "green" | "yellow" | "red";

export type HealthReason = {
  code:
    | "bloqueios"
    | "ciclo-atrasado"
    | "sem-proximo-passo"
    | "proximo-passo-sem-prazo"
    | "proximo-passo-vencido"
    | "entregas-vencidas"
    | "entrega-critica-vencida"
    | "riscos-criticos"
    | "aceite-parado";
  label: string;
  /** Always negative. */
  points: number;
  severity: "critical" | "attention";
};

export type HealthInput = {
  today: string;
  openDeliveries: {
    id: string;
    status: string;
    dueAt?: string;
    priority?: string;
    blockers?: string;
    blocker?: { resolvedAt?: string };
  }[];
  currentCycle?: {
    name?: string;
    status: string;
    endsAt: string;
    acceptanceRequestedAt?: string;
  } | null;
  /** All operational cycles: selecting a current cycle must not hide other pending work. */
  cycles?: NonNullable<HealthInput["currentCycle"]>[];
  nextStep?: { text: string; dueAt?: string } | null;
  /** Registered alerts still open, with their severity. */
  openRisks?: { severity: string }[];
};

export type HealthResult = {
  score: number;
  flag: HealthFlag;
  reasons: HealthReason[];
  /** Explains a hard cap when deductions alone would produce a higher score. */
  limit?: string;
  summary: string;
  version: "v2";
};

export const HEALTH_VERSION = "v1";

const DAY = 86_400_000;

function daysLate(dueAt: string | undefined, today: string) {
  if (!dueAt) return 0;
  const due = Date.parse(`${dueAt.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - due) / DAY));
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function isBlockedDelivery(d: HealthInput["openDeliveries"][number]) {
  if (d.status === "bloqueado") return true;
  if (d.blocker && !d.blocker.resolvedAt) return true;
  return Boolean(d.blockers?.trim()) && !d.blocker?.resolvedAt;
}

export function operationalHealth(input: HealthInput): HealthResult {
  const today = input.today;
  const reasons: HealthReason[] = [];
  let score = 100;
  let cap = 100;
  const add = (
    code: HealthReason["code"],
    label: string,
    points: number,
    severity: HealthReason["severity"] = "attention",
  ) => {
    if (!points) return;
    score -= points;
    reasons.push({ code, label, points: -Math.abs(points), severity });
  };

  const open = input.openDeliveries.filter((d) => d.status !== "entregue");
  const blocked = open.filter(isBlockedDelivery);
  const overdue = open.filter(
    (d) => !isBlockedDelivery(d) && daysLate(d.dueAt, today) > 0,
  );
  const criticalOverdue = overdue.filter(
    (d) => d.priority === "alta" || d.priority === "critica",
  );

  if (blocked.length) {
    cap = Math.min(cap, 49);
    add(
      "bloqueios",
      plural(blocked.length, "bloqueio ativo", "bloqueios ativos"),
      Math.min(blocked.length * 35, 60),
      "critical",
    );
  }

  const cycles = input.cycles ?? (input.currentCycle ? [input.currentCycle] : []);
  const pending = cycles.filter(cycle => cycle.status !== "concluido");
  // Deduct each kind of problem once, using the longest wait, regardless of
  // which cycle the client header currently displays.
  const lateCycles = pending.filter(cycle => cycle.status !== "em-aceite")
    .map(cycle => ({ cycle, days: daysLate(cycle.endsAt, today) }))
    .filter(row => row.days > 0).sort((a, b) => b.days - a.days);
  const late = lateCycles[0];
  if (late) {
    if (late.days > 7) cap = Math.min(cap, 49);
    add("ciclo-atrasado",
      `${late.cycle.name ? `Ciclo ${late.cycle.name}` : "Ciclo atual"} fora do prazo há ${plural(late.days, "dia", "dias")}`,
      30, late.days > 7 ? "critical" : "attention");
  }
  const waitingCycles = pending.filter(cycle => cycle.status === "em-aceite")
    .map(cycle => ({ cycle, days: daysLate(cycle.acceptanceRequestedAt ?? cycle.endsAt, today) }))
    .filter(row => row.days > 5).sort((a, b) => b.days - a.days);
  const waiting = waitingCycles[0];
  if (waiting)
    add("aceite-parado",
      `Aceite${waiting.cycle.name ? ` de ${waiting.cycle.name}` : ""} aguardando o cliente há ${plural(waiting.days, "dia", "dias")}`,
      15);

  // The historical manual next-step field does not affect operational health.

  if (overdue.length)
    add(
      "entregas-vencidas",
      plural(overdue.length, "entrega vencida", "entregas vencidas"),
      Math.min(overdue.length * 8, 24),
    );
  if (criticalOverdue.length)
    add(
      "entrega-critica-vencida",
      "Tarefa de alta prioridade vencida",
      20,
      "critical",
    );

  const risks = (input.openRisks ?? []).filter((r) => r.severity === "critico");
  if (risks.length)
    add(
      "riscos-criticos",
      plural(risks.length, "alerta crítico registrado", "alertas críticos registrados"),
      Math.min(risks.length * 20, 40),
      "critical",
    );

  const finalScore = Math.max(0, Math.min(cap, Math.round(score)));
  const limit = score > cap
    ? `Pontuação limitada a 49 por ${blocked.length ? "bloqueio ativo" : "ciclo atrasado há mais de 7 dias"}.`
    : undefined;
  const flag: HealthFlag =
    finalScore >= 80 ? "green" : finalScore >= 50 ? "yellow" : "red";
  return {
    score: finalScore,
    flag,
    reasons,
    ...(limit ? { limit } : {}),
    summary: reasons.length
      ? reasons.map((r) => r.label).join(" · ")
      : "Sem bloqueios, atrasos ou pendências operacionais.",
    version: "v2",
  };
}
