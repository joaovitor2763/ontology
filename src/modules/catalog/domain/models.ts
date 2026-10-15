/**
 * Declarative due date for a reference task: none, an offset from a base date,
 * or an offset after another reference task of the same milestone.
 */
export type TaskSchedule =
  | { mode: "none" }
  | { mode: "date"; base: "inicio" | "venda"; offsetDays: number }
  | { mode: "task"; predecessorId: string; offsetDays: number };

/** A delivery suggested by a milestone; copied into a cycle when the cycle is linked to it. */
export type ReferenceTask = {
  id: string;
  title: string;
  description: string;
  hours: number;
  completion: "checklist" | "deliverable";
  /** Role that answers for the task by default (e.g. "Responsável", "CS", "Consultor"). */
  ownerRole?: string;
  party?: "equipe" | "cliente" | "terceiro";
  checklistItems?: string[];
  requiresEvidence?: boolean;
  approvalRequired?: boolean;
  deliverableTemplateId?: string;
  schedule?: TaskSchedule;
  legacyBaseDeliveryIds?: string[];
  /** Calendar months counted from the client start (1-based). */
  period?: { startMonth: number; endMonth: number };
};

/**
 * Milestone of a plan. It is the macro step of the contract; cycles execute it.
 * The detailed fields are optional so legacy plans keep working.
 */
export type JourneyMilestone = {
  n: number;
  period?: { startMonth: number; endMonth: number };
  cycleTemplateId?: string;
  stage: string;
  name: string;
  owner: string;
  goal?: string;
  durationWeeks?: number;
  exitCriteria?: string[];
  tasks?: ReferenceTask[];
};

export type JourneyTemplate = {
  id: string;
  name: string;
  description: string;
  milestones: JourneyMilestone[];
  /** Materialize the entire dated program when assigned to a client. */
  autoCreateCycles?: boolean;
  productId?: string;
  /** Last published version of this plan; absent while it was never published. */
  version?: number;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Last edit of the draft; compared with `publishedAt` to flag pending changes. */
  draftUpdatedAt?: string;
};

export const partyOfRole = (
  role: string | undefined,
): "equipe" | "cliente" | "terceiro" =>
  role === "Cliente" ? "cliente" : role === "Terceiro" ? "terceiro" : "equipe";

/** Roles offered for reference tasks. Free text is still accepted. */
export const referenceOwnerRoles = [
  "Responsável",
  "CS",
  "Consultor",
  "Analista",
  "Operações",
  "Cliente",
  "Terceiro",
] as const;

export function milestoneError(milestone: JourneyMilestone): string | null {
  if (!milestone.name.trim()) return "Dê um nome ao marco.";
  if (
    milestone.durationWeeks != null &&
    (!Number.isInteger(milestone.durationWeeks) ||
      milestone.durationWeeks < 1 ||
      milestone.durationWeeks > 52)
  )
    return "A duração do marco deve ser de 1 a 52 semanas.";
  if (
    (milestone.tasks ?? []).some(
      (t) => !t.title.trim() || !Number.isFinite(t.hours) || t.hours < 0,
    )
  )
    return "Revise o título e o esforço das tarefas de referência.";
  if (
    new Set((milestone.tasks ?? []).map((t) => t.id)).size !==
    (milestone.tasks ?? []).length
  )
    return "As tarefas de referência precisam ter identificadores únicos.";
  return null;
}

export function journeyError(journey: JourneyTemplate): string | null {
  if (!journey.name.trim()) return "Dê um nome ao plano.";
  if (!journey.milestones.length) return "Inclua pelo menos um marco.";
  for (const milestone of journey.milestones) {
    const problem = milestoneError(milestone);
    if (problem)
      return `${milestone.name || `Marco ${milestone.n}`}: ${problem}`;
  }
  return null;
}
