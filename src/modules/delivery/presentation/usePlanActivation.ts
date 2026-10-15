"use client";
import { useRef } from "react";
import { executeClientOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import type { Company } from "../../clients/domain/models";
import { useCatalog } from "../../catalog/presentation/catalog";
import { pinnedJourney } from "../../catalog/domain/publication";
import { validDate } from "../application/plan-execution";
import { useDeliveryState } from "../infrastructure/state";

export function usePlanActivation() {
  const attempt = useRef<OperationAttempt | null>(null);
  const { journeys, versionsOf } = useCatalog();
  const {
    assignCompanyJourney,
    initializePlan,
    companyJourney,
    companyJourneyVersion,
    pinCompanyJourneyVersion,
  } = useDeliveryState();
  const resolvePlan = (company: Company, id: string) => {
    const head = journeys.find((j) => j.id === id);
    const currentId = companyJourney[company.slug] ?? company.journeyId;
    return (
      head &&
      pinnedJourney(
        head,
        versionsOf(id),
        currentId === id ? companyJourneyVersion[company.slug] : undefined,
      )
    );
  };
  const validate = (company: Company, id: string) => {
    const plan = resolvePlan(company, id);
    return plan?.autoCreateCycles && !validDate(company.startedAt ?? "")
      ? "Informe a data de início do cliente em Cadastro antes de vincular este plano."
      : null;
  };
  const activate = async (company: Company, id: string, milestone = 1) => {
    const error = validate(company, id);
    if (error) throw new Error(error);
    const plan = resolvePlan(company, id);
    if (!plan) return;
    if (await usesRemoteOperations()) {
      const input = {client: {slug:company.slug}, journeyId:id, milestone};
      attempt.current = operationAttempt("clients.configure", input, attempt.current);
      await executeClientOperation("clients.configure", input, attempt.current);
      attempt.current = null;
      return;
    }
    const currentId = companyJourney[company.slug] ?? company.journeyId;
    const pin =
      currentId === id ? companyJourneyVersion[company.slug] : undefined;
    assignCompanyJourney(company.slug, id, milestone);
    if (pin !== undefined) pinCompanyJourneyVersion({ [company.slug]: pin });
    if (plan.autoCreateCycles) initializePlan(plan, company);
  };
  return { activate, validate };
}
