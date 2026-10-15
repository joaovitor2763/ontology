"use client";

import { OperationRefused } from "./operation-error.ts";
import { editorClearableTaskFields } from "../../modules/delivery/domain/task-overrides.ts";
import { dropWarmReads, getSyncStatus, patchSyncStatus, resolvePersistenceMode } from "./persistence.ts";
import { applyProvisionalNow, discardProvisionalNow, operationDocumentBaseline, withOperationDocuments, type OperationDocument } from "./useLocalStorageState.ts";

const CLIENT_OPERATION_DOCUMENTS = [
  "ontology.clients.v3",
  "ontology.catalog.v2",
  "ontology.delivery.v2",
  "ontology.stakeholders.v1",
  "ontology.workspace.v3",
] as const;
const DELIVERY_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.documents.v3"] as const;
const INTERACTION_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.relationship.v1", "ontology.documents.v3"] as const;
const KNOWLEDGE_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.knowledge.v2"] as const;
const DOCUMENT_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.engagement.v2", "ontology.relationship.v1", "ontology.documents.v3"] as const;
const SIGNAL_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.engagement.v2", "ontology.relationship.v1"] as const;
const DIAGNOSIS_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.engagement.v2"] as const;
const MEETING_OPERATION_DOCUMENTS = [...CLIENT_OPERATION_DOCUMENTS, "ontology.engagement.v2", "ontology.documents.v3"] as const;
const ACTIVE_SLICE_COMMANDS = new Set([
  'enrollments.provision', 'plans.provision', 'product-rollouts.apply',
  'meetings.actions.createTask', 'signals.createTask',
]);

/** Os documentos que um comando pode escrever, deduzidos do seu nome. */
export function operationDocuments(command: string): readonly string[] {
  if(command==='alerts.acknowledge'||command==='alerts.acknowledgeBatch'||command==='workspace.settings.update'||command.startsWith('members.')) return ['ontology.workspace.v3'];
  if(command.startsWith('allocations.')||command.startsWith('participants.')||['clients.setResponsible','clients.archive','clients.restore','enrollments.update','enrollments.archive','enrollments.restore'].includes(command)) return ['ontology.clients.v3'];
  if(command.startsWith('stakeholders.')) return ['ontology.stakeholders.v1'];
  if(command.startsWith('knowledge.')) return ['ontology.knowledge.v2'];
  if(command.startsWith('documents.')) return ['ontology.documents.v3'];
  if(command.startsWith('interactions.')||command.startsWith('inbox.')) return ['ontology.relationship.v1','ontology.documents.v3'];
  if(command==='signals.createTask') return ['ontology.relationship.v1','ontology.delivery.v2'];
  if(command.startsWith('signals.')) return ['ontology.relationship.v1'];
  if(command.startsWith('program-events.')||/^(pains|solutions|hypotheses)\./.test(command)||command==='meetings.capture'||command==='meetings.content.update'||['meetings.remove','meetings.restore','meetings.actions.remove','meetings.actions.restore','meetings.syncResponses'].includes(command)) return ['ontology.engagement.v2'];
  if(command==='meetings.syncArtifacts') return ['ontology.engagement.v2','ontology.documents.v3'];
  if(command==='meetings.actions.createTask') return ['ontology.engagement.v2','ontology.delivery.v2'];
  if(command.startsWith('meetings.')) return ['ontology.engagement.v2'];
  if(['products.save','plans.save','plans.remove','plans.publish'].includes(command)) return ['ontology.catalog.v2'];
  if(command==='product-rollouts.apply'||command==='plans.schedule'||command.startsWith('cycles.')||command.startsWith('tasks.')||command==='enrollments.provision'||command==='plans.provision') return ['ontology.delivery.v2'];
  if(command==='plans.advance') return ['ontology.clients.v3','ontology.delivery.v2'];
  if(['enrollments.create','enrollments.remove','enrollments.rebuild'].includes(command)) return ['ontology.clients.v3','ontology.delivery.v2'];
  if(command==='sales.register'||command==='clients.create'||command==='clients.configure') return ['ontology.clients.v3','ontology.delivery.v2','ontology.stakeholders.v1'];
  return CLIENT_OPERATION_DOCUMENTS;
}

/**
 * Mostra agora o que a pessoa acabou de fazer, dentro do próprio evento: sem
 * `await` antes, a troca de coluna entra na mesma renderização do indicador de
 * confirmação. Devolve `false` quando alguma espera pendente exige a ordem
 * antiga — aí o provisório é aplicado dentro da fila, como sempre foi.
 */
export function showProvisionalNow(command: string, local: () => void): boolean {
  return applyProvisionalNow(operationDocuments(command), local);
}

/** Desfaz `showProvisionalNow` quando o comando não chegou a sair. */
export function discardProvisional(command: string) {
  discardProvisionalNow(operationDocuments(command));
}

export type OperationAttempt = { fingerprint: string; key: string; expectedVersions?: Record<string, number> };
export type OperationResult<T = unknown> = { data: T; documents: OperationDocument[] };

export function workspaceOperationBaseline() {
  return operationDocumentBaseline(CLIENT_OPERATION_DOCUMENTS);
}
export function clientOperationBaseline() {
  return operationDocumentBaseline(CLIENT_OPERATION_DOCUMENTS);
}
export function deliveryOperationBaseline() {
  return operationDocumentBaseline(DELIVERY_OPERATION_DOCUMENTS);
}
export function interactionOperationBaseline() {
  return operationDocumentBaseline(INTERACTION_OPERATION_DOCUMENTS);
}
export function knowledgeOperationBaseline() {
  return operationDocumentBaseline(KNOWLEDGE_OPERATION_DOCUMENTS);
}
export function documentOperationBaseline() {
  return operationDocumentBaseline(DOCUMENT_OPERATION_DOCUMENTS);
}
export function signalOperationBaseline() {
  return operationDocumentBaseline(SIGNAL_OPERATION_DOCUMENTS);
}
export function diagnosisOperationBaseline() {
  return operationDocumentBaseline(DIAGNOSIS_OPERATION_DOCUMENTS);
}
export function meetingOperationBaseline() {
  return operationDocumentBaseline(MEETING_OPERATION_DOCUMENTS);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Keep this object in a form ref: an uncertain retry must reuse its key. */
export function operationAttempt(command: string, input: unknown, previous?: OperationAttempt | null): OperationAttempt {
  const fingerprint = canonical({ command, input });
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID() };
}

/** Resolve the mode before choosing a local writer; a health failure is never local. */
export async function usesRemoteOperations(): Promise<boolean> {
  const mode = await resolvePersistenceMode();
  if (mode === "local") return false;
  const status = getSyncStatus();
  if (!status.user || status.user.approved === false)
    throw new OperationRefused(status.error || "Entre com uma pessoa aprovada para salvar as alterações.");
  return true;
}

export async function executeClientOperation<T = unknown>(
  command: "alerts.acknowledge" | "alerts.acknowledgeBatch" | "workspace.settings.update" | "enrollments.update" | "plans.advance" | "members.create" | "members.update" | "members.setActive" | "members.approve" | "allocations.save" | "allocations.remove" | "clients.setResponsible" | "clients.archive" | "clients.restore" | "knowledge.domains.save" | "knowledge.graph.upsert" | "knowledge.elements.save" | "knowledge.elements.remove" | "knowledge.connections.save" | "knowledge.connections.remove" | "knowledge.layout.update" | "knowledge.layout.reset" | "knowledge.history.restore" | "documents.register" | "documents.version" | "documents.update" | "documents.review" | "documents.remove" | "documents.restore" | "inbox.notes.create" | "inbox.notes.update" | "inbox.thread.update" | "signals.resolve" | "signals.reopen" | "signals.createTask" | "program-events.create" | "program-events.update" | "program-events.remove" | "program-events.restore" | "pains.update" | "solutions.update" | "hypotheses.create" | "hypotheses.update" | "hypotheses.evidence.add" | "hypotheses.refine" | "hypotheses.remove" | "hypotheses.restore" | "meetings.capture" | "meetings.content.update" | "interactions.create" | "interactions.update" | "meetings.remove" | "meetings.restore" | "meetings.actions.remove" | "meetings.actions.restore" | "meetings.syncArtifacts" | "meetings.syncResponses" | "meetings.actions.createTask" | "enrollments.provision" | "plans.provision" | "products.save" | "plans.save" | "plans.remove" | "plans.publish" | "product-rollouts.apply" | "plans.schedule" | "cycles.remove" | "tasks.create" | "tasks.remove" | "tasks.update" | "tasks.complete" | "tasks.comment" | "tasks.checklist" | "tasks.blocker" | "cycles.save" | "stakeholders.save" | "stakeholders.remove" | "clients.create" | "clients.configure" | "enrollments.create" | "participants.save" | "meetings.create" | "meetings.update" | "meetings.reschedule" | "meetings.cancel" | "enrollments.archive" | "enrollments.restore" | "enrollments.remove" | "enrollments.rebuild",
  input: unknown,
  attempt: OperationAttempt,
  baseline?: Record<string, string>,
  optimistic?: () => void,
  /** O provisório já está na tela: a fila não o aplica de novo. */
  preApplied?: boolean,
): Promise<OperationResult<T>> {
  if (!(await usesRemoteOperations())) throw new OperationRefused("Esta operação requer conexão com o servidor.");
  if (attempt.fingerprint !== canonical({ command, input }))
    throw new OperationRefused("A intenção mudou. Prepare uma nova operação antes de enviar.");
  const activeSlice = ACTIVE_SLICE_COMMANDS.has(command);
  const result = await withOperationDocuments(operationDocuments(command), async (expectedVersions) => {
    // Freeze the preconditions together with the intent for retries after a lost response.
    attempt.expectedVersions ??= expectedVersions;
    const response = await fetch("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": attempt.key },
      body: JSON.stringify({ command, input, expectedVersions: attempt.expectedVersions }),
    });
    if (response.status === 401 && getSyncStatus().authMode === "google")
      patchSyncStatus({ user: null });
    const raw: unknown = await response.json().catch(() => null);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!response.ok) {
      const error = body?.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
      const message = typeof body?.message === "string" ? body.message
        : typeof body?.error === "string" ? body.error
          : typeof error?.message === "string" ? error.message
            : `Não foi possível salvar (${response.status}). Tente novamente.`;
      // Um 5xx pode chegar depois da gravação. Verificar com a mesma chave
      // recupera o recibo sem repetir a operação.
      if (response.status >= 500) throw new Error(message);
      // Um 409 garante que nada foi gravado. As versões congeladas não servem
      // mais: a próxima tentativa lê as atuais em vez de repetir o conflito.
      // Recibo inconsistente também é 409, mas pode ter gravado: fica incerto,
      // para verificar com a mesma chave. Chave reutilizada é recusa comum.
      const code = typeof error?.code === "string" ? error.code : "";
      if (code.startsWith("receipt_")) throw new Error(message);
      if (code === "idempotency_conflict") throw new OperationRefused(message);
      if (response.status === 409) {
        attempt.expectedVersions = undefined;
        throw new OperationRefused(message, { conflict: true });
      }
      throw new OperationRefused(message);
    }
    if (!body || !Array.isArray(body.documents))
      throw new Error("Não foi possível confirmar a gravação. Tente novamente para verificar o resultado.");
    return body as OperationResult<T>;
  }, attempt.expectedVersions ? undefined : activeSlice
    ? Object.fromEntries(Object.entries(baseline ?? {}).filter(([key]) => key !== 'ontology.delivery.v2'))
    : baseline, optimistic, preApplied,
  activeSlice ? ['ontology.delivery.v2'] : [],
  operationDocuments(command).includes('ontology.delivery.v2'));
  // Leituras adiantadas durante o comando (gesto de navegação) já estão velhas.
  dropWarmReads();
  if (operationDocuments(command).includes("ontology.delivery.v2") &&
      typeof window.dispatchEvent === "function")
    window.dispatchEvent(new Event('ontology:execution-committed'));
  return result;
}

export const executeOperation = executeClientOperation;

/** A task draft never carries IDs, audit history or compound state to a command. */
export function deliveryOperationPatch(value: Record<string, unknown>, previous?: Record<string, unknown>): Record<string, unknown> {
  const fields = ["title", "description", "status", "ownerId", "startsAt", "dueAt", "hours", "effortActual", "workstream", "milestone", "completion", "deliverable", "kind", "journeyId", "productId", "enrollmentId", "origin", "requestedBy", "priority", "responsibleRole", "party", "assignmentSource", "requiresEvidence", "approvalRequired", "deliverableTemplateId", "evidence", "deadline", "relatedNodeIds"];
  const patch = Object.fromEntries(fields.filter(field => value[field] !== undefined).map(field => [field, value[field]]));
  if (previous) for (const field of editorClearableTaskFields)
    if (previous[field] !== undefined && value[field] === undefined) patch[field] = null;
  return patch;
}
