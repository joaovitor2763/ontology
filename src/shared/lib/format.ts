import type { DeliveryStatus } from "@/modules/delivery/domain/models";
import {
  dateShort,
  dateTimeShort,
  toDate,
  weekdayDateShort,
} from "./dates.ts";
import type { Channel, MeetingKind } from "@/modules/engagement/domain/models";
import type { AlertSeverity } from "@/modules/workspace/domain/models";

export const deliveryLabel: Record<DeliveryStatus, string> = {
  fila: "A fazer",
  "em-curso": "Em curso",
  revisao: "Revisão",
  entregue: "Entregue",
  bloqueado: "Bloqueado",
};

export const deliveryOrder: DeliveryStatus[] = [
  "fila",
  "em-curso",
  "revisao",
  "entregue",
  "bloqueado",
];

export const meetingLabel: Record<MeetingKind, string> = {
  kickoff: "Kickoff",
  workshop: "Workshop",
  steering: "Steering",
  demo: "Demo",
  alinhamento: "Alinhamento",
  suporte: "Suporte",
  retro: "Retrospectiva",
  entrevista: "Entrevista",
  apresentacao: "Apresentação",
};

export const docKindLabel: Record<
  import("@/modules/documents/domain/models").DocKind,
  string
> = {
  contrato: "Contrato",
  entregavel: "Entregável",
  evidencia: "Evidência",
  ata: "Ata",
  comunicacao: "Comunicação",
  outro: "Outro",
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const channelLabel: Record<Channel, string> = {
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "E-mail",
  slack: "Slack",
  call: "Call",
  note: "Notas",
};

export const severityLabel: Record<AlertSeverity, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Info",
};

export const originLabel: Record<
  NonNullable<import("@/modules/delivery/domain/models").Delivery["origin"]>,
  string
> = {
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  email: "E-mail",
  ligacao: "Ligação",
  outro: "Outro",
};

export const priorityLabel: Record<
  NonNullable<import("@/modules/delivery/domain/models").Delivery["priority"]>,
  string
> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

export function isRequest(d: { kind?: string }) {
  return d.kind === "request";
}

export function dueMeta(dueAt: string, now = NOW) {
  const due = dueAt.slice(0, 10);
  const today = now.slice(0, 10);
  const days = Math.round(
    (Date.parse(`${due}T00:00:00`) - Date.parse(`${today}T00:00:00`)) /
      86_400_000,
  );
  if (Number.isNaN(days))
    return {
      label: "sem prazo",
      tone: "neutral" as const,
      days: null as number | null,
    };
  if (days < 0) {
    const n = Math.abs(days);
    return {
      label: `há ${n} ${n === 1 ? "dia" : "dias"}`,
      tone: "bad" as const,
      days,
    };
  }
  if (days === 0) return { label: "hoje", tone: "warn" as const, days };
  if (days === 1) return { label: "amanhã", tone: "neutral" as const, days };
  return { label: `em ${days} dias`, tone: "neutral" as const, days };
}

export function healthTone(n: number): "ok" | "warn" | "bad" {
  if (n >= 80) return "ok";
  if (n >= 60) return "warn";
  return "bad";
}

export type CoverageBand = "fraca" | "parcial" | "pronta";

export function coverageBand(n: number): CoverageBand {
  if (n < 40) return "fraca";
  if (n < 70) return "parcial";
  return "pronta";
}

export const coverageCopy: Record<
  CoverageBand,
  { label: string; hint: string; tone: "bad" | "warn" | "ok"; range: string }
> = {
  fraca: {
    label: "Fraca",
    hint: "Conhecimento insuficiente; complete as definições e evidências.",
    tone: "bad",
    range: "0–39%",
  },
  parcial: {
    label: "Parcial",
    hint: "Mapeamento parcial; revise campos, relações e exemplos.",
    tone: "warn",
    range: "40–69%",
  },
  pronta: {
    label: "Pronta",
    hint: "Mapeamento avançado; valide o uso com exemplos reais.",
    tone: "ok",
    range: "70–100%",
  },
};

export function coverageAvg(
  nodes: { coverage: number; coverageAssessed?: boolean }[],
) {
  const assessed = nodes.filter((node) => node.coverageAssessed !== false);
  if (!assessed.length) return 0;
  return Math.round(
    assessed.reduce((s, n) => s + n.coverage, 0) / assessed.length,
  );
}

export function coverageGaps(
  node: { description: string; properties: string[]; coverage: number },
  linkCount: number,
) {
  const gaps: string[] = [];
  if (!node.description.trim()) {
    gaps.push("Falta uma descrição que explique o elemento.");
  }
  if (node.properties.length < 2) gaps.push("Poucos campos mapeados.");
  if (linkCount < 1) gaps.push("Sem ligação com o resto do grafo.");
  if (node.coverage < 40) gaps.push("Faltam exemplos reais da conta.");
  else if (node.coverage < 70)
    gaps.push("Ainda falta evidência de uso no piloto.");
  return gaps;
}

/**
 * Reference "now" for due dates, agendas and relative labels. Real clock by
 * default, at minute precision so server and client agree; `NEXT_PUBLIC_DEMO_DATE`
 * freezes it for demonstrations and screenshots.
 */
/** Timezone of the workspace; dates in records are wall-clock in this zone. */
export const APP_TIMEZONE =
  (process.env.NEXT_PUBLIC_TIMEZONE as string | undefined) || "America/Sao_Paulo";

/** Date-only value for an instant in the workspace timezone. */
export function workspaceDate(value: string | Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Wall-clock "now" in the workspace timezone, identical on the server (UTC) and in the browser. */
/** Hora de parede do workspace (São Paulo, sem fuso) no minuto de `at`: a mesma forma de `NOW`. */
export function workspaceMinute(at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:00`;
}
export let NOW: string =
  (process.env.NEXT_PUBLIC_DEMO_DATE as string | undefined) || workspaceMinute();

/**
 * Re-reads the clock. The server calls it per request (module state outlives
 * requests in the Worker); the client calls it on navigation and focus.
 */
export function refreshNow() {
  const demo = process.env.NEXT_PUBLIC_DEMO_DATE as string | undefined;
  NOW = demo || workspaceMinute();
  return NOW;
}

export function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function nextSlot(from = NOW, hour = 14) {
  const d = new Date(from);
  d.setDate(d.getDate() + 3);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:00`;
}

export function padMilestone(n: number) {
  return `M${String(n).padStart(2, "0")}`;
}

/** Empty values (e.g. a Backlog task without deadline) read as "—", never as an invalid date. */
export function formatDate(iso: string) {
  if (!iso) return "—";
  return dateShort(toDate(iso));
}

export function formatDateTime(iso: string) {
  return dateTimeShort(toDate(iso));
}

export function formatWeekday(iso: string) {
  return weekdayDateShort(toDate(iso));
}

export function relativeFrom(iso: string, now = new Date(NOW)) {
  const t = new Date(iso).getTime();
  const diff = t - now.getTime();
  const min = Math.round(diff / 60000);
  const abs = Math.abs(min);
  const future = min > 0;
  if (abs < 60) {
    const unit = abs === 1 ? "minuto" : "minutos";
    return future ? `em ${abs} ${unit}` : `há ${abs} ${unit}`;
  }
  const hours = Math.round(abs / 60);
  if (hours < 24) {
    const unit = hours === 1 ? "hora" : "horas";
    return future ? `em ${hours} ${unit}` : `há ${hours} ${unit}`;
  }
  const days = Math.round(hours / 24);
  const unit = days === 1 ? "dia" : "dias";
  return future ? `em ${days} ${unit}` : `há ${days} ${unit}`;
}

export function initialsColor(tint: string) {
  return tint;
}
