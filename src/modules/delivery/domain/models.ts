export type DeliveryStatus =
  "fila" | "em-curso" | "revisao" | "entregue" | "bloqueado";

export type DeliveryComment = {
  id: string;
  at: string;
  by: string;
  text: string;
};

export type DeliveryHistoryEntry = {
  at: string;
  by: string;
  field: "status" | "ownerId" | "dueAt" | "priority" | "blocker" | "comment" | "resumo";
  from?: string;
  to?: string;
  /** Só em `resumo`: quantas alterações antigas essa única linha condensa. */
  count?: number;
};

/** Structured blocker; `blockers` (text) stays derived from it for legacy filters. */
export type DeliveryBlocker = {
  reason: string;
  ownerId?: string;
  since: string;
  resolvedAt?: string;
};

/** Who answers for the work: our team, the client, or a third party. */
export type ResponsibleParty = "equipe" | "cliente" | "terceiro";

export const responsiblePartyLabel: Record<ResponsibleParty, string> = {
  equipe: "Equipe",
  cliente: "Cliente",
  terceiro: "Terceiro",
};

/** How the owner was set: inherited from the role on the client, chosen by hand, or coming from outside. */
export type AssignmentSource = "papel" | "manual" | "externo";

export type ChecklistItem = {
  id: string;
  title: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
};

export type Delivery = {
  /** Independent purchase; absent on historical execution until safely associated. */
  enrollmentId?: string;
  deadline?: import("../../catalog/domain/task-deadlines").TaskDeadline;
  productId?: string;
  cycleTemplateId?: string;
  baseDeliveryId?: string;
  id: string;
  company: string;
  title: string;
  description: string;
  status: DeliveryStatus;
  ownerId: string;
  startsAt?: string;
  dueAt: string;
  hours: number;
  effortActual?: number;
  workstream: string;
  milestone: number;
  completion: "checklist" | "deliverable";
  deliverable?: string;
  kind?: "journey" | "request";
  journeyId?: string;
  blockers?: string;
  blocker?: DeliveryBlocker;
  relatedNodeIds?: string[];
  origin?: "whatsapp" | "reuniao" | "email" | "ligacao" | "outro";
  requestedBy?: string;
  priority?: "baixa" | "media" | "alta" | "critica";
  comments?: DeliveryComment[];
  history?: DeliveryHistoryEntry[];
  /** Structured responsibility (Fase 7). `ownerId` stays the person of record. */
  responsibleRole?: string;
  party?: ResponsibleParty;
  assignmentSource?: AssignmentSource;
  /** Completion policy copied from the reference task. */
  checklist?: ChecklistItem[];
  requiresEvidence?: boolean;
  approvalRequired?: boolean;
  /** Reference to the deliverable template that shapes the evidence. */
  deliverableTemplateId?: string;
  /** Free-text evidence note registered on completion. */
  evidence?: string;
  /** Effective business date; the audit timestamp remains the platform record time. */
  completedAt?: string;
};
