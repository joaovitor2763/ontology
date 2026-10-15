"use client";
import { deliveryOperationBaseline } from "@/shared/infrastructure/operations";
import { useConfirmedOperation, type ConfirmedCommand, type ConfirmedOperation } from "@/shared/infrastructure/useConfirmedOperation";
import { OperationFeedback } from "@/shared/ui/OperationFeedback";
import {
  archiveEnrollment,
  changeEnrollmentStatus,
  restoreEnrollment,
  type ProductEnrollment,
} from "../domain/product-enrollments";
import type { Company } from "../domain/models";
import { useClientsState } from "../infrastructure/state";
import { usePermissions } from "../../workspace/presentation/usePermissions";

export type EnrollmentLifecycleAction =
  | "cancel"
  | "archive"
  | "restore"
  | "remove"
  | "rebuild";

export function useEnrollmentLifecycle(company: Company) {
  const clients = useClientsState();
  const { me } = usePermissions();
  const operation = useConfirmedOperation({
    // Inclui ontology.clients.v3 para recusar status/arquivo concorrente e
    // delivery para a reconstrução atômica da execução.
    baseline: deliveryOperationBaseline,
    fallback: "Não foi possível alterar esta contratação.",
    success: (command) => {
      if (command === "enrollments.update") return "Produto cancelado; histórico preservado";
      if (command === "enrollments.archive") return "Contratação arquivada";
      if (command === "enrollments.restore") return "Contratação restaurada";
      if (command === "enrollments.remove") return "Contratação excluída";
      if (command === "enrollments.rebuild") return "Execução recriada pela versão contratada";
      return undefined;
    },
  });

  function local(action: EnrollmentLifecycleAction, enrollment: ProductEnrollment, reason?: string) {
    const at = new Date().toISOString();
    if (action === "cancel") {
      clients.saveEnrollment(changeEnrollmentStatus(enrollment, "cancelada", me.id, at, reason));
      return;
    }
    if (action === "archive") {
      clients.saveEnrollment(archiveEnrollment(enrollment, me.id, at));
      return;
    }
    if (action === "restore") {
      clients.saveEnrollment(restoreEnrollment(enrollment, me.id, at));
      return;
    }
    throw new Error("Excluir ou recriar uma contratação exige o ambiente com banco de dados, que confirma os documentos de forma atômica.");
  }

  function run(action: EnrollmentLifecycleAction, enrollment: ProductEnrollment, reason?: string, confirmed?: () => void) {
    const command: ConfirmedCommand = action === "cancel" ? "enrollments.update" : `enrollments.${action}`;
    const input = action === "cancel"
      ? { company: company.slug, enrollmentId: enrollment.id, status: "cancelada", reason: reason?.trim() }
      : { company: company.slug, enrollmentId: enrollment.id };
    return operation.run(command, input, () => local(action, enrollment, reason), confirmed);
  }
  return { ...operation, run };
}

export function EnrollmentLifecycleFeedback({ operation }: { operation: Pick<ConfirmedOperation, "busy" | "error" | "uncertain" | "retry" | "reset"> }) {
  return <OperationFeedback operation={operation} />;
}
