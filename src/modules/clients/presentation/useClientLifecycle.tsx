"use client";
import { useClientsState } from "../infrastructure/state";
import { clientOperationBaseline } from "@/shared/infrastructure/operations";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Arquivar e reativar um cliente, com o mesmo feedback dos demais gestos: o
 * botão conta o progresso, o sucesso vira toast com "Desfazer" quando a
 * operação inversa é segura, e só o erro ganha bloco.
 */
export function useClientLifecycle() {
  const { archiveClient, restoreClient } = useClientsState();
  const operation = useConfirmedOperation({
    baseline: clientOperationBaseline,
    optimistic: ["clients.archive", "clients.restore"],
    fallback: "Não foi possível confirmar a alteração do cliente.",
    success: (command, input) => {
      const company = (input as { company: string }).company;
      return command === "clients.archive"
        // `run` é declaração de função: existe antes de `success` ser chamado.
        ? { message: "Cliente arquivado", undo: () => void run("clients.restore", company) }
        : { message: "Cliente reativado" };
    },
  });
  function run(
    command: "clients.archive" | "clients.restore",
    company: string,
    confirmed?: () => void,
  ): Promise<boolean> {
    return operation
      .run(
        command,
        { company },
        () => {
          if (command === "clients.archive") archiveClient(company);
          else restoreClient(company);
        },
        confirmed,
      )
      .then((message) => message === "");
  }
  return { ...operation, run, isBusy: () => operation.busy };
}

export function ClientLifecycleFeedback({
  operation,
}: {
  operation: Pick<ConfirmedOperation, "busy" | "error" | "uncertain" | "retry" | "reset">;
}) {
  return <OperationFeedback operation={operation} inline />;
}
