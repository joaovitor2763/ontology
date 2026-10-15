"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import {
  awaitingApproval,
  inferEvidence,
  type EvidenceResult,
} from "@/modules/delivery/domain/evidence";
import { useServices } from "@/modules/delivery/presentation/state";
import type { ClientDocument } from "@/modules/documents/domain/models";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useLiveThreads } from "@/modules/engagement/infrastructure/relationship-state";

export type EvidenceEvaluation = {
  result: EvidenceResult;
  documents: ClientDocument[];
  awaitingApproval: boolean;
};

/**
 * Reads the workspace once and returns a function that judges any delivery.
 * Boards and lists call it per row without subscribing per card.
 */
export function useEvidenceEvaluator(): (task: Delivery) => EvidenceEvaluation {
  const { cycles } = useServices();
  return useEvidenceEvaluatorForCycles(cycles);
}

/** Remote boards pass their scoped cycle projection without subscribing to global execution. */
export function useEvidenceEvaluatorForCycles(cycles: readonly {
  company: string; taskIds: readonly string[];
  acceptance: readonly { done: boolean; approvedBy?: string }[];
}[]): (task: Delivery) => EvidenceEvaluation {
  const { clientBySlug, assigned } = useClientsState();
  const { extraDocs, removedDocs, docEdits } = useDocumentsState();
  const { allMeetings } = useEngagementState();
  const threads = useLiveThreads();
  const allDocs = documentsFor(undefined, extraDocs, removedDocs, docEdits);
  return (task: Delivery) => {
    const client = clientBySlug(task.company);
    const clientDocs = allDocs.filter((d) => d.company === task.company);
    const documents = clientDocs.filter((d) => d.relatedTaskId === task.id);
    const cycle = cycles.find(
      (c) => c.company === task.company && c.taskIds.includes(task.id),
    );
    const result = inferEvidence(task, {
      leadId: client ? assigned(client).leadId : undefined,
      hasThread: threads.some((t) => t.company === task.company),
      documents: clientDocs.map((d) => ({
        kind: d.kind,
        relatedTaskId: d.relatedTaskId === task.id ? d.relatedTaskId : undefined,
        reviewStatus: d.reviewStatus,
      })),
      meetings: allMeetings
        .filter((m) => m.company === task.company)
        .map((m) => m.startsAt),
      cycleAcceptance: cycle
        ? {
            total: cycle.acceptance.length,
            approved: cycle.acceptance.filter((a) => a.done && a.approvedBy)
              .length,
          }
        : undefined,
    });
    return { result, documents, awaitingApproval: awaitingApproval(task, documents) };
  };
}

/** Evidence the system already holds for one delivery, plus its linked documents. */
export function useEvidence(task: Delivery): EvidenceEvaluation {
  return useEvidenceEvaluator()(task);
}
