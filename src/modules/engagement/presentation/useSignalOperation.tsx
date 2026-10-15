"use client";
import { useConfirmedOperation, type ConfirmedCommand, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { signalOperationBaseline } from "@/shared/infrastructure/operations";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Resolver e reabrir um sinal aplica na hora: o id é do documento, o gesto não
 * chama integração nenhuma e a falha devolve o sinal ao estado anterior. Criar
 * a tarefa a partir do sinal continua esperando o id do servidor.
 */
export function useSignalOperation() {
  const { can } = usePermissions();
  return useConfirmedOperation({
    baseline: signalOperationBaseline,
    optimistic: ["signals.resolve", "signals.reopen"],
    guard: (command: ConfirmedCommand, input: unknown) => {
      const company = (input as { company: string }).company;
      if (!can("interacoes.registrar", company) || (command === "signals.createTask" && !can("entregas.editar", company)))
        return "Você não tem permissão para alterar este sinal.";
      return null;
    },
    success: (command) =>
      command === "signals.resolve" ? "Sinal resolvido"
        : command === "signals.reopen" ? "Sinal reaberto"
          : command === "signals.createTask" ? "Tarefa criada"
            : null,
  });
}
export type SignalOperation = ConfirmedOperation;
export function SignalOperationFeedback({ operation }: { operation: SignalOperation }) {
  return <OperationFeedback operation={operation} />;
}
