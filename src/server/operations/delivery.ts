import { removeDeliveryTask } from '../../modules/delivery/application/task-removal.ts';
import { editorClearableTaskFields, mergeTaskOverride } from "../../modules/delivery/domain/task-overrides.ts";
import type { ServerEnv } from "../context";
import { getDoc } from "../db.ts";
import { authorizeOperation, type OperationPrincipal } from "./principal.ts";
import { loadDocuments } from "./request-context.ts";
import { commitOperation, receipt, requestHash, type VersionGuard } from "./transaction.ts";
import { OperationError } from "./errors.ts";
import { object, string, id, strings, choice, boolean, number, invalid } from "./input.ts";
import { projectClients } from "../../modules/clients/infrastructure/snapshot.ts";
import { projectCatalog } from "../../modules/catalog/infrastructure/snapshot.ts";
import { projectStakeholders } from "../../modules/clients/infrastructure/stakeholders-snapshot.ts";
import { normalizeDeliverySnapshot, projectDelivery, type DeliverySnapshot } from "../../modules/delivery/infrastructure/snapshot.ts";
import { serviceCycles } from "../../modules/delivery/infrastructure/services.ts";
import { saveCycleAggregate } from "../../modules/delivery/application/cycles.ts";
import { scheduledExecution } from "../../modules/delivery/application/task-deadlines.ts";
import { validDate } from "../../modules/delivery/application/plan-execution.ts";
import { changedScheduleError, deliveryPatchError, directDueDatePatch, validTaskDate } from "../../modules/delivery/domain/delivery-policy.ts";
import { recordHistory, blockerPatch } from "../../modules/delivery/domain/history.ts";
import { applyStatusChange, debriefError, type ServiceCycle } from "../../modules/delivery/domain/services.ts";
import type { Delivery, ChecklistItem } from "../../modules/delivery/domain/models.ts";
import { people } from "../../modules/workspace/infrastructure/seed.ts";
import type { Person } from "../../modules/workspace/domain/models.ts";
import { documents as seedDocuments } from "../../modules/documents/infrastructure/seed.ts";
import { currentDocuments, type ClientDocument } from "../../modules/documents/domain/models.ts";
import { enrollmentCanReceiveWork } from "../../modules/clients/domain/product-enrollments.ts";
import { workspaceDate } from "../../shared/lib/format.ts";
import { tryActiveTaskComment } from './delivery-client-comment.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge, readActiveCompanySlice, readActiveTaskBatchSlice,
  readActiveCycleCompany, readActiveTaskSlice } from './delivery-client-task-write.ts';
import { partitionClientDelivery } from '../delivery-client-slices.ts';

export type DeliveryCommand = "cycles.save" | "cycles.remove" | "tasks.create" | "tasks.remove" | "tasks.update" | "tasks.complete" | "tasks.comment" | "tasks.checklist" | "tasks.blocker";
const KEY = "ontology.delivery.v2";
const statusValues = ["fila", "em-curso", "revisao", "entregue", "bloqueado"] as const;
function allowed(raw: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(raw).some(k => !fields.includes(k))) invalid("O pedido contém campos que não podem ser alterados por esta operação.");
}
function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 500) invalid(`Revise ${field}.`);
  return value;
}
function uniqueGuards(rows: VersionGuard[]) {
  const found = new Map<string, number>();
  for (const row of rows) {
    if (found.has(row.key) && found.get(row.key) !== row.version) throw new OperationError(409, "version_conflict", "Os dados mudaram durante a operação.");
    found.set(row.key, row.version);
  }
  return [...found].map(([key, version]) => ({ key, version }));
}
const taskFields = ["title", "description", "status", "ownerId", "startsAt", "dueAt", "hours", "effortActual", "workstream", "milestone", "completion", "deliverable", "kind", "journeyId", "productId", "enrollmentId", "origin", "requestedBy", "priority", "responsibleRole", "party", "assignmentSource", "requiresEvidence", "approvalRequired", "deliverableTemplateId", "evidence", "deadline", "relatedNodeIds"] as const;
function taskPatch(raw: Record<string, unknown>): Partial<Delivery> {
  allowed(raw, taskFields);
  const patch: Partial<Delivery> = {};
  for (const field of ["title", "description", "ownerId", "startsAt", "dueAt", "workstream", "deliverable", "journeyId", "productId", "enrollmentId", "requestedBy", "responsibleRole", "deliverableTemplateId", "evidence"] as const)
    if (raw[field] !== undefined) patch[field] = (field === "startsAt" || field === "deliverable") && raw[field] === null ? undefined : string(raw[field], field, undefined, field === "description" || field === "evidence" ? 50000 : 8000);
  for (const field of ["hours", "effortActual", "milestone"] as const)
    if (raw[field] !== undefined) patch[field] = field === "effortActual" && raw[field] === null ? undefined : number(raw[field], 0);
  // dueAt "" is a Backlog task (fila, no deadline); deliveryPatchError refuses it in any other status.
  for (const field of ["startsAt", "dueAt"] as const) if (patch[field] !== undefined && !(field === "dueAt" && patch[field] === "") && !validTaskDate(patch[field]!)) invalid("Informe datas válidas no formato AAAA-MM-DD, entre 2000 e 2100.");
  if (patch.milestone !== undefined && (!Number.isInteger(patch.milestone) || patch.milestone < 0)) invalid("Informe um marco válido.");
  if (raw.status !== undefined) patch.status = choice(raw.status, statusValues);
  if (raw.completion !== undefined) patch.completion = choice(raw.completion, ["checklist", "deliverable"] as const);
  if (raw.kind !== undefined) patch.kind = choice(raw.kind, ["journey", "request"] as const);
  if (raw.origin !== undefined) patch.origin = choice(raw.origin, ["whatsapp", "reuniao", "email", "ligacao", "outro"] as const);
  if (raw.priority !== undefined) patch.priority = choice(raw.priority, ["baixa", "media", "alta", "critica"] as const);
  if (raw.party !== undefined) patch.party = choice(raw.party, ["equipe", "cliente", "terceiro"] as const);
  if (raw.assignmentSource !== undefined) patch.assignmentSource = choice(raw.assignmentSource, ["papel", "manual", "externo"] as const);
  for (const field of ["requiresEvidence", "approvalRequired"] as const) if (raw[field] !== undefined) patch[field] = boolean(raw[field], false);
  if (raw.relatedNodeIds !== undefined) patch.relatedNodeIds = strings(raw.relatedNodeIds, "elementos");
  if (raw.deadline !== undefined) {
    const rule = object(raw.deadline), mode = choice(rule.mode, ["fixed", "cycle", "client", "task"]);
    allowed(rule, mode === "task" ? ["mode", "taskId", "offsetDays"] : mode === "fixed" ? ["mode"] : ["mode", "offsetDays"]);
    const offsetDays = mode === "fixed" ? 0 : number(rule.offsetDays, 0, -3650, 3650);
    if (!Number.isInteger(offsetDays)) invalid("Use um deslocamento inteiro em dias.");
    patch.deadline = mode === "fixed" ? { mode } : mode === "task" ? { mode, offsetDays, taskId: id(rule.taskId) } : { mode, offsetDays };
  }
  // Clearing the deadline is fixed data: a relative rule would recalculate a date back.
  if (patch.dueAt === "") patch.deadline = { mode: "fixed" };
  return patch;
}
function createTask(raw: Record<string, unknown>, company: string, actor: string, at: string, cycle?: ServiceCycle): Delivery {
  if (editorClearableTaskFields.some(field => raw[field] === null)) invalid("Ao criar uma tarefa, omita os campos opcionais vazios; null só é aceito para limpar uma tarefa existente.");
  const { checklist, ...fields } = raw;
  const patch = taskPatch(fields);
  const task: Delivery = {
    id: `task-${crypto.randomUUID()}`, company, title: "", description: "", status: "fila", ownerId: actor,
    dueAt: cycle?.startsAt ?? "", hours: 0, workstream: "", milestone: cycle?.milestone ?? 1,
    completion: "checklist", ...(cycle ? { productId: cycle.productId, enrollmentId: cycle.enrollmentId } : {}), ...patch,
    comments: [], history: [],
  };
  if (checklist !== undefined) task.checklist = list(checklist, "checklist").map(value => {
    const item = object(value); allowed(item, ["title"]);
    const title = string(item.title, "título do item"); if (!title) invalid("Informe o título do item.");
    return { id: `check-${crypto.randomUUID()}`, title, done: false };
  });
  if (task.status === "entregue") invalid("Crie a tarefa e use a operação de conclusão para registrar a evidência.");
  task.history = recordHistory({}, { status: task.status, ownerId: task.ownerId, dueAt: task.dueAt }, actor, at);
  return task;
}
function putTask(state: DeliverySnapshot, current: Delivery, patch: Partial<Delivery>, actor: string, at: string): DeliverySnapshot {
  const merged = { ...patch, history: [...(patch.history ?? current.history ?? []), ...recordHistory(current, patch, actor, at)] };
  return { ...state,
    statusMap: patch.status ? { ...state.statusMap, [current.id]: patch.status } : state.statusMap,
    extraTasks: state.extraTasks.map(t => t.id === current.id ? { ...t, ...merged } : t),
    taskPatches: { ...state.taskPatches, [current.id]: mergeTaskOverride(state.taskPatches[current.id] ?? {}, merged) },
  };
}
function cycleInput(raw: Record<string, unknown>, current: ServiceCycle | undefined, company: string, actor: string, at: string): ServiceCycle {
  allowed(raw, ["name", "goal", "startsAt", "endsAt", "ownerId", "status", "taskIds", "acceptance", "productId", "enrollmentId", "milestone", "debrief", "templateId"]);
  const next: ServiceCycle = current ? { ...current } : { id: `cycle-${crypto.randomUUID()}`, company, name: "", goal: "", startsAt: "", endsAt: "", ownerId: actor, status: "planejado", taskIds: [], acceptance: [], createdAt: at };
  for (const field of ["name", "goal", "startsAt", "endsAt", "ownerId", "productId", "enrollmentId"] as const)
    if (raw[field] !== undefined) next[field] = string(raw[field], field);
  if (raw.status !== undefined) next.status = choice(raw.status, ["planejado", "em-curso", "em-aceite", "concluido"]);
  if (raw.milestone === null) delete next.milestone;
  else if (raw.milestone !== undefined) { next.milestone = number(raw.milestone, 1, 1); if (!Number.isInteger(next.milestone)) invalid("Informe um marco válido."); }
  if (raw.taskIds !== undefined) next.taskIds = strings(raw.taskIds, "tarefas");
  if (raw.acceptance !== undefined) next.acceptance = list(raw.acceptance, "critérios de aceite").map(value => {
    const criterion = object(value); allowed(criterion, ["id", "text", "done", "approvedBy", "approvedAt", "channel", "note"]);
    const prior = criterion.id === undefined ? undefined : current?.acceptance.find(a => a.id === criterion.id);
    if (criterion.id !== undefined && !prior) invalid("Critério de aceite não encontrado neste ciclo.");
    const text = string(criterion.text, "critério de aceite", prior?.text ?? ""); if (!text) invalid("Descreva o critério de aceite.");
    const done = boolean(criterion.done, prior?.done ?? false);
    const approvedBy = done ? string(criterion.approvedBy, "quem aprovou", prior?.approvedBy ?? "") : undefined;
    if (done && !approvedBy) invalid("Registre quem aprovou o critério de aceite.");
    const approvedAt = criterion.approvedAt === undefined ? undefined : string(criterion.approvedAt, "data da aprovação");
    if (approvedAt !== undefined && !validDate(approvedAt)) invalid("Informe uma data válida para a aprovação.");
    return { id: prior?.id ?? `accept-${crypto.randomUUID()}`, text, done, approvedBy,
      approvedAt: done ? approvedAt ?? (prior?.done && prior.text === text && prior.approvedBy === approvedBy ? prior.approvedAt ?? at : at) : undefined,
      channel: criterion.channel === undefined ? prior?.channel : choice(criterion.channel, ["reuniao", "email", "whatsapp", "documento", "outro"] as const),
      note: string(criterion.note, "nota", prior?.note ?? ""),
    };
  });
  if (new Set(next.acceptance.map(a => a.id)).size !== next.acceptance.length) invalid("Não repita critérios de aceite.");
  if (raw.debrief !== undefined) {
    const value = object(raw.debrief); allowed(value, ["score", "comment", "wouldRehire"]);
    const debrief = { score: number(value.score, 0), comment: string(value.comment, "comentário", "", 600), wouldRehire: boolean(value.wouldRehire, false), by: actor, at };
    const issue = debriefError(debrief); if (issue) invalid(issue);
    if (next.status !== "concluido") invalid("Conclua o ciclo antes de registrar a avaliação.");
    next.debrief = debrief;
  }
  return applyStatusChange(current, { ...next, updatedAt: at }, actor, at);
}

/** Business commands operate on projected entities; callers cannot supply document snapshots or authors. */
export async function executeDeliveryCommand(env: ServerEnv, principal: OperationPrincipal, command: DeliveryCommand,
  input: unknown, key: string, expectedVersions: Record<string, number> = {}, skipActive = false,
  expectedClientSnapshot?: string) {
  const db = env.DB; if (!db) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  if (!["cycles.save", "cycles.remove", "tasks.create", "tasks.remove", "tasks.update", "tasks.complete", "tasks.comment", "tasks.checklist", "tasks.blocker"].includes(command)) invalid("Operação de execução desconhecida.");
  if (command === 'tasks.comment' && !skipActive) {
    const scoped = await tryActiveTaskComment(env, principal, input, key, expectedVersions,
      expectedClientSnapshot);
    if (scoped) return scoped;
  }
  const workspace = env.WORKSPACE_ID || "default", raw = object(input), hash = await requestHash(command, input);
  const previous = await receipt(db, workspace, principal.id, key, command, hash);
  const action = command.startsWith("cycles.") ? "ciclos.editar" : command === "tasks.remove" ? "entregas.remover" : "entregas.editar";
  if (previous) {
    const saved = previous.result as { data: unknown; companies: string[]; clientSnapshot?: string };
    for (const company of saved.companies) await authorizeOperation(db, workspace, principal, { action, scope: "delivery:write", company });
    const doc = principal.kind === 'session' && !saved.clientSnapshot ? await getDoc(db, workspace, KEY) : null;
    return { data: saved.data, documents: principal.kind === "session" && doc ? [{ key: KEY, ...doc }] : [],
      ...(saved.clientSnapshot ? { clientSnapshot: saved.clientSnapshot } : {}) };
  }
  // A task's plan can own a private plan. Validate that ownership after the
  // transformation before choosing the single-client writer.
  const changesJourney = raw.patch && typeof raw.patch === 'object' &&
    !Array.isArray(raw.patch) && Object.hasOwn(raw.patch, 'journeyId');
  const activeTaskId = !skipActive &&
    ['tasks.remove', 'tasks.update', 'tasks.complete', 'tasks.checklist', 'tasks.blocker'].includes(command)
    ? raw.taskId === undefined && Array.isArray(raw.taskIds) &&
      (raw.taskIds.length === 1 || (raw.taskIds.length > 1 && expectedClientSnapshot !== undefined))
      ? id(raw.taskIds[0]) : raw.taskIds === undefined && raw.taskId !== undefined
        ? id(raw.taskId) : null
    : null;
  let activeSlice = activeTaskId ? await readActiveTaskSlice(db, workspace, activeTaskId) : null;
  if (!activeSlice && !skipActive && command === 'tasks.update' &&
      expectedClientSnapshot === undefined && Array.isArray(raw.taskIds) && raw.taskIds.length > 1)
    activeSlice = await readActiveTaskBatchSlice(db, workspace, raw.taskIds);
  if (!activeSlice && !skipActive &&
      ['tasks.create', 'cycles.save', 'cycles.remove'].includes(command)) {
    const company = raw.cycleId !== undefined
      ? await readActiveCycleCompany(db, workspace, id(raw.cycleId))
      : raw.company !== undefined ? id(raw.company) : null;
    if (company) activeSlice = await readActiveCompanySlice(db, workspace, company);
  }
  // Leituras independentes em uma ida só; o que já foi lido não volta ao banco.
  const [doc, clientsDoc, catalogDoc, contactsDoc, documentsDoc] = activeSlice
    ? [{ value: activeSlice.snapshot, version: activeSlice.version },
      ...await loadDocuments(db, workspace,
        ["ontology.clients.v3", "ontology.catalog.v2", "ontology.stakeholders.v1", "ontology.documents.v3"])]
    : await loadDocuments(db, workspace,
      [KEY, "ontology.clients.v3", "ontology.catalog.v2", "ontology.stakeholders.v1", "ontology.documents.v3"]);
  let state = normalizeDeliverySnapshot((doc?.value ?? {}) as Partial<DeliverySnapshot>);
  const projected = projectDelivery(state), at = new Date().toISOString(), actor = principal.memberId;
  const currentCycle = raw.cycleId === undefined ? undefined : projected.cycles.find(c => c.id === id(raw.cycleId));
  const taskIds = command === "tasks.update" && raw.taskIds !== undefined ? strings(raw.taskIds, "tarefas") : raw.taskId === undefined ? [] : [id(raw.taskId)];
  const tasks = taskIds.map(taskId => { const task = projected.tasks.find(t => t.id === taskId); if (!task) throw new OperationError(
    activeSlice && taskIds.length > 1 ? 400 : 404,
    activeSlice && taskIds.length > 1 ? 'invalid_input' : 'task_not_found',
    activeSlice && taskIds.length > 1 ? 'O lote deve conter tarefas do mesmo cliente.' : 'Tarefa não encontrada.'); return task; });
  if (command !== "tasks.create" && command.startsWith("tasks.") && !tasks.length) invalid("Informe a tarefa.");
  if ((command === "cycles.remove" || raw.cycleId !== undefined) && !currentCycle) throw new OperationError(404, "cycle_not_found", "Ciclo não encontrado.");
  const companies = [...new Set(tasks.length ? tasks.map(t => t.company) : [currentCycle?.company ?? id(raw.company, "cliente")])];
  if (activeSlice && (companies.length !== 1 || companies[0] !== activeSlice.company))
    throw new OperationError(taskIds.length > 1 ? 400 : 503,
      taskIds.length > 1 ? 'invalid_input' : 'execution_snapshot_incomplete',
      taskIds.length > 1 ? 'O lote deve conter tarefas do mesmo cliente.' : 'A execução está sendo atualizada. Tente novamente.');
  if (raw.company !== undefined && !companies.every(c => c === raw.company)) invalid("O registro não pertence ao cliente informado.");
  const authGuards: VersionGuard[] = [];
  for (const company of companies) authGuards.push(...await authorizeOperation(db, workspace, principal, { action, scope: "delivery:write", company }));
  if (expectedClientSnapshot && (!activeSlice || clientSnapshotFor(activeSlice) !== expectedClientSnapshot))
    throw new OperationError(409, 'snapshot_changed', 'A execução do cliente mudou. Atualize antes de salvar.',
      { clientSnapshot: activeSlice ? clientSnapshotFor(activeSlice) : null });
  const clients = projectClients((clientsDoc?.value ?? {}) as object), catalog = projectCatalog((catalogDoc?.value ?? {}) as object);
  for (const company of companies) if (!clients.clients.some(c => c.slug === company)) throw new OperationError(404, "client_not_found", "Cliente não encontrado ou arquivado.");
  const rosterKey = authGuards.find(g => g.key.startsWith("ontology.workspace."))!.key;
  const rosterDoc = await getDoc(db, workspace, rosterKey);
  const roster = (rosterDoc?.value ?? {}) as { extraMembers?: Person[]; memberEdits?: Record<string, Partial<Person>>; deactivatedIds?: string[] };
  const members = [...people.filter(p => p.org === "praxis"), ...(roster.extraMembers ?? [])].map(p => ({ ...p, ...roster.memberEdits?.[p.id] })).filter(p => !roster.deactivatedIds?.includes(p.id));
  const contacts = projectStakeholders(contactsDoc?.value as Parameters<typeof projectStakeholders>[0]);
  const documents = (documentsDoc?.value ?? {}) as { extraDocs?: ClientDocument[]; removedDocIds?: string[]; docEdits?: Record<string, Partial<ClientDocument>> };
  const activeDocuments = currentDocuments([...seedDocuments, ...(documents.extraDocs ?? [])].map(d => ({ ...d, ...documents.docEdits?.[d.id] })).filter(d => !documents.removedDocIds?.includes(d.id)));
  function enrollmentScope(entity: Pick<Delivery, "company" | "productId" | "enrollmentId">, verifiedLegacy = false) {
    if (entity.enrollmentId) {
      const enrollment = clients.enrollments.find(e => e.id === entity.enrollmentId && e.company === entity.company);
      if (!enrollment || enrollment.productId !== entity.productId) invalid("Contratação e produto não pertencem a este cliente.");
      if (!enrollmentCanReceiveWork(enrollment)) invalid("A contratação está encerrada ou arquivada e não pode receber alterações.");
    }
    if (!entity.enrollmentId && entity.productId && !verifiedLegacy && clients.enrollments.some(e => e.company === entity.company && e.productId === entity.productId))
      invalid("Escolha explicitamente a contratação deste produto.");
  }
  function ownerScope(entity: Pick<Delivery, "company" | "ownerId">, internalOwner = false) {
    if (!members.some(m => m.id === entity.ownerId) && (internalOwner || !contacts.some(c => c.company === entity.company && c.id === entity.ownerId && c.active))) invalid("Escolha um responsável ativo da equipe ou deste cliente.");
  }
  function scope(entity: Pick<Delivery, "company" | "productId" | "enrollmentId" | "ownerId">, internalOwner = false, verifiedLegacy = false) {
    ownerScope(entity, internalOwner);
    enrollmentScope(entity, verifiedLegacy);
    if (entity.productId && !catalog.products.some(p => p.id === entity.productId)) invalid("Produto não encontrado.");
  }
  function validateTask(task: Delivery, cycle?: ServiceCycle, current?: Delivery, validateScope = true) {
    const persistedTask = projected.tasks.find(row => row.id === task.id);
    const persistedCycle = cycle && projected.cycles.find(row => row.id === cycle.id);
    const verifiedLegacy = Boolean(
      (!persistedTask?.enrollmentId && persistedTask?.productId === task.productId) ||
      (!persistedCycle?.enrollmentId && persistedCycle?.productId === task.productId),
    );
    if (validateScope) scope(task, false, verifiedLegacy);
    // Tarefas legadas (seed) não trazem produto nem contratação: dentro de um
    // ciclo, herdam os dele. Quando a tarefa declara, precisa coincidir.
    const mismatch = (own: string | undefined, owner: string | undefined) => Boolean(own) && own !== (owner ?? "");
    if (cycle && (task.company !== cycle.company || mismatch(task.productId, cycle.productId) || mismatch(task.enrollmentId, cycle.enrollmentId))) invalid("A tarefa e o ciclo precisam pertencer ao mesmo cliente, produto e contratação.");
    // Only incoming values are validated: stored legacy dates (e.g. year 0002) never block unrelated commands.
    // Status always goes along so a closed cycle keeps protecting open work.
    const changed = current ? { ...Object.fromEntries(Object.entries(task).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(current[field as keyof Delivery]))), status: task.status } as Partial<Delivery> : task;
    const issue = deliveryPatchError(changed, cycle, { current, linkedDocuments: activeDocuments.filter(d => d.company === task.company && d.relatedTaskId === task.id).length });
    if (issue) invalid(issue);
  }
  let data: unknown;
  if (command === "cycles.save") {
    allowed(raw, ["company", "cycleId", "cycle", "tasks"]);
    if (currentCycle) enrollmentScope(currentCycle, Boolean(!currentCycle.enrollmentId && currentCycle.productId));
    const cycle = cycleInput(object(raw.cycle), currentCycle, companies[0], actor, at);
    if (currentCycle && (cycle.productId !== currentCycle.productId || cycle.enrollmentId !== currentCycle.enrollmentId)) invalid("O produto e a contratação de um ciclo existente não podem ser alterados.");
    scope(cycle, true, Boolean(currentCycle && !currentCycle.enrollmentId && currentCycle.productId === cycle.productId));
    if (!currentCycle && cycle.productId && !cycle.enrollmentId && clients.enrollments.some(e => e.company === cycle.company && e.productId === cycle.productId)) invalid("Escolha explicitamente a contratação deste novo ciclo.");
    const cycleRaw = object(raw.cycle);
    if (cycleRaw.templateId !== undefined) {
      const templateId = id(cycleRaw.templateId), product = catalog.products.find(p => p.id === cycle.productId);
      const template = product?.cycles.find(t => t.id === templateId);
      if (!template) invalid("Modelo de ciclo não encontrado neste produto.");
      if (currentCycle && templateId !== currentCycle.templateId) invalid("O modelo de origem do ciclo não pode ser trocado.");
      if (!currentCycle) Object.assign(cycle, { templateId, templateName: template.name, productVersion: product!.version, productBaseline: structuredClone(template) });
    }
    if (currentCycle?.status === "concluido" && cycle.status === "concluido" && (cycle.startsAt !== currentCycle.startsAt || cycle.endsAt !== currentCycle.endsAt)) invalid("Reabra o ciclo antes de alterar suas datas.");
    const drafts = raw.tasks === undefined ? [] : list(raw.tasks, "novas tarefas").map(object);
    const references = new Map<string, string>();
    const generated = drafts.map(draft => {
      const { draftRef, ...fields } = draft;
      const task = createTask(fields, cycle.company, actor, at, cycle);
      if (draftRef !== undefined) {
        const reference = id(draftRef);
        if (references.has(reference) || projected.tasks.some(t => t.id === reference)) invalid("Use referências únicas para as novas tarefas.");
        references.set(reference, task.id);
      }
      return task;
    });
    for (const task of generated) if (task.deadline?.mode === "task" && references.has(task.deadline.taskId)) task.deadline = { ...task.deadline, taskId: references.get(task.deadline.taskId)! };
    cycle.taskIds = [...cycle.taskIds, ...generated.map(t => t.id)];
    if (currentCycle?.status === "concluido" && cycle.status === "concluido" && (generated.length || JSON.stringify(cycle.taskIds) !== JSON.stringify(currentCycle.taskIds))) invalid("Reabra o ciclo antes de alterar as tarefas vinculadas.");
    const linked = [...projected.tasks, ...generated].filter(t => cycle.taskIds.includes(t.id));
    for (const task of linked) validateTask(task, cycle, task);
    for (const task of generated) validateTask(task, cycle);
    try { state = saveCycleAggregate(state, cycle, generated, { cycles: serviceCycles, deliveries: projected.tasks }); }
    catch (error) { invalid(error instanceof Error ? error.message : "Revise o ciclo."); }
    data = { cycle, tasks: generated };
  } else if (command === "cycles.remove") {
    allowed(raw, ["cycleId"]);
    enrollmentScope(currentCycle!, Boolean(!currentCycle!.enrollmentId && currentCycle!.productId));
    if (currentCycle!.status === "concluido") invalid("Reabra o ciclo antes de removê-lo.");
    state = { ...state, extraCycles: state.extraCycles.filter(c => c.id !== currentCycle!.id), cycleEdits: { ...state.cycleEdits, [currentCycle!.id]: { ...currentCycle!, removed: true } } };
    data = { cycleId: currentCycle!.id, removed: true };
  } else if (command === "tasks.create") {
    allowed(raw, ["company", "task", "cycleId"]);
    if (currentCycle?.status === "concluido") invalid("Reabra o ciclo antes de adicionar uma tarefa.");
    const task = createTask(object(raw.task), companies[0], actor, at, currentCycle);
    task.journeyId ??= state.companyJourney[task.company] ?? clients.allClients.find(c => c.slug === task.company)?.journeyId;
    validateTask(task, currentCycle);
    if (currentCycle) state = saveCycleAggregate(state, { ...currentCycle, taskIds: [...currentCycle.taskIds, task.id], updatedAt: at }, [task], { cycles: serviceCycles, deliveries: projected.tasks });
    else state = { ...state, extraTasks: [...state.extraTasks, task] };
    data = { task };
  } else if (command === "tasks.remove") {
    allowed(raw, ["taskId"]);
    const current = tasks[0], cycle = projected.cycles.find(c => c.taskIds.includes(current.id));
    enrollmentScope(!current.enrollmentId && cycle?.enrollmentId ? { ...current, productId: current.productId ?? cycle.productId, enrollmentId: cycle.enrollmentId } : current, Boolean(!current.enrollmentId && current.productId));
    try { state = removeDeliveryTask(state, current, projected.tasks, projected.cycles, actor, at); }
    catch (error) { invalid(error instanceof Error ? error.message : "Não foi possível excluir a tarefa."); }
    data = { taskId: current.id, removed: true };
  } else {
    const updated: Delivery[] = [];
    for (const current of tasks) {
      const cycle = projected.cycles.find(c => c.taskIds.includes(current.id));
      const effectiveScope = !current.enrollmentId && cycle?.enrollmentId
        ? { ...current, productId: current.productId ?? cycle.productId, enrollmentId: cycle.enrollmentId }
        : current;
      enrollmentScope(effectiveScope, Boolean(!effectiveScope.enrollmentId && effectiveScope.productId));
      let patch: Partial<Delivery> = {};
      if (command === "tasks.update") {
        allowed(raw, ["taskId", "taskIds", "patch"]);
        if (raw.taskId !== undefined && raw.taskIds !== undefined) invalid("Informe taskId ou taskIds.");
        patch = taskPatch(object(raw.patch));
        if (patch.ownerId !== undefined && patch.ownerId !== current.ownerId && patch.assignmentSource === undefined) patch.assignmentSource = "manual";
        // A batch deadline change keeps each task's interval valid, as the card and drawer do.
        // A single deadline edit also replaces an invalid stored start (legacy year 0002).
        if (patch.dueAt !== undefined && !Object.hasOwn(patch, "startsAt") && (raw.taskIds !== undefined || (current.startsAt && !validTaskDate(current.startsAt)))) patch = { ...directDueDatePatch(current, patch.dueAt), ...patch };
        if (("productId" in patch && patch.productId !== current.productId) || ("enrollmentId" in patch && patch.enrollmentId !== current.enrollmentId)) invalid("O produto e a contratação de uma tarefa existente não podem ser alterados.");
        if (patch.status === "entregue" && current.status !== "entregue") invalid("Use concluir tarefa para registrar checklist e evidência.");
        if (patch.status !== undefined && patch.status !== "entregue" && current.status === "entregue") patch.completedAt = undefined;
        if ((cycle?.status === "concluido" || (current.status === "entregue" && (!patch.status || patch.status === "entregue"))) && ["startsAt", "dueAt", "deadline"].some(field => field in patch && JSON.stringify(patch[field as keyof Delivery]) !== JSON.stringify(current[field as keyof Delivery]))) invalid("Reabra a tarefa e o ciclo antes de alterar o prazo concluído.");
      } else if (command === "tasks.complete") {
        allowed(raw, ["taskId", "evidence", "checklist", "patch", "effortActual", "completedAt"]);
        const today = workspaceDate(at);
        const completedAt = raw.completedAt === undefined
          ? current.completedAt ?? today
          : string(raw.completedAt, "data de conclusão");
        if (!validDate(completedAt)) invalid("Informe uma data de conclusão válida.");
        if (completedAt > today) invalid("A data de conclusão não pode estar no futuro.");
        patch = { ...(raw.patch === undefined ? {} : taskPatch(object(raw.patch))),
          ...(raw.effortActual === undefined ? {} : { effortActual: raw.effortActual === null ? undefined : number(raw.effortActual, 0) }), status: "entregue", completedAt, ...(raw.evidence === undefined ? {} : { evidence: string(raw.evidence, "evidência", undefined, 50000) }) };
        if ((cycle?.status === "concluido" || current.status === "entregue") && ["startsAt", "dueAt", "deadline"].some(field => field in patch && JSON.stringify(patch[field as keyof Delivery]) !== JSON.stringify(current[field as keyof Delivery]))) invalid("Reabra a tarefa e o ciclo antes de alterar o prazo concluído.");
        if (raw.checklist !== undefined) {
          const checks = list(raw.checklist, "checklist").map(value => { const row = object(value); allowed(row, ["id", "done"]); return { id: id(row.id), done: boolean(row.done, false) }; });
          if (new Set(checks.map(c => c.id)).size !== checks.length || checks.some(c => !current.checklist?.some(item => item.id === c.id))) invalid("Item não encontrado no checklist da tarefa.");
          patch.checklist = (current.checklist ?? []).map(item => { const changed = checks.find(c => c.id === item.id); return changed ? markChecklist(item, changed.done, actor, at) : item; });
        }
      } else if (command === "tasks.comment") {
        allowed(raw, ["taskId", "text"]);
        const text = string(raw.text, "comentário", undefined, 10000); if (!text) invalid("Escreva o comentário.");
        patch = { comments: [...(current.comments ?? []), { id: `comment-${crypto.randomUUID()}`, text, by: actor, at }], history: [...(current.history ?? []), { field: "comment", by: actor, at }] };
      } else if (command === "tasks.checklist") {
        allowed(raw, ["taskId", "action", "itemId", "title", "done"]);
        if (current.status === "entregue" || cycle?.status === "concluido") invalid("Reabra a tarefa e o ciclo antes de alterar o checklist.");
        const action = choice(raw.action, ["add", "set", "remove"]), checklist = current.checklist ?? [];
        if (action === "add") { const title = string(raw.title, "título do item"); if (!title) invalid("Informe o título do item."); patch.checklist = [...checklist, { id: `check-${crypto.randomUUID()}`, title, done: false }]; }
        else {
          const itemId = id(raw.itemId); if (!checklist.some(item => item.id === itemId)) invalid("Item não encontrado no checklist da tarefa.");
          patch.checklist = action === "remove" ? checklist.filter(item => item.id !== itemId) : checklist.map(item => item.id === itemId ? markChecklist(item, boolean(raw.done, false), actor, at) : item);
        }
      } else if (command === "tasks.blocker") {
        allowed(raw, ["taskId", "blocker"]);
        // Eligibility belongs to the task, independently of whether the new
        // blocker happens to carry a responsible person.
        enrollmentScope(effectiveScope, Boolean(!effectiveScope.enrollmentId && effectiveScope.productId));
        let blocker = null;
        if (raw.blocker !== null) { const value = object(raw.blocker); allowed(value, ["reason", "ownerId"]); const reason = string(value.reason, "motivo"); if (!reason) invalid("Informe o motivo do bloqueio."); blocker = { reason, since: at, ...(value.ownerId === undefined ? {} : { ownerId: id(value.ownerId) }) }; if (blocker.ownerId) ownerScope({ ...current, ownerId: blocker.ownerId }); }
        patch = { ...blockerPatch(current, blocker, at), history: [...(current.history ?? []), { field: "blocker", by: actor, at, from: current.blockers, to: blocker?.reason ?? "" }] };
      }
      const next = { ...current, ...patch };
      validateTask(next, cycle, command === "tasks.complete" ? { ...current, status: "fila" } : current, command !== "tasks.blocker");
      state = putTask(state, current, patch, actor, at);
      updated.push({ ...next, history: state.taskPatches[current.id].history });
    }
    data = command === "tasks.update" && raw.taskIds !== undefined ? { tasks: updated } : { task: updated[0] };
  }
  // Resolve dependencies against all effective tasks, preserving frozen dates.
  const after = projectDelivery(state);
  for (const task of after.tasks.filter(t => companies.includes(t.company))) if (task.deadline?.mode === "task") {
    const parent = after.tasks.find(t => t.id === (task.deadline as { taskId: string }).taskId);
    if (parent && task.enrollmentId && parent.enrollmentId !== task.enrollmentId) invalid("A referência de prazo deve pertencer à mesma contratação.");
  }
  try { state = scheduledExecution(state, after.tasks.filter(t => companies.includes(t.company)), after.cycles.filter(c => companies.includes(c.company)), Object.fromEntries(clients.allClients.map(c => [c.slug, c.startedAt])), Object.fromEntries(clients.enrollments.map(e => [e.id, e.startsAt]))); }
  catch (error) { invalid(error instanceof Error ? error.message : "Revise as dependências de prazo."); }
  const final = projectDelivery(state);
  const scheduleIssue = changedScheduleError(projected.tasks.filter(t => companies.includes(t.company)), final.tasks.filter(t => companies.includes(t.company)));
  if (scheduleIssue) invalid(scheduleIssue);
  if (data && typeof data === "object") {
    const result = data as { task?: Delivery; tasks?: Delivery[] };
    if (result.task) result.task = final.tasks.find(t => t.id === result.task!.id)!;
    if (result.tasks) result.tasks = result.tasks.map(t => final.tasks.find(v => v.id === t.id)!);
  }
  const guards = uniqueGuards([...authGuards,
    ...(!activeSlice || expectedVersions[KEY] !== undefined ? [{ key: KEY, version: doc?.version ?? 0 }] : []),
    { key: "ontology.clients.v3", version: clientsDoc?.version ?? 0 }, { key: "ontology.catalog.v2", version: catalogDoc?.version ?? 0 }, { key: "ontology.stakeholders.v1", version: contactsDoc?.version ?? 0 }, { key: "ontology.documents.v3", version: documentsDoc?.version ?? 0 }, { key: rosterKey, version: rosterDoc?.version ?? 0 }]);
  for (const guard of guards) if (expectedVersions[guard.key] !== undefined && expectedVersions[guard.key] !== guard.version) throw new OperationError(412, "version_conflict", "Os dados foram alterados. Atualize antes de salvar.");
  let statements: D1PreparedStatement[] = [];
  if (activeSlice && changesJourney) {
    const partition = partitionClientDelivery(state,
      clients.enrollments.filter(enrollment => enrollment.company === activeSlice.company));
    if (partition.unassigned.length || partition.sharedPlanIds.length ||
        partition.slices.some(slice => slice.company !== activeSlice.company)) {
      if (expectedClientSnapshot) throw new OperationError(409, 'scoped_command_unavailable',
        'Esta troca de plano exige a execução completa.');
      return executeDeliveryCommand(env, principal, command, input, key, expectedVersions, true);
    }
  }
  if (activeSlice) try {
    statements = await activeTaskStatements(db, workspace, activeSlice, state, 780, command,
      new Set(catalog.journeys.map(journey => journey.id)), Boolean(currentCycle));
  } catch (error) {
    if (error instanceof ClientScopeRequiresBridge) {
      if (expectedClientSnapshot) throw new OperationError(409, 'scoped_command_unavailable',
        'Esta alteração exige o fluxo completo de execução.');
      return executeDeliveryCommand(env, principal, command, input, key, expectedVersions, true);
    }
    throw error;
  }
  const committed = await commitOperation(db, { workspace, principal: principal.id, application: principal.application, actor: principal, key, command, hash, id: crypto.randomUUID(), guards,
    writes: activeSlice ? [] : [{ key: KEY, value: state }], statements, events: companies.map(company => {
    const eventTasks = ((data as { tasks?: Delivery[] }).tasks ?? ((data as { task?: Delivery }).task ? [(data as { task: Delivery }).task] : [])).filter(t => t.company === company);
    return { type: command, company, subject: (data as { taskId?: string }).taskId ?? (data as { task?: Delivery; cycle?: ServiceCycle; cycleId?: string }).task?.id ?? (data as { cycle?: ServiceCycle }).cycle?.id ?? (data as { cycleId?: string }).cycleId ?? company,
      data: { command, taskIds: command === "tasks.remove" ? [(data as {taskId:string}).taskId] : eventTasks.map(t => t.id), ...(command === "tasks.complete" ? { completedAt: eventTasks[0]?.completedAt } : {}) } };
  }), result: { data, companies,
    ...(activeSlice ? { clientSnapshot: clientSnapshotFor(activeSlice, activeSlice.revision + 1) } : {}) },
    checked: true }) as { data: unknown; companies: string[]; clientSnapshot?: string };
  const saved = principal.kind === 'session' && !activeSlice ? await getDoc(db, workspace, KEY) : null;
  return { data: committed.data, documents: principal.kind === "session" && saved ? [{ key: KEY, ...saved }] : [],
    ...(committed.clientSnapshot ? { clientSnapshot: committed.clientSnapshot } : {}) };
}

function markChecklist(item: ChecklistItem, done: boolean, actor: string, at: string): ChecklistItem {
  if (item.done === done) return item;
  return { ...item, done, doneBy: done ? actor : undefined, doneAt: done ? at : undefined };
}
