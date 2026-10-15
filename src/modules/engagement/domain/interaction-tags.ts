export const interactionTags = ["reclamacao", "feedback", "duvida", "elogio", "observacao"] as const;
export type InteractionTag = (typeof interactionTags)[number];
export const interactionTagLabel: Record<InteractionTag, string> = {
  reclamacao: "Reclamação",
  feedback: "Feedback",
  duvida: "Dúvida",
  elogio: "Elogio",
  observacao: "Observação",
};

/** Stable order, no duplicate or unknown labels; old records have no tags. */
export function normalizeInteractionTags(value: unknown): InteractionTag[] {
  return interactionTags.filter((tag) => Array.isArray(value) && value.includes(tag));
}
