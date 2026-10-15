"use client";
import { useConfirmedOperation, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { workspaceOperationBaseline } from "@/shared/infrastructure/operations";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

export function useMemberOperation() {
  return useConfirmedOperation({
    baseline: workspaceOperationBaseline,
    eager: true,
    optimistic: ["members.setActive"],
    success: (command, input) =>
      command === "members.create" ? "Membro adicionado"
        : command === "members.update" ? "Membro salvo"
          : command === "members.approve" ? "Acesso aprovado"
            : command === "members.setActive"
              ? (input as { active: boolean }).active ? "Membro reativado" : "Membro desativado"
              : null,
  });
}
export type MemberOperation = ConfirmedOperation;
export function MemberOperationFeedback({ operation }: { operation: MemberOperation }) {
  return <OperationFeedback operation={operation} />;
}
