"use client";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { documentOperationBaseline } from "@/shared/infrastructure/operations";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Remover e restaurar um documento aplica na hora: o registro já existe e o
 * arquivo em R2 não é tocado. Registrar e versionar dependem do upload e do id
 * do servidor, e continuam esperando a confirmação.
 */
export function useDocumentOperation() {
  const { restoreDoc } = useDocumentsState();
  const operation = useConfirmedOperation({
    baseline: documentOperationBaseline,
    optimistic: ["documents.remove", "documents.restore"],
    success: (command, input) => {
      const { documentId } = input as { documentId?: string };
      if (command === "documents.remove" && documentId)
        return {
          message: "Documento removido",
          undo: () => void operation.run("documents.restore", { documentId }, () => restoreDoc(documentId)),
        };
      if (command === "documents.restore") return "Documento restaurado";
      if (command === "documents.register") return "Documento registrado";
      if (command === "documents.version") return "Nova versão registrada";
      if (command === "documents.update") return "Documento salvo";
      return null;
    },
  });
  return operation;
}
export type DocumentOperation = ConfirmedOperation;
export function DocumentOperationFeedback({ operation }: { operation: DocumentOperation }) {
  return <OperationFeedback operation={operation} />;
}
