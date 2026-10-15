"use client";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { clientOperationBaseline } from "@/shared/infrastructure/operations";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

export function useAllocationOperation() {
  return useConfirmedOperation({
    baseline: clientOperationBaseline,
    eager: true,
    optimistic: ["allocations.remove"],
    success: (command) =>
      command === "clients.setResponsible" ? "Responsável atualizado"
        : command === "allocations.save" ? "Alocação salva"
        : command === "allocations.remove" ? "Alocação removida"
          : null,
  });
}
export type AllocationOperation = ConfirmedOperation;
export function AllocationOperationFeedback({ operation }: { operation: AllocationOperation }) {
  return <OperationFeedback operation={operation} />;
}
