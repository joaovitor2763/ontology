export type ServiceModule = "ontology";

export type ServiceConfig = {
  productIds?: string[];
  name: string;
  model: "consultoria" | "implementacao" | "recorrente";
  cadenceWeeks: number;
  modules: Record<ServiceModule, boolean>;
  /** The client's WhatsApp group in the conversations base; read-only view in Interações. */
  whatsapp?: WhatsAppGroupRef;
};

/**
 * The client's WhatsApp group in the conversations base: the exact group name
 * as recorded there is the key; an id is optional for bases keyed by id.
 */
export type WhatsAppGroupRef = { groupName: string; groupId?: string };

export function whatsappGroupOf(config: { whatsapp?: WhatsAppGroupRef }) {
  const g = config.whatsapp;
  if (!g) return null;
  const name = g.groupName?.trim() ?? "";
  const id = g.groupId?.trim() ?? "";
  return name || id ? { name, id } : null;
}

export const serviceModelLabel: Record<ServiceConfig["model"], string> = {
  consultoria: "Consultoria",
  implementacao: "Implementação",
  recorrente: "Acompanhamento contínuo",
};

export const defaultService: ServiceConfig = {
  name: "Entrega de serviços",
  model: "consultoria",
  cadenceWeeks: 2,
  modules: { ontology: false },
};
