import type {
  Signal,
  SignalCategory,
  SignalPriority,
  Thread,
  ThreadMessage,
} from "./models.ts";

export const signalCategoryLabel: Record<SignalCategory, string> = {
  pergunta: "Pergunta",
  risco: "Risco",
  compromisso: "Compromisso",
  acao: "Ação pedida",
  informacao_faltante: "Informação faltante",
  plataforma: "Plataforma",
};

export const signalPriorityLabel: Record<SignalPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deterministic id for a message inside a thread (FNV-1a over the key). */
export function signalId(threadId: string, message: ThreadMessage) {
  const key = `${threadId}|${message.at}|${message.from}|${message.text.slice(0, 80)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `sig-${hash.toString(16).padStart(8, "0")}`;
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const RULES: { category: SignalCategory; words: string[] }[] = [
  {
    category: "risco",
    words: ["risco", "bloquead", "travad", "urgente", "atras", "cair", "cancel", "problema"],
  },
  {
    category: "compromisso",
    words: ["combinado", "vamos ", "ate dia", "prazo", "entrego", "mando ", "fecho ", "amanha"],
  },
  {
    category: "acao",
    words: ["pode ", "podem ", "precisamos", "precisa ", "favor", "envia", "manda ", "agenda", "confirma"],
  },
  {
    category: "informacao_faltante",
    words: ["nao sei", "falta", "qual ", "quais ", "onde ", "quando ", "sem acesso", "nao temos"],
  },
  {
    category: "plataforma",
    words: ["login", "senha", "acesso", "sistema", "plataforma", "erro", "nao abre", "nao carrega"],
  },
];

export type ExtractOptions = {
  /** Names of people from the team; everyone else is the client. */
  isTeam: (author: string) => boolean;
  now?: string;
  /** Maximum age of a message to be considered, in days. */
  windowDays?: number;
};

function categorize(text: string, authorRole: Signal["authorRole"]) {
  const t = normalize(text);
  const categories: SignalCategory[] = [];
  if (authorRole === "cliente" && /\?/.test(text)) categories.push("pergunta");
  for (const rule of RULES) {
    if (rule.words.some((w) => t.includes(normalize(w)))) categories.push(rule.category);
  }
  return categories;
}

function priorityOf(categories: SignalCategory[], authorRole: Signal["authorRole"]): SignalPriority {
  if (categories.includes("risco")) return "alta";
  if (categories.includes("compromisso") && authorRole === "cliente") return "media";
  if (categories.includes("informacao_faltante") || categories.includes("acao")) return "media";
  if (categories.includes("pergunta") || categories.includes("plataforma")) return "media";
  return "baixa";
}

function titleOf(categories: SignalCategory[], text: string) {
  const lead = categories[0];
  const head = text.replace(/\s+/g, " ").trim().slice(0, 60);
  const suffix = head.length < text.trim().length ? "…" : "";
  const prefix =
    lead === "risco"
      ? "Risco sinalizado"
      : lead === "pergunta"
        ? "Pergunta do cliente"
        : lead === "compromisso"
          ? "Compromisso assumido"
          : lead === "acao"
            ? "Ação pedida"
            : lead === "informacao_faltante"
              ? "Informação faltante"
              : "Tema de plataforma";
  return `${prefix} · ${head}${suffix}`;
}

/** Explains, in plain words, why the rule flagged the message. */
export function signalReason(signal: Pick<Signal, "categories" | "authorRole" | "answeredLater">) {
  const parts: string[] = [];
  if (signal.categories.includes("risco"))
    parts.push("menciona risco, bloqueio ou urgência");
  if (signal.categories.includes("pergunta"))
    parts.push("é uma pergunta do cliente");
  if (signal.categories.includes("compromisso"))
    parts.push("registra um compromisso com data ou entrega");
  if (signal.categories.includes("acao"))
    parts.push("pede uma ação da equipe");
  if (signal.categories.includes("informacao_faltante"))
    parts.push("indica informação que ainda falta");
  if (signal.categories.includes("plataforma"))
    parts.push("fala de acesso ou sistema");
  const base = parts.length ? `Marcado por regra porque ${parts.join(", ")}.` : "Marcado por regra.";
  return signal.answeredLater
    ? `${base} Uma resposta da equipe veio depois; confirme se encerrou o assunto.`
    : base;
}

/** Signals of one thread by rules. Pure; the caller applies reviews and AI classifications. */
export function extractSignals(thread: Thread, options: ExtractOptions): Signal[] {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const windowMs = (options.windowDays ?? 30) * DAY;
  const messages = thread.messages.filter((m) => m.kind !== "note");
  const signals: Signal[] = [];
  messages.forEach((message, index) => {
    if (!message.text.trim()) return;
    const at = Date.parse(message.at);
    if (Number.isFinite(at) && nowMs - at > windowMs) return;
    const authorRole: Signal["authorRole"] = options.isTeam(message.from) ? "equipe" : "cliente";
    const categories = categorize(message.text, authorRole);
    // Team messages count only when they carry a commitment or a risk.
    const relevant =
      authorRole === "cliente"
        ? categories.length > 0
        : categories.some((c) => c === "compromisso" || c === "risco");
    if (!relevant) return;
    const later = messages
      .slice(index + 1)
      .filter((m) => options.isTeam(m.from) && Date.parse(m.at) - at <= DAY);
    const answeredLater =
      authorRole === "cliente" &&
      (categories.includes("pergunta") || categories.includes("acao") || categories.includes("informacao_faltante")) &&
      later.length > 0;
    const signal: Signal = {
      id: signalId(thread.id, message),
      company: thread.company,
      threadId: thread.id,
      messageId: `${thread.id}:${index}`,
      at: message.at,
      text: message.text.slice(0, 240),
      author: message.from,
      authorRole,
      categories,
      priority: priorityOf(categories, authorRole),
      title: titleOf(categories, message.text),
      source: "regra",
      answeredLater,
    };
    signal.reason = signalReason(signal);
    signals.push(signal);
  });
  return signals.sort(
    (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.at.localeCompare(a.at),
  );
}

export function priorityRank(priority: SignalPriority) {
  return { baixa: 0, media: 1, alta: 2 }[priority];
}

export type GroupHealth = {
  score: number;
  level: "healthy" | "attention" | "critical";
  messages7d: number;
  lastActivityAt: string | null;
  hoursSinceActivity: number | null;
  openSignals: number;
  summary: string;
  recommendation: string;
};

/** Deterministic health of a conversation from activity and open signals. */
export function groupHealth(thread: Thread, signals: Signal[], now: string): GroupHealth {
  const nowMs = Date.parse(now);
  const open = signals.filter((s) => !s.resolvedAt && !s.answeredLater);
  // Each open signal counts once, by its most serious category.
  const lead = (s: Signal) =>
    s.categories.includes("risco")
      ? "risco"
      : s.categories.includes("informacao_faltante")
        ? "informacao_faltante"
        : s.categories.includes("pergunta")
          ? "pergunta"
          : "outro";
  const risks = open.filter((s) => lead(s) === "risco").length;
  const missing = open.filter((s) => lead(s) === "informacao_faltante").length;
  const questions = open.filter((s) => lead(s) === "pergunta").length;
  const messages = thread.messages.filter((m) => m.kind !== "note");
  const messages7d = messages.filter((m) => nowMs - Date.parse(m.at) <= 7 * DAY).length;
  const last = messages.at(-1)?.at ?? null;
  const hours = last ? Math.max(0, Math.round((nowMs - Date.parse(last)) / HOUR)) : null;
  let score = 100;
  score -= Math.min(risks, 3) * 30;
  score -= Math.min(missing, 3) * 20;
  score -= Math.min(questions, 5) * 16;
  if (messages7d === 0) score -= 20;
  if (hours == null || hours > 168) score -= 30;
  else if (hours > 72) score -= 15;
  score = Math.max(0, Math.min(100, score));
  const level = score >= 85 ? "healthy" : score >= 55 ? "attention" : "critical";
  const summaryParts: string[] = [];
  if (risks) summaryParts.push(`${risks} risco${risks > 1 ? "s" : ""} sinalizado${risks > 1 ? "s" : ""}`);
  if (questions) summaryParts.push(`${questions} pergunta${questions > 1 ? "s" : ""} sem resposta`);
  if (missing) summaryParts.push(`${missing} informação${missing > 1 ? "ões" : ""} faltando`);
  if (hours != null && hours > 72) summaryParts.push(`sem mensagens há ${Math.round(hours / 24)} dias`);
  const summary = summaryParts.length
    ? summaryParts.join(", ") + "."
    : "Conversa ativa e sem pendências abertas.";
  const recommendation =
    risks > 0
      ? "Responda o risco hoje e registre o combinado como entrega."
      : questions > 0
        ? "Responda as perguntas do cliente antes do fim do dia."
        : missing > 0
          ? "Peça a informação que falta e defina quem envia."
          : hours != null && hours > 72
            ? "Retome a conversa com um próximo passo claro."
            : "Mantenha o ritmo: registre decisões como entregas.";
  return {
    score,
    level,
    messages7d,
    lastActivityAt: last,
    hoursSinceActivity: hours,
    openSignals: open.length,
    summary,
    recommendation,
  };
}

export const healthLevelLabel: Record<GroupHealth["level"], string> = {
  healthy: "Saudável",
  attention: "Atenção",
  critical: "Crítica",
};

/** The single signal to act on first: open, highest priority, risk before question, oldest first. */
export function nextBestAction(signals: Signal[]): Signal | undefined {
  const rank = (s: Signal) =>
    (s.categories.includes("risco") ? 0 : s.categories.includes("compromisso") ? 1 : s.categories.includes("pergunta") ? 2 : 3) +
    (3 - priorityRank(s.priority)) * 10;
  return signals
    .filter((s) => !s.resolvedAt && !s.answeredLater)
    .sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at))[0];
}
