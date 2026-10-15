import type {
  Hypothesis,
  HypothesisEvidenceKind,
  HypothesisStatus,
  OptionTradeoffs,
  Pain,
  Solution,
  TradeoffLevel,
} from "./models.ts";

export const hypothesisStatusLabel: Record<HypothesisStatus, string> = {
  aberta: "Aberta",
  "em-teste": "Em teste",
  confirmada: "Confirmada",
  refutada: "Refutada",
  refinada: "Refinada",
};

export const evidenceKindLabel: Record<HypothesisEvidenceKind, string> = {
  confirma: "Confirma",
  contradiz: "Contradiz",
  refina: "Refina",
};

export const evidenceSourceLabel = {
  entrevista: "Entrevista",
  dados: "Dados",
  observacao: "Observação",
} as const;

export const tradeoffLevelLabel: Record<TradeoffLevel, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

export const tradeoffAxisLabel: Record<keyof OptionTradeoffs, string> = {
  time: "Tempo",
  capital: "Capital",
  talent: "Talento",
};

/** Statuses still under investigation; the others are closed. */
export const openHypothesisStatuses: HypothesisStatus[] = ["aberta", "em-teste"];

export function hypothesisError(h: Pick<Hypothesis, "statement">): string | null {
  const statement = h.statement.trim();
  if (!statement) return "Escreva a hipótese: qual causa raiz você presume?";
  if (statement.length < 3) return "A hipótese precisa de pelo menos 3 caracteres.";
  return null;
}

/** Counts of evidence by kind and the date of the most recent one. */
export function evidenceSummary(h: Pick<Hypothesis, "evidence">) {
  const evidence = h.evidence ?? [];
  const count = (kind: HypothesisEvidenceKind) =>
    evidence.filter((e) => e.kind === kind).length;
  const lastAt = evidence
    .map((e) => e.at)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    confirma: count("confirma"),
    contradiz: count("contradiz"),
    refina: count("refina"),
    total: evidence.length,
    lastAt,
  };
}

/** Short pt-BR sentence: "2 confirmam · 1 contradiz". */
export function evidenceSentence(h: Pick<Hypothesis, "evidence">) {
  const s = evidenceSummary(h);
  if (!s.total) return "Sem evidência";
  const parts: string[] = [];
  if (s.confirma) parts.push(`${s.confirma} confirma${s.confirma === 1 ? "" : "m"}`);
  if (s.contradiz) parts.push(`${s.contradiz} contradiz${s.contradiz === 1 ? "" : "em"}`);
  if (s.refina) parts.push(`${s.refina} refina${s.refina === 1 ? "" : "m"}`);
  return parts.join(" · ");
}

const DAY = 86_400_000;

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00`) -
      Date.parse(`${from.slice(0, 10)}T00:00:00`)) /
      DAY,
  );
}

/**
 * Open hypotheses (aberta / em-teste) with no evidence in the last `days`
 * days. A hypothesis without any evidence counts from its creation date.
 */
export function staleHypotheses(
  hypotheses: Hypothesis[],
  today: string,
  days: number,
) {
  return hypotheses
    .filter((h) => openHypothesisStatuses.includes(h.status))
    .map((h) => {
      const last = evidenceSummary(h).lastAt ?? h.createdAt;
      return { hypothesis: h, idleDays: daysBetween(last, today) };
    })
    .filter((item) => item.idleDays > days)
    .sort((a, b) => b.idleDays - a.idleDays);
}

/** Non-discarded solutions per pain; the options-led approach expects at least two. */
export function optionsForPain(solutions: Solution[], painId: string) {
  return solutions.filter(
    (s) => s.painIds.includes(painId) && s.status !== "descartada",
  );
}

/** Pains that have exactly one proposed alternative (single-option warning). */
export function singleOptionPains(pains: Pick<Pain, "id">[], solutions: Solution[]) {
  return pains.filter((p) => optionsForPain(solutions, p.id).length === 1);
}

/** Builds the refined child of a hypothesis; the caller marks the parent as `refinada`. */
export function refineHypothesis(
  parent: Hypothesis,
  statement: string,
  id: string,
  at: string,
): Hypothesis {
  return {
    id,
    company: parent.company,
    statement,
    rootCause: parent.rootCause,
    status: "aberta",
    painIds: [...parent.painIds],
    parentId: parent.id,
    ownerId: parent.ownerId,
    evidence: [],
    createdAt: at,
  };
}
