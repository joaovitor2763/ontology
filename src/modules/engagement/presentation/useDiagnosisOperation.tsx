"use client";
import { useConfirmedOperation, type ConfirmedCommand, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { diagnosisOperationBaseline } from "@/shared/infrastructure/operations";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Remover e restaurar uma hipótese aplica na hora; registrar, refinar e editar
 * saem de formulário com baseline congelado e esperam a confirmação.
 */
export function useDiagnosisOperation() {
  const { can } = usePermissions();
  const { restoreHypothesis } = useEngagementState();
  const operation = useConfirmedOperation({
    baseline: diagnosisOperationBaseline,
    optimistic: ["hypotheses.remove", "hypotheses.restore"],
    guard: (command: ConfirmedCommand, input: unknown) => {
      const company = (input as { company: string }).company;
      if (!can("interacoes.registrar", company)) return "Você não tem permissão para alterar este diagnóstico.";
      return null;
    },
    success: (command, input) => {
      const { company, hypothesisId } = input as { company: string; hypothesisId?: string };
      if (command === "hypotheses.remove" && hypothesisId)
        return {
          message: "Hipótese removida",
          undo: () =>
            void operation.run("hypotheses.restore", { company, hypothesisId }, () => restoreHypothesis(hypothesisId)),
        };
      if (command === "hypotheses.restore") return "Hipótese restaurada";
      if (command === "hypotheses.create") return "Hipótese registrada";
      if (command === "hypotheses.refine") return "Hipótese refinada";
      if (command === "hypotheses.evidence.add") return "Evidência registrada";
      return null;
    },
  });
  return operation;
}
export type DiagnosisOperation = ConfirmedOperation;
export function DiagnosisOperationFeedback({ operation }: { operation: DiagnosisOperation }) {
  return <OperationFeedback operation={operation} />;
}
