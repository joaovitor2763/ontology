import type { ProductEnrollment } from "./product-enrollments.ts";
import { influenceLevels, stakeholderRoles, stakeholderStances, type Stakeholder, type StakeholderStance, type InfluenceLevel } from "./stakeholders.ts";

/** Participation carries local relationship details; the contact remains owned by the client. */
export type ProductStakeholderParticipation = {
  id: string;
  company: string;
  enrollmentId: string;
  stakeholderId: string;
  accountRole: Stakeholder["accountRole"];
  primary: boolean;
  active: boolean;
  stance?: StakeholderStance;
  influence?: InfluenceLevel;
  notes?: string;
};

export function participationError(
  next: ProductStakeholderParticipation,
  enrollments: ProductEnrollment[],
  contacts: Stakeholder[],
  all: ProductStakeholderParticipation[] = [],
): string | null {
  if (!next.id.trim()) return "Informe a identidade da participação.";
  const enrollment = enrollments.find(row => row.id === next.enrollmentId);
  if (!enrollment || enrollment.company !== next.company)
    return "A contratação precisa pertencer ao cliente informado.";
  const contact = contacts.find(row => row.id === next.stakeholderId && row.company === next.company);
  if (!contact) return "O stakeholder precisa pertencer ao mesmo cliente da contratação.";
  if (next.active && !contact.active) return "Reative o stakeholder antes de vinculá-lo ao produto.";
  if (!Object.hasOwn(stakeholderRoles, next.accountRole) ||
      (next.stance !== undefined && !Object.hasOwn(stakeholderStances, next.stance)) ||
      (next.influence !== undefined && !Object.hasOwn(influenceLevels, next.influence)))
    return "Revise o papel, a postura e a influência da participação.";
  const old = all.find(row => row.id === next.id);
  if (old && (old.company !== next.company || old.enrollmentId !== next.enrollmentId || old.stakeholderId !== next.stakeholderId))
    return "Uma participação existente não pode ser transferida para outra pessoa ou contratação.";
  if (all.some(row => row.id !== next.id && row.enrollmentId === next.enrollmentId && row.stakeholderId === next.stakeholderId))
    return "Este stakeholder já participa desta contratação.";
  return null;
}

export function upsertParticipation(
  all: ProductStakeholderParticipation[], next: ProductStakeholderParticipation,
  enrollments: ProductEnrollment[], contacts: Stakeholder[],
): ProductStakeholderParticipation[] {
  const error = participationError(next, enrollments, contacts, all);
  if (error) throw new Error(error);
  const saved = { ...next, primary: next.active && next.primary };
  return [...all.filter(row => row.id !== saved.id).map(row =>
    saved.primary && row.enrollmentId === saved.enrollmentId ? { ...row, primary: false } : row), saved];
}

/** Global inactivation takes effect in all views without erasing historical links. */
export function participantsFor(enrollmentId: string, all: ProductStakeholderParticipation[], contacts: Stakeholder[]) {
  return all.filter(row => row.enrollmentId === enrollmentId).flatMap(participation => {
    const stakeholder = contacts.find(row => row.id === participation.stakeholderId && row.company === participation.company);
    return stakeholder ? [{ participation, stakeholder, active: participation.active && stakeholder.active }] : [];
  });
}
