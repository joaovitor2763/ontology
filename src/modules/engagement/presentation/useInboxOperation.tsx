"use client";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { interactionOperationBaseline } from "@/shared/infrastructure/operations";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Marcar a conversa como lida ou fixada aplica na hora: é um campo do próprio
 * documento, sem id novo e sem envio ao WhatsApp. Notas continuam esperando a
 * confirmação, porque a nota nasce com id do servidor.
 */
export function useInboxOperation() {
  return useConfirmedOperation({
    baseline: interactionOperationBaseline,
    optimistic: ["inbox.thread.update"],
    success: (command) =>
      command === "inbox.notes.create" ? "Nota registrada"
        : command === "inbox.notes.update" ? "Nota salva"
          : null,
  });
}
export type InboxOperation = ConfirmedOperation;
export function InboxOperationFeedback({ operation }: { operation: InboxOperation }) {
  return <OperationFeedback operation={operation} />;
}
