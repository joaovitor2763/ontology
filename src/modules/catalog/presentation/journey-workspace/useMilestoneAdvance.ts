"use client";
import { useRef, useState } from "react";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import type { Company } from "@/modules/clients/domain/models";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  clientOperationBaseline,
  executeOperation,
  operationAttempt,
  usesRemoteOperations,
} from "@/shared/infrastructure/operations";
import type { milestoneAdvance } from "@/modules/catalog/domain/journey-progress";

type Advance = ReturnType<typeof milestoneAdvance>;

/** Moving the client to the next milestone, with the confirmation it waits for. */
export function useMilestoneAdvance({
  company,
  journey,
  enrollmentId,
  currentMilestone,
  advanceEnabled,
  advance,
  onAdvanced,
}: {
  company: Company;
  journey: JourneyTemplate;
  enrollmentId: string | null;
  currentMilestone: number;
  advanceEnabled: boolean;
  advance: Advance;
  onAdvanced: (next: number) => void;
}) {
  const { can } = usePermissions();
  const { me } = useTeam();
  const { enrollments, saveEnrollment } = useClientsState();
  const delivery = useDeliveryState();
  const [advancing, setAdvancing] = useState(false);
  const [advanceUncertain, setAdvanceUncertain] = useState(false);
  const [advanceError, setAdvanceError] = useState("");
  const advanceLock = useRef(false);
  const advancePending = useRef<null | (() => Promise<void>)>(null);

  async function advanceMilestone(force: boolean, justification: string) {
    const canForce = justification.trim().length >= 10;
    if (
      !advanceEnabled ||
      advanceLock.current ||
      !can("plano.editar", company.slug)
    )
      return;
    if (
      !advancePending.current &&
      (!advance.next || (!advance.ready && !canForce))
    )
      return;
    advanceLock.current = true;
    setAdvancing(true);
    setAdvanceError("");
    try {
      if (!advancePending.current) {
        const next = advance.next!.n;
        const input = {
          company: company.slug,
          planId: journey.id,
          enrollmentId,
          currentMilestone,
          justification: force ? justification.trim() : "",
        };
        const attempt = operationAttempt("plans.advance", input),
          baseline = clientOperationBaseline();
        setAdvanceUncertain(true);
        advancePending.current = async () => {
          if (await usesRemoteOperations())
            await executeOperation("plans.advance", input, attempt, baseline);
          else if (enrollmentId) {
            const enrollment = enrollments.find((e) => e.id === enrollmentId);
            if (!enrollment) throw new Error("Contratação não encontrada.");
            saveEnrollment({
              ...enrollment,
              milestone: next,
              milestoneHistory: [
                ...(enrollment.milestoneHistory ?? []),
                {
                  from: currentMilestone,
                  to: next,
                  by: me.id,
                  at: new Date().toISOString(),
                  justification: input.justification,
                  pendingTaskIds: advance.pending.map((t) => t.id),
                },
              ],
            });
          } else
            delivery.assignCompanyJourney(company.slug, journey.id, next);
          onAdvanced(next);
        };
      }
      await advancePending.current();
      advancePending.current = null;
      setAdvanceUncertain(false);
    } catch (error) {
      setAdvanceError(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar o avanço.",
      );
    } finally {
      advanceLock.current = false;
      setAdvancing(false);
    }
  }

  return {
    advancing,
    advanceUncertain,
    advanceError,
    advanceMilestone,
    reviewAdvance: () => {
      advancePending.current = null;
      setAdvanceUncertain(false);
      setAdvanceError("");
    },
  };
}
