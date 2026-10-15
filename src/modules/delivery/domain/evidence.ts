import type { Delivery } from "./models";

/**
 * Evidence inferred from the system itself, without AI: if the state already
 * proves a delivery happened, say so; if a delivery was closed without any
 * trace, ask for review. Rules are keyed by words in the title and by fields.
 */
export type EvidenceStatus =
  | "validada"
  | "evidencia_disponivel"
  | "revisao_necessaria"
  | "pendente";

export const evidenceLabel: Record<EvidenceStatus, string> = {
  validada: "Validada",
  evidencia_disponivel: "Evidência disponível",
  revisao_necessaria: "Concluída sem evidência",
  pendente: "Sem evidência ainda",
};

export type EvidenceContext = {
  /** Lead assigned to the client, when any. */
  leadId?: string;
  /** The client has at least one conversation thread. */
  hasThread?: boolean;
  documents?: {
    kind: string;
    relatedTaskId?: string;
    reviewStatus?: string;
  }[];
  /** Meeting start times of the client, ISO. */
  meetings?: string[];
  /** Acceptance state of the cycle that contains the delivery. */
  cycleAcceptance?: { total: number; approved: number };
};

export type EvidenceResult = {
  status: EvidenceStatus;
  reason: string;
  recommendedAction: string;
  /** Which signal produced the result, for tests and tooltips. */
  source:
    | "documento_aprovado"
    | "documento"
    | "evidencia_texto"
    | "responsavel"
    | "conversa"
    | "contrato"
    | "reuniao"
    | "aceite"
    | "checklist"
    | "nenhum";
};

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const has = (title: string, ...words: string[]) =>
  words.some((w) => title.includes(w));

export function inferEvidence(
  delivery: Pick<
    Delivery,
    "title" | "status" | "evidence" | "checklist" | "dueAt" | "requiresEvidence"
  >,
  context: EvidenceContext = {},
): EvidenceResult {
  const title = normalize(delivery.title);
  const done = delivery.status === "entregue";
  const linked = (context.documents ?? []).filter(
    (d) => d.relatedTaskId !== undefined && d.relatedTaskId !== "",
  );
  const approved = linked.find((d) => d.reviewStatus === "aprovado");

  const found = (
    source: EvidenceResult["source"],
    reason: string,
  ): EvidenceResult =>
    done
      ? {
          status: "validada",
          reason,
          recommendedAction: "Nada a fazer. A evidência sustenta a conclusão.",
          source,
        }
      : {
          status: "evidencia_disponivel",
          reason,
          recommendedAction:
            "A evidência já existe. Confira e conclua a entrega.",
          source,
        };

  if (approved)
    return found("documento_aprovado", "Documento vinculado aprovado na revisão.");
  if (linked.length)
    return found(
      "documento",
      `${linked.length} documento${linked.length === 1 ? "" : "s"} vinculado${linked.length === 1 ? "" : "s"} à entrega.`,
    );
  if (delivery.evidence?.trim())
    return found("evidencia_texto", "Evidência registrada na própria entrega.");

  const checklist = delivery.checklist ?? [];
  if (checklist.length && checklist.every((item) => item.done))
    return found("checklist", "Todos os itens do checklist foram concluídos.");

  if (has(title, "responsavel", "lider", "alocar") && context.leadId)
    return found("responsavel", "O cliente já tem responsável definido.");
  if (
    has(title, "grupo", "canal oficial", "whatsapp", "conversa") &&
    context.hasThread
  )
    return found("conversa", "Existe conversa registrada com o cliente.");
  if (
    has(title, "contrato", "cadastro", "proposta", "termo", "nda") &&
    (context.documents ?? []).some((d) => d.kind === "contrato")
  )
    return found("contrato", "Há um contrato no arquivo do cliente.");
  if (has(title, "ata", "reuniao", "kickoff", "workshop", "entrevista")) {
    const meetings = context.meetings ?? [];
    if (meetings.length)
      return found("reuniao", "Há reunião registrada para este cliente.");
  }
  if (
    has(title, "aceite", "aprovacao", "homologacao", "validacao") &&
    context.cycleAcceptance &&
    context.cycleAcceptance.total > 0 &&
    context.cycleAcceptance.approved === context.cycleAcceptance.total
  )
    return found("aceite", "Os critérios de aceite do ciclo estão aprovados.");

  if (done)
    return {
      status: "revisao_necessaria",
      reason: "Concluída sem documento, evidência ou checklist que comprove.",
      recommendedAction:
        "Anexe a evidência ou registre em texto o que foi entregue.",
      source: "nenhum",
    };
  return {
    status: "pendente",
    reason: delivery.requiresEvidence
      ? "A entrega exige evidência antes de ser concluída."
      : "Nenhuma evidência registrada até agora.",
    recommendedAction: delivery.requiresEvidence
      ? "Anexe o documento ou descreva a evidência para poder concluir."
      : "Registre a evidência quando concluir.",
    source: "nenhum",
  };
}

/** True when a delivery marked as done still waits for an approved, linked file. */
export function awaitingApproval(
  delivery: Pick<Delivery, "status" | "approvalRequired">,
  documents: { relatedTaskId?: string; reviewStatus?: string }[],
) {
  if (delivery.status !== "entregue" || !delivery.approvalRequired) return false;
  return !documents.some(
    (d) => d.relatedTaskId && d.reviewStatus === "aprovado",
  );
}
