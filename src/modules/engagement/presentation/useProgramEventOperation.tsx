"use client";
import { useConfirmedOperation, type ConfirmedCommand, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { meetingOperationBaseline } from "@/shared/infrastructure/operations";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";

/**
 * Remover e restaurar um evento aplica na hora: o id já existe, o gesto não
 * chama a agenda do Google e a falha devolve o evento à lista. Criar e editar
 * continuam esperando a confirmação.
 */
export function useProgramEventOperation() {
  const { can } = usePermissions();
  const { restoreEvent } = useEngagementState();
  const operation = useConfirmedOperation({
    baseline: meetingOperationBaseline,
    optimistic: ["program-events.remove", "program-events.restore"],
    guard: (command: ConfirmedCommand, input: unknown) => {
      const company = (input as { company: string }).company;
      if (!can("reunioes.agendar", company)) return "Você não tem permissão para alterar este evento.";
      return null;
    },
    success: (command, input) => {
      const { company, eventId } = input as { company: string; eventId?: string };
      if (command === "program-events.remove" && eventId)
        return {
          message: "Evento excluído",
          undo: () => void operation.run("program-events.restore", { company, eventId }, () => restoreEvent(eventId)),
        };
      if (command === "program-events.restore") return "Evento restaurado";
      if (command === "program-events.create") return "Evento agendado";
      if (command === "program-events.update") return "Evento salvo";
      return null;
    },
  });
  return operation;
}
export type ProgramEventOperation = ConfirmedOperation;
export function ProgramEventOperationFeedback({ operation }: { operation: ProgramEventOperation }) {
  return <OperationFeedback operation={operation} />;
}
