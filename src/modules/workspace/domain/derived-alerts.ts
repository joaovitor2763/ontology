import { charterMissing, type Charter } from "../../clients/domain/models.ts";
import type { Delivery } from "../../delivery/domain/models.ts";
import type { ServiceCycle } from "../../delivery/domain/services.ts";
import type { Hypothesis, Meeting } from "../../engagement/domain/models.ts";
import {
  resolveAlertRules,
  type Alert,
  type AlertRules,
  type AlertSeverity,
} from "./models.ts";

export type DerivedKind =
  | "entrega-atrasada"
  | "entrega-bloqueada"
  | "aceite-pendente"
  | "ciclo-atrasado"
  | "sem-reuniao"
  | "solicitacao"
  | "hipotese-sem-evidencia"
  | "apresentacao-sem-ensaio"
  | "entrevista-sem-hipotese"
  | "decisor-nao-ouvido"
  | "contrato-incompleto";

export type DerivedAlert = Alert & {
  source: "derivado";
  kind: DerivedKind;
  relatedCycleId?: string;
  relatedMeetingId?: string;
};

/** The slice of a stakeholder the alerts need; avoids importing the presentation state. */
export type AlertStakeholder = {
  id: string;
  company: string;
  name: string;
  active: boolean;
  influence?: "alta" | "media" | "baixa";
  accountRole: string;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00`) -
      Date.parse(`${from.slice(0, 10)}T00:00:00`)) /
      DAY,
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const rank: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Alerts computed from the data itself, so the queue reflects the work and not
 * only what someone registered. Ids are deterministic per entity, which lets
 * "marcar como visto" hide them until the underlying condition changes.
 */
export function deriveAlerts(input: {
  today: string;
  /**
   * Instante para as regras de reunião (comparado com `startsAt`, gravado como
   * instante ISO); padrão: `today`. `today` dá só a data das regras por dia.
   */
  now?: string;
  clients: { slug: string; name: string; charter?: Charter | null }[];
  deliveries: Delivery[];
  cycles: ServiceCycle[];
  meetings: Meeting[];
  hypotheses?: Hypothesis[];
  stakeholders?: AlertStakeholder[];
  rules?: Partial<AlertRules> | null;
}): DerivedAlert[] {
  const today = input.today.slice(0, 10);
  const now = input.now ?? input.today;
  const rules = resolveAlertRules(input.rules);
  const out: DerivedAlert[] = [];
  const known = new Set(input.clients.map((c) => c.slug));

  for (const d of input.deliveries) {
    if (!known.has(d.company) || d.status === "entregue") continue;
    const blocked = d.status === "bloqueado" || Boolean(d.blockers?.trim());
    const late = d.dueAt ? daysBetween(d.dueAt, today) : 0;
    const overdue = Boolean(d.dueAt) && late > 0;
    if (d.kind === "request") {
      if (!blocked && !overdue) continue;
      out.push({
        id: `derived-solicitacao-${d.id}`,
        source: "derivado",
        kind: "solicitacao",
        company: d.company,
        severity: blocked ? "critico" : "atencao",
        title: blocked
          ? `Solicitação bloqueada · ${d.title}`
          : `Solicitação atrasada · ${d.title}`,
        detail: blocked
          ? d.blockers?.trim() ||
            "A solicitação do cliente está bloqueada e sem previsão."
          : `Prazo vencido há ${plural(late, "dia", "dias")}. ${d.requestedBy ? `Pedida por ${d.requestedBy}.` : ""}`.trim(),
        openedAt: overdue ? d.dueAt : today,
        relatedDeliveryId: d.id,
      });
      continue;
    }
    if (blocked) {
      out.push({
        id: `derived-entrega-bloqueada-${d.id}`,
        source: "derivado",
        kind: "entrega-bloqueada",
        company: d.company,
        severity:
          overdue || late >= -rules.lateDeliveryCriticalDays
            ? "critico"
            : "atencao",
        title: `Tarefa bloqueada · ${d.title}`,
        detail:
          d.blockers?.trim() ||
          "A entrega está bloqueada. Registre o motivo e quem resolve.",
        openedAt: overdue ? d.dueAt : today,
        relatedDeliveryId: d.id,
      });
      continue;
    }
    if (overdue) {
      out.push({
        id: `derived-entrega-atrasada-${d.id}`,
        source: "derivado",
        kind: "entrega-atrasada",
        company: d.company,
        severity: late > rules.lateDeliveryCriticalDays ? "critico" : "atencao",
        title: `Tarefa atrasada · ${d.title}`,
        detail: `Prazo vencido há ${plural(late, "dia", "dias")}. Reprograme ou conclua a entrega.`,
        openedAt: d.dueAt,
        relatedDeliveryId: d.id,
      });
    }
  }

  for (const c of input.cycles) {
    if (!known.has(c.company) || c.status === "concluido") continue;
    if (c.status === "em-aceite") {
      const since =
        (c as { acceptanceRequestedAt?: string }).acceptanceRequestedAt ??
        c.endsAt;
      const waiting = daysBetween(since, today);
      if (waiting > rules.acceptanceWaitDays)
        out.push({
          id: `derived-aceite-pendente-${c.id}`,
          source: "derivado",
          kind: "aceite-pendente",
          company: c.company,
          severity:
            waiting > rules.acceptanceWaitDays * 3 ? "critico" : "atencao",
          title: `Aceite pendente · ${c.name}`,
          detail: `O cliente ainda não registrou o aceite. Aguardando há ${plural(waiting, "dia", "dias")}.`,
          openedAt: since,
          relatedCycleId: c.id,
        });
      continue;
    }
    const late = daysBetween(c.endsAt, today);
    if (late > 0)
      out.push({
        id: `derived-ciclo-atrasado-${c.id}`,
        source: "derivado",
        kind: "ciclo-atrasado",
        company: c.company,
        severity: late > rules.lateDeliveryCriticalDays * 2 ? "critico" : "atencao",
        title: `Ciclo fora do prazo · ${c.name}`,
        detail: `O término previsto passou há ${plural(late, "dia", "dias")} e o ciclo segue ${c.status === "planejado" ? "planejado" : "em andamento"}. Replaneje as datas ou encerre o ciclo.`,
        openedAt: c.endsAt,
        relatedCycleId: c.id,
      });
  }

  for (const client of input.clients) {
    const last = input.meetings
      .filter((m) => m.company === client.slug && m.startsAt <= now)
      .map((m) => m.startsAt)
      .sort()
      .at(-1);
    const gap = last ? daysBetween(last, today) : null;
    if (gap === null || gap > rules.silentClientDays)
      out.push({
        id: `derived-sem-reuniao-${client.slug}`,
        source: "derivado",
        kind: "sem-reuniao",
        company: client.slug,
        severity: "info",
        title: last
          ? `Sem reunião há ${plural(gap!, "dia", "dias")}`
          : "Nenhuma reunião registrada",
        detail: last
          ? "O ritmo de encontros com o cliente caiu. Agende o próximo alinhamento."
          : "Registre a primeira reunião para conectar decisões e entregas.",
        openedAt: last ?? today,
      });
  }

  // Hypotheses that stopped receiving evidence: the diagnosis is not moving.
  for (const h of input.hypotheses ?? []) {
    if (!known.has(h.company)) continue;
    if (h.status !== "aberta" && h.status !== "em-teste") continue;
    const last = [...(h.evidence ?? [])]
      .map((e) => e.at)
      .sort()
      .at(-1);
    const since = last ?? h.createdAt;
    if (!since) continue;
    const idle = daysBetween(since, today);
    if (idle <= rules.hypothesisStaleDays) continue;
    out.push({
      id: `derived-hipotese-sem-evidencia-${h.id}`,
      source: "derivado",
      kind: "hipotese-sem-evidencia",
      company: h.company,
      severity: "info",
      title: `Hipótese sem evidência · ${h.statement}`,
      detail: last
        ? `Nenhuma evidência nova há ${plural(idle, "dia", "dias")}. Planeje a entrevista ou a análise que confirma ou refuta.`
        : `Aberta há ${plural(idle, "dia", "dias")} sem nenhuma evidência. Toda hipótese precisa de um teste marcado.`,
      openedAt: since,
    });
  }

  // Upcoming meetings without the preparation their kind demands.
  const nowMs = Date.parse(now);
  for (const m of input.meetings) {
    if (!known.has(m.company)) continue;
    if (m.kind !== "apresentacao" && m.kind !== "entrevista") continue;
    const startMs = Date.parse(m.startsAt);
    if (!Number.isFinite(startMs) || startMs < nowMs) continue;
    const hoursAhead = (startMs - nowMs) / HOUR;
    if (m.kind === "apresentacao") {
      if (hoursAhead > rules.presentationRehearsalHours || m.prep?.rehearsed)
        continue;
      out.push({
        id: `derived-apresentacao-sem-ensaio-${m.id}`,
        source: "derivado",
        kind: "apresentacao-sem-ensaio",
        company: m.company,
        severity: "atencao",
        title: `Apresentação sem ensaio · ${m.title}`,
        detail: `Começa em ${plural(Math.max(1, Math.round(hoursAhead)), "hora", "horas")} e o ensaio ainda não foi registrado. Combine quem fala o quê e faça a passagem com alguém de fora do contexto.`,
        openedAt: now,
        relatedMeetingId: m.id,
      });
      continue;
    }
    if (hoursAhead > 48 || m.prep?.hypothesisIds?.length) continue;
    out.push({
      id: `derived-entrevista-sem-hipotese-${m.id}`,
      source: "derivado",
      kind: "entrevista-sem-hipotese",
      company: m.company,
      severity: "info",
      title: `Entrevista sem hipóteses · ${m.title}`,
      detail:
        "Defina o que esta conversa vai testar antes de entrar na sala. Entrevistas sem hipótese viram coleta de informação, não diagnóstico.",
      openedAt: now,
      relatedMeetingId: m.id,
    });
  }

  // Decision-makers we never sat down with.
  const heard = new Map<string, Set<string>>();
  for (const m of input.meetings) {
    if (m.startsAt > now) continue;
    const set = heard.get(m.company) ?? new Set<string>();
    for (const id of m.attendeeIds) set.add(id);
    heard.set(m.company, set);
  }
  for (const s of input.stakeholders ?? []) {
    if (!known.has(s.company) || !s.active) continue;
    const decisive =
      s.influence === "alta" ||
      s.accountRole === "patrocinador" ||
      s.accountRole === "decisor";
    if (!decisive || heard.get(s.company)?.has(s.id)) continue;
    out.push({
      id: `derived-decisor-nao-ouvido-${s.company}-${s.id}`,
      source: "derivado",
      kind: "decisor-nao-ouvido",
      company: s.company,
      severity: "atencao",
      title: `Decisor ainda não ouvido · ${s.name}`,
      detail:
        "Quem decide ou patrocina o trabalho não participou de nenhuma reunião. Sem essa conversa, a recomendação chega sem apoio.",
      openedAt: today,
    });
  }

  // Engagements running without an agreed value contract.
  for (const client of input.clients) {
    const missing = charterMissing(client.charter ?? undefined);
    if (!missing.length) continue;
    const running = input.cycles.some(
      (c) => c.company === client.slug && c.status !== "concluido",
    );
    if (!running) continue;
    out.push({
      id: `derived-contrato-incompleto-${client.slug}`,
      source: "derivado",
      kind: "contrato-incompleto",
      company: client.slug,
      severity: "info",
      title: "Contrato de valor incompleto",
      detail: `Faltam ${plural(missing.length, "campo", "campos")} para o trabalho ter um "como fica quando termina" combinado com o cliente.`,
      openedAt: today,
    });
  }

  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.openedAt.localeCompare(b.openedAt),
  );
}

export type PrimaryKind =
  | "bloqueio"
  | "proximo-passo-vencido"
  | "ciclo-atrasado"
  | "saude-vermelha"
  | "sem-proximo-passo"
  | "entrega-vencida"
  | "aceite-parado"
  | "apresentacao-sem-ensaio"
  | "decisor-nao-ouvido"
  | "registrado"
  | "entrevista-sem-hipotese"
  | "hipotese-sem-evidencia"
  | "contrato-incompleto"
  | "sem-reuniao";

export type PrimaryAlert = {
  company: string;
  kind: PrimaryKind;
  /** Position in the precedence list; lower comes first. */
  rank: number;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Verb the person can act on. */
  action: string;
  target:
    | { type: "delivery"; id: string }
    | { type: "cycle"; id: string }
    | { type: "meeting"; id: string }
    | { type: "client" };
  /** The queue alert behind it, when there is one. */
  alert?: Alert;
};

const precedence: PrimaryKind[] = [
  "bloqueio",
  "proximo-passo-vencido",
  "ciclo-atrasado",
  "saude-vermelha",
  "sem-proximo-passo",
  "entrega-vencida",
  "aceite-parado",
  "apresentacao-sem-ensaio",
  "decisor-nao-ouvido",
  "registrado",
  "entrevista-sem-hipotese",
  "hipotese-sem-evidencia",
  "contrato-incompleto",
  "sem-reuniao",
];

const actionFor: Record<PrimaryKind, string> = {
  bloqueio: "Resolver bloqueio",
  "proximo-passo-vencido": "Atualizar próximo passo",
  "ciclo-atrasado": "Replanejar ciclo",
  "saude-vermelha": "Revisar cliente",
  "sem-proximo-passo": "Definir próximo passo",
  "entrega-vencida": "Reprogramar entrega",
  "aceite-parado": "Cobrar aceite",
  "apresentacao-sem-ensaio": "Preparar apresentação",
  "decisor-nao-ouvido": "Agendar conversa",
  registrado: "Revisar alerta",
  "entrevista-sem-hipotese": "Definir hipóteses",
  "hipotese-sem-evidencia": "Registrar evidência",
  "contrato-incompleto": "Definir contrato de valor",
  "sem-reuniao": "Agendar reunião",
};

function kindOf(alert: Alert): PrimaryKind {
  switch (alert.kind) {
    case "entrega-bloqueada":
      return "bloqueio";
    case "solicitacao":
      return alert.title.startsWith("Solicitação bloqueada")
        ? "bloqueio"
        : "entrega-vencida";
    case "ciclo-atrasado":
      return "ciclo-atrasado";
    case "entrega-atrasada":
      return "entrega-vencida";
    case "aceite-pendente":
      return "aceite-parado";
    case "sem-reuniao":
      return "sem-reuniao";
    case "apresentacao-sem-ensaio":
    case "decisor-nao-ouvido":
    case "entrevista-sem-hipotese":
    case "hipotese-sem-evidencia":
    case "contrato-incompleto":
      return alert.kind;
    default:
      return "registrado";
  }
}

function targetOf(alert: Alert): PrimaryAlert["target"] {
  if (alert.relatedDeliveryId)
    return { type: "delivery", id: alert.relatedDeliveryId };
  if (alert.relatedCycleId) return { type: "cycle", id: alert.relatedCycleId };
  const meetingId = (alert as { relatedMeetingId?: string }).relatedMeetingId;
  if (meetingId) return { type: "meeting", id: meetingId };
  return { type: "client" };
}

/**
 * The one thing to look at for a client, chosen by a fixed precedence so the
 * home and the client list stay quiet: blocker, then an overdue next step, a
 * late cycle, red health, a missing next step, overdue deliveries, a stalled
 * acceptance, registered alerts and, last, silence.
 */
export function primaryAlertFor(
  company: string,
  alerts: Alert[],
  extras: {
    today: string;
    health?: { flag: "green" | "yellow" | "red"; score: number; summary?: string };
    nextStep?: { text: string; dueAt?: string } | null;
  },
): PrimaryAlert | null {
  const candidates: PrimaryAlert[] = [];
  const severityRank: Record<AlertSeverity, number> = {
    critico: 0,
    atencao: 1,
    info: 2,
  };
  for (const alert of alerts.filter((a) => a.company === company)) {
    const kind = kindOf(alert);
    candidates.push({
      company,
      kind,
      rank: precedence.indexOf(kind),
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      action: actionFor[kind],
      target: targetOf(alert),
      alert,
    });
  }
  if (extras.health?.flag === "red")
    candidates.push({
      company,
      kind: "saude-vermelha",
      rank: precedence.indexOf("saude-vermelha"),
      severity: "critico",
      title: `Saúde crítica · ${extras.health.score}/100`,
      detail:
        extras.health.summary ??
        "A combinação de atrasos e pendências levou o cliente ao vermelho.",
      action: actionFor["saude-vermelha"],
      target: { type: "client" },
    });
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      severityRank[a.severity] - severityRank[b.severity] ||
      (a.alert?.openedAt ?? "").localeCompare(b.alert?.openedAt ?? ""),
  );
  return candidates[0];
}

/** Orders alerts of the queue by the same precedence used for the primary alert. */
export function precedenceRank(alert: Alert) {
  return precedence.indexOf(kindOf(alert));
}
