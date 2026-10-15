import type { Decision, Meeting, Pain, Solution } from "./models.ts";

export const painSeverityLabel: Record<Pain["severity"], string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

export const painStatusLabel: Record<Pain["status"], string> = {
  aberta: "Aberta",
  validada: "Validada",
  "em-tratamento": "Em tratamento",
  resolvida: "Resolvida",
};

export const painFrequencyLabel: Record<NonNullable<Pain["frequency"]>, string> = {
  pontual: "Pontual",
  semanal: "Semanal",
  diaria: "Diária",
  continua: "Contínua",
};

export const solutionStatusLabel: Record<Solution["status"], string> = {
  proposta: "Proposta",
  aprovada: "Aprovada",
  "em-execucao": "Em execução",
  concluida: "Concluída",
  descartada: "Descartada",
};

export const effortLabel: Record<NonNullable<Solution["effort"]>, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

export const decisionStatusLabel: Record<Decision["status"], string> = {
  registrada: "Registrada",
  "em-andamento": "Em andamento",
  cumprida: "Cumprida",
  revertida: "Revertida",
};

export function painError(pain: Pain): string | null {
  if (!pain.title.trim()) return "Dê um título à dor.";
  if (
    pain.confidence != null &&
    (!Number.isFinite(pain.confidence) ||
      pain.confidence < 0 ||
      pain.confidence > 100)
  )
    return "A confiança deve ficar entre 0 e 100.";
  return null;
}

/** Every solution answers at least one pain and states its hypothesis. */
export function solutionError(
  solution: Solution,
  pains: Pick<Pain, "id">[],
): string | null {
  if (!solution.title.trim()) return "Dê um título à solução.";
  if (!solution.painIds.length)
    return "Vincule a solução a pelo menos uma dor.";
  if (solution.painIds.some((id) => !pains.some((p) => p.id === id)))
    return "A solução aponta para uma dor que não existe.";
  if (!solution.hypothesis.trim())
    return "Escreva a hipótese: se fizermos X, esperamos Y porque Z.";
  return null;
}

export function decisionError(decision: Decision): string | null {
  if (!decision.summary.trim()) return "Descreva a decisão.";
  if (decision.dueAt && !Number.isFinite(Date.parse(decision.dueAt)))
    return "Revise o prazo da decisão.";
  return null;
}

/** Validates the whole capture before saving anything. */
export function captureError(input: {
  meeting: Meeting;
  pains: Pain[];
  solutions: Solution[];
  decisions: Decision[];
  noNewPains: boolean;
}): string | null {
  if (!input.meeting.title.trim()) return "Dê um título à reunião.";
  if (!input.noNewPains && input.pains.length === 0)
    return "Registre ao menos uma dor ou marque que nenhuma nova dor foi identificada.";
  for (const pain of input.pains) {
    const problem = painError(pain);
    if (problem) return problem;
  }
  for (const solution of input.solutions) {
    const problem = solutionError(solution, input.pains);
    if (problem) return problem;
  }
  for (const decision of input.decisions) {
    const problem = decisionError(decision);
    if (problem) return problem;
  }
  return null;
}

/** Keeps the plain `decisions` list in sync with structured items. */
export function withDecisionItems(meeting: Meeting, items: Decision[]): Meeting {
  return {
    ...meeting,
    decisionItems: items,
    decisions: items.map((d) => d.summary.trim()).filter(Boolean),
  };
}

export function openPains(pains: Pain[], company?: string) {
  return pains
    .filter((p) => (!company || p.company === company) && p.status !== "resolvida")
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export function severityRank(severity: Pain["severity"]) {
  return { baixa: 0, media: 1, alta: 2, critica: 3 }[severity];
}

export function solutionsForPain(solutions: Solution[], painId: string) {
  return solutions.filter((s) => s.painIds.includes(painId));
}
