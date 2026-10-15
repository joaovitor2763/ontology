"use client";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { workspaceOperationBaseline } from "@/shared/infrastructure/operations";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";
/**
 * Ciência de alerta e ajuste de regras. A ciência é aplicada na hora: o alerta
 * sai da lista assim que a pessoa confirma e volta se o servidor recusar.
 */
export function useWorkspaceOperation() {
  return useConfirmedOperation({
    baseline: workspaceOperationBaseline,
    optimistic: true,
    success: (command, input) => command === "workspace.settings.update" ? "Configurações salvas"
      : command === "alerts.acknowledgeBatch" ? `${(input as {alerts: unknown[]}).alerts.length} alertas marcados como vistos` : null,
  });
}
export type WorkspaceOperation = ConfirmedOperation;
export function WorkspaceOperationFeedback({ operation }: { operation: WorkspaceOperation }) {
  return <OperationFeedback operation={operation} />;
}
