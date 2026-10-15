import type { CommunicationTemplate, CommunicationVariation } from "./models.ts";

export const channelLabelOf: Record<CommunicationTemplate["channel"], string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
};

/** Variables every template may use; values come from the client context. */
export const templateVariableLabel: Record<string, string> = {
  cliente: "Nome do cliente",
  contato: "Contato principal",
  responsavel: "Responsável pela conta",
  data: "Data",
  hora: "Hora",
  link: "Link",
  proximo_passo: "Próximo passo",
  documentos: "Documentos pedidos",
};

/** Replaces {{variable}} with the value; unknown variables stay visible. */
export function interpolate(body: string, values: Record<string, string | undefined>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    const value = values[key];
    return value && value.trim() ? value : match;
  });
}

export function missingVariables(body: string, values: Record<string, string | undefined>) {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (!values[match[1]]?.trim()) found.add(match[1]);
  }
  return [...found];
}

export function bestVariation(template: CommunicationTemplate): CommunicationVariation {
  return (
    template.variations.find((v) => v.id === template.defaultVariationId) ??
    [...template.variations].sort((a, b) => b.score - a.score)[0]
  );
}

export function templateError(template: CommunicationTemplate): string | null {
  if (!template.name.trim()) return "Dê um nome ao modelo.";
  if (!template.variations.length) return "Inclua pelo menos uma variação.";
  if (template.variations.some((v) => !v.body.trim()))
    return "Toda variação precisa de um texto.";
  if (!template.variations.some((v) => v.id === template.defaultVariationId))
    return "Escolha a variação padrão entre as existentes.";
  return null;
}
