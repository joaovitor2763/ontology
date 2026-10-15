"use client";
import type { Delivery } from "@/modules/delivery/domain/models";
import { evidenceLabel } from "@/modules/delivery/domain/evidence";
import {
  useEvidence,
  type EvidenceEvaluation,
} from "@/modules/delivery/presentation/useEvidence";
import { Badge } from "@/shared/ui/primitives";

/** Pure badge for a precomputed evaluation; `compact` shows only what deserves a glance. */
export function EvidenceTag({
  evaluation,
  compact = false,
}: {
  evaluation: EvidenceEvaluation;
  compact?: boolean;
}) {
  const { result, awaitingApproval } = evaluation;
  if (awaitingApproval)
    return (
      <Badge tone="warn">
        <span title="Concluída; aguarda documento aprovado na revisão.">
          Aguardando aprovação
        </span>
      </Badge>
    );
  if (compact && (result.status === "pendente" || result.status === "validada"))
    return null;
  const tone =
    result.status === "validada" || result.status === "evidencia_disponivel"
      ? "ok"
      : result.status === "revisao_necessaria"
        ? "warn"
        : "neutral";
  return (
    <Badge tone={tone}>
      <span title={`${result.reason} ${result.recommendedAction}`}>
        {evidenceLabel[result.status]}
      </span>
    </Badge>
  );
}

/** What the system already knows about the evidence of one delivery. */
export function EvidenceBadge({
  task,
  compact = false,
}: {
  task: Delivery;
  compact?: boolean;
}) {
  const evaluation = useEvidence(task);
  return <EvidenceTag evaluation={evaluation} compact={compact} />;
}
