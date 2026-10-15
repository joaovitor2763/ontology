/**
 * Strict validation of model output. The platform only trusts JSON that
 * matches the contract exactly; anything else is rejected and the rule-based
 * result stays in place.
 */
export const SIGNAL_CATEGORIES = [
  "pergunta",
  "plataforma",
  "risco",
  "compromisso",
  "acao",
  "informacao_faltante",
] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];
export const SIGNAL_PRIORITIES = ["baixa", "media", "alta"] as const;
export type SignalPriority = (typeof SIGNAL_PRIORITIES)[number];

export type SignalClassification = {
  signalId: string;
  isPending: boolean;
  categories: SignalCategory[];
  priority: SignalPriority;
  title: string;
  topic: string;
  requestedAction: string;
  answeredLater: boolean;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
};

/** Removes Markdown fences the model may add despite instructions. */
export function stripFences(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function parseJson<T>(text: string): T {
  return JSON.parse(stripFences(text)) as T;
}

export function validateClassifications(
  text: string,
  expectedIds: string[],
  knownMessageIds: string[],
): SignalClassification[] {
  const body = parseJson<{ classifications?: unknown }>(text);
  if (!Array.isArray(body.classifications))
    throw new Error("Resposta sem a lista classifications.");
  const rows = body.classifications as Record<string, unknown>[];
  if (rows.length !== expectedIds.length)
    throw new Error(
      `Esperava ${expectedIds.length} classificações e recebeu ${rows.length}.`,
    );
  const expected = new Set(expectedIds);
  const known = new Set(knownMessageIds);
  const seen = new Set<string>();
  return rows.map((row) => {
    const signalId = String(row.signalId ?? "");
    if (!expected.has(signalId) || seen.has(signalId))
      throw new Error(`signalId inesperado ou repetido: ${signalId}`);
    seen.add(signalId);
    const categories = Array.isArray(row.categories) ? row.categories : [];
    if (
      !categories.every((c) =>
        (SIGNAL_CATEGORIES as readonly string[]).includes(String(c)),
      )
    )
      throw new Error(`Categoria inválida em ${signalId}.`);
    const priority = String(row.priority ?? "");
    if (!(SIGNAL_PRIORITIES as readonly string[]).includes(priority))
      throw new Error(`Prioridade inválida em ${signalId}.`);
    if (typeof row.isPending !== "boolean" || typeof row.answeredLater !== "boolean")
      throw new Error(`Campos booleanos inválidos em ${signalId}.`);
    if (row.answeredLater && row.isPending)
      throw new Error(`Contradição em ${signalId}: respondida depois e ainda pendente.`);
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      throw new Error(`confidence fora de 0–1 em ${signalId}.`);
    const evidence = Array.isArray(row.evidenceMessageIds)
      ? row.evidenceMessageIds.map(String)
      : [];
    if (!evidence.every((id) => known.has(id)))
      throw new Error(`evidenceMessageIds desconhecido em ${signalId}.`);
    return {
      signalId,
      isPending: row.isPending,
      categories: categories.map(String) as SignalCategory[],
      priority: priority as SignalPriority,
      title: String(row.title ?? "").slice(0, 160),
      topic: String(row.topic ?? "").slice(0, 80),
      requestedAction: String(row.requestedAction ?? "").slice(0, 300),
      answeredLater: row.answeredLater,
      confidence,
      reason: String(row.reason ?? "").slice(0, 600),
      evidenceMessageIds: evidence,
    };
  });
}

export type DailySummary = {
  title: string;
  summary: string;
  topics: string[];
  questions: string[];
  commitments: string[];
  risks: string[];
  nextSteps: string[];
  sentiment: "positive" | "neutral" | "attention" | "critical";
};

export function validateDailySummary(text: string): DailySummary {
  const body = parseJson<{ summary?: Record<string, unknown> }>(text);
  const s = body.summary;
  if (!s || typeof s !== "object") throw new Error("Resposta sem summary.");
  const list = (value: unknown) =>
    Array.isArray(value) ? value.slice(0, 6).map((x) => String(x).slice(0, 200)) : [];
  const sentiment = String(s.sentiment ?? "neutral");
  if (!["positive", "neutral", "attention", "critical"].includes(sentiment))
    throw new Error("sentiment inválido.");
  return {
    title: String(s.title ?? "").slice(0, 120),
    summary: String(s.summary ?? "").slice(0, 900),
    topics: list(s.topics),
    questions: list(s.questions),
    commitments: list(s.commitments),
    risks: list(s.risks),
    nextSteps: list(s.nextSteps),
    sentiment: sentiment as DailySummary["sentiment"],
  };
}
