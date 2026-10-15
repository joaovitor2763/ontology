import { companies } from "../../clients/infrastructure/seed.ts";
import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import { deliveries } from "../../delivery/infrastructure/seed.ts";
import { foundingMilestones } from "./founding-journey.ts";

/**
 * Reference deliveries of the "Programa de IA" plan, projected onto a client
 * from the milestone reference tasks. Ids follow `pb-<slug>-m<n>-<index>` so
 * status and edits stored for them keep working.
 */
function ownerId(slug: string, role: string | undefined) {
  const c = companies.find((x) => x.slug === slug);
  if (!c) return "marina";
  if (role === "CS") return c.csId;
  if (role === "Operações") return "beatriz";
  return c.leadId;
}

function statusFor(current: number, n: number, index: number): DeliveryStatus {
  if (n < current) return "entregue";
  if (n > current) return "fila";
  if (index === 0) return "em-curso";
  if (index === 1) return "revisao";
  return "fila";
}

export function playbookDeliveries(
  slug: string,
  currentMilestone: number,
  journeyId?: string,
): Delivery[] {
  if (journeyId && journeyId !== "founding-companies") return [];
  const existing = new Set(
    deliveries
      .filter((d) => d.company === slug)
      .map((d) => `${d.milestone}::${d.title.toLowerCase()}`),
  );
  const rows: Delivery[] = [];
  for (const milestone of foundingMilestones) {
    const n = milestone.n;
    const covered = deliveries.filter(
      (d) => d.company === slug && d.milestone === n,
    ).length;
    if (n !== currentMilestone && covered >= 1) continue;
    (milestone.tasks ?? []).forEach((item, index) => {
      const sig = `${n}::${item.title.toLowerCase()}`;
      if (existing.has(sig)) return;
      rows.push({
        id: `pb-${slug}-m${n}-${index}`,
        company: slug,
        title: item.title,
        description:
          item.description ||
          `${item.title} · ${item.completion === "deliverable" ? "entregável formal" : "checklist operacional"}.`,
        status: statusFor(currentMilestone, n, index),
        ownerId: ownerId(slug, item.ownerRole),
        dueAt: n <= currentMilestone ? "2026-09-18" : "2026-10-15",
        hours: item.hours,
        workstream: milestone.stage,
        milestone: n,
        completion: item.completion,
        deliverable: item.deliverableTemplateId,
        deliverableTemplateId: item.deliverableTemplateId,
        responsibleRole: item.ownerRole,
        party: item.party,
        assignmentSource: "papel",
        requiresEvidence: item.requiresEvidence,
        approvalRequired: item.approvalRequired,
        checklist: item.checklistItems?.map((title, i) => ({
          id: `pb-${slug}-m${n}-${index}-c${i + 1}`,
          title,
          done: false,
        })),
        kind: "journey",
      });
    });
  }
  return rows;
}
