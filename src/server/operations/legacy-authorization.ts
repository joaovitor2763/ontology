import { resolveMember } from "../authz.ts";
import { loadDocuments, workspaceDocument } from "./request-context.ts";
import { can, normalizeAccess, type Action, type Actor } from "../../modules/workspace/domain/permissions.ts";
import { CLIENTS_INITIAL, projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import { DELIVERY_INITIAL, projectDelivery, type DeliverySnapshot } from "../../modules/delivery/infrastructure/snapshot.ts";
import { CATALOG_INITIAL } from "../../modules/catalog/infrastructure/snapshot.ts";
import { ENGAGEMENT_INITIAL } from "../../modules/engagement/infrastructure/snapshot.ts";
import { meetings, events, pains, solutions, hypotheses, threads } from "../../modules/engagement/infrastructure/seed.ts";
import { documents } from "../../modules/documents/infrastructure/seed.ts";
import { STAKEHOLDERS_INITIAL } from "../../modules/clients/infrastructure/stakeholders-snapshot.ts";
import { signalId } from "../../modules/engagement/domain/signals.ts";
import type { ThreadMessage } from "../../modules/engagement/domain/models.ts";
import { canonical, commitOperation, requestHash, type OperationEvent } from "./transaction.ts";
import { supportedStateKey, protectOperationFields } from "./legacy-state.ts";
import { OperationError } from "./errors.ts";

type Row = Record<string, unknown>;
const invalid = (message = "Alteração de estado inválida ou sem contexto de cliente.") => new OperationError(422, "invalid_snapshot", message);
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Row;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(object);
}
function map(value: unknown): Row { return value === undefined ? {} : object(value); }
function changed(before: unknown, after: unknown) { return canonical(before) !== canonical(after); }
function changedKeys(before: unknown, after: unknown) {
  const a = map(before), b = map(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => changed(a[k], b[k]));
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(x => typeof x !== "string")) throw invalid();
  return value;
}
function rowMap(value: unknown, key = "id") {
  const result = new Map<string, Row>();
  for (const row of rows(value ?? [])) {
    if (typeof row[key] !== "string" || !row[key] || result.has(row[key] as string)) throw invalid("Identidade duplicada ou inválida no estado.");
    result.set(row[key] as string, row);
  }
  return result;
}
function merged(seed: unknown[], state: Row, extra: string, edits?: string) {
  const result = rowMap(seed);
  for (const [id, row] of rowMap(state[extra])) {
    if (result.has(id)) throw invalid("Uma entidade nova não pode substituir a identidade de um registro existente.");
    result.set(id, row);
  }
  if (edits) for (const [id, edit] of Object.entries(map(state[edits]))) {
    if (!result.has(id)) throw invalid("Edição sem registro de origem.");
    const patch = object(edit);
    if (patch.id !== undefined && patch.id !== id) throw invalid("A identidade de um registro não pode mudar.");
    result.set(id, { ...result.get(id), ...patch });
  }
  return result;
}
const INITIALS: Record<string, Row> = {
  "ontology.clients.v3": CLIENTS_INITIAL,
  "ontology.delivery.v2": DELIVERY_INITIAL,
  "ontology.catalog.v2": CATALOG_INITIAL,
  "ontology.engagement.v2": ENGAGEMENT_INITIAL,
  "ontology.stakeholders.v1": STAKEHOLDERS_INITIAL,
  "ontology.workspace.v3": { hidden: [], extraMembers: [], deactivatedIds: [], memberEdits: {}, currentUserId: "", workspaceName: "", alertRules: {}, memberRoles: [], allocationRoles: [] },
  "ontology.documents.v3": { extraDocs: [], removedDocIds: [], docEdits: {} },
  "ontology.knowledge.v2": { ontologyDrafts: {} },
  "ontology.relationship.v1": { notes: {}, spaces: [], read: [], unread: [], pinned: [] },
};
function normalized(key: string, value: unknown): Row {
  const initial = INITIALS[key];
  if (!initial) throw invalid("Este documento não aceita gravações.");
  const raw = value === null || value === undefined ? {} : object(value);
  for (const [field, item] of Object.entries(raw)) {
    if (!Object.hasOwn(initial, field)) throw invalid(`Campo de estado desconhecido: ${field}.`);
    const fallback = initial[field];
    if (Array.isArray(fallback) ? !Array.isArray(item) : typeof fallback === "object" ? !item || typeof item !== "object" || Array.isArray(item) : typeof item !== typeof fallback) throw invalid(`Formato inválido: ${field}.`);
  }
  return { ...initial, ...raw };
}

/** Compatibility adapter: legacy writers share authorization, version guards, audit and outbox. */
export async function saveLegacyState(db: D1Database, workspace: string, email: string, key: string, incoming: unknown, baseVersion: number) {
  if (!supportedStateKey(key, true)) throw invalid("Chave de estado não suportada.");
  // Só o que a decisão usa: o documento gravado, o roster (permissão), o
  // cadastro de clientes (alocação) e, para engajamento, os espaços de
  // interação de onde os sinais vêm. Guardar documentos que ninguém leu não
  // acrescentava garantia, só produzia conflito onde não havia disputa.
  const roster = await workspaceDocument(db, workspace);
  const names = [...new Set([key, roster.key, "ontology.clients.v3",
    ...(key === "ontology.engagement.v2" ? ["ontology.relationship.v1"] : [])])];
  const storedDocuments = await loadDocuments(db, workspace, names);
  const loaded = new Map(names.map((name, index) => [name, storedDocuments[index]] as const));
  const current = loaded.get(key);
  if ((current?.version ?? 0) !== baseVersion) throw new OperationError(409, "version_conflict", "Os dados mudaram. Atualize e tente novamente.", current ?? { value: null, version: 0, updatedAt: null });
  const identity = await resolveMember(db, workspace, email);
  const before = normalized(key, current?.value);
  // Preserve the existing first-session initialization policy; normal roster edits use commands.
  const after = normalized(key, protectOperationFields(key, current?.value, incoming, {workspaceInitialization:identity.bootstrap}));
  // A new browser can flush the empty initial document before SessionBoot adds its owner.
  // Acknowledge only this exact no-op without persisting or granting any permissions.
  if (!current && identity.bootstrap && key === "ontology.workspace.v3" && canonical(before) === canonical(after)) return { version: 0 };
  if (!identity.member?.active) {
    if (!(identity.bootstrap && key === "ontology.workspace.v3")) throw new OperationError(403, "inactive_member", "Seu acesso não está ativo.");
    const members = rows(after.extraMembers);
    if (members.length !== 1 || members[0].email !== email || members[0].access !== "admin" || Object.keys(map(after.memberEdits)).length || strings(after.deactivatedIds).length)
      throw new OperationError(403, "bootstrap_denied", "O cadastro inicial só pode criar o próprio administrador.");
  }
  const actor: Actor = { memberId: identity.member?.id ?? String(rows(after.extraMembers)[0].id), access: identity.member ? normalizeAccess(identity.member.access) : "admin" };
  if (actor.access === "leitor") throw new OperationError(403, "permission_denied", "Seu acesso é de visualização.");
  const clients = projectClients((loaded.get("ontology.clients.v3")?.value ?? {}) as Partial<ClientsSnapshot>);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const emitted: OperationEvent[] = [];
  const linkedFiles = new Map<string, { status: string; r2_key: string }>();
  async function verifyFile(id: unknown, company: unknown) {
    if (typeof id !== "string" || typeof company !== "string") throw invalid("Vínculo de arquivo inválido.");
    const file = await db.prepare("SELECT company,status,r2_key FROM files WHERE workspace_id=? AND id=?").bind(workspace, id).first<{ company: string | null; status: string; r2_key: string }>();
    if (!file || file.company !== company || file.status !== "ready") throw invalid("Envie o arquivo para este cliente antes de vinculá-lo ao documento ou à interação.");
    linkedFiles.set(id, file);
  }
  function require(action: Action, company?: unknown) {
    if (company !== undefined && (typeof company !== "string" || !clients.allClients.some(c => c.slug === company))) {
      // A composed client snapshot can introduce its own client, subject to create permission.
      const isNew = key === "ontology.clients.v3" && rows(after.extraClients).some(c => c.slug === company);
      if (!isNew) throw invalid("Cliente de origem não encontrado.");
    }
    const ids = clients.allocations.filter(a => a.company === company && (!a.from || a.from <= today) && (!a.to || a.to >= today)).map(a => a.memberId);
    if (!can(actor, action, { responsibleIds: ids })) throw new OperationError(403, "permission_denied", "Você não tem permissão para alterar este cliente ou campo.");
  }
  function event(type: string, company: unknown, subject: string) {
    emitted.push({ type, ...(typeof company === "string" ? { company } : {}), subject });
  }
  function entityDiff(a: Map<string, Row>, b: Map<string, Row>, action: Action, type: string) {
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(id), next = b.get(id);
      if (!changed(old, next)) continue;
      if (old?.company && next?.company && old.company !== next.company) throw invalid("Não é possível mover um registro para outro cliente.");
      const company = old?.company ?? next?.company;
      if (typeof company !== "string") throw invalid();
      require(action, company);
      event(`${type}.${old ? next ? "updated" : "removed" : "created"}`, company, id);
    }
  }
  function clientMap(field: string, action: Action, type: string) {
    for (const company of changedKeys(before[field], after[field])) { require(action, company); event(type, company, company); }
  }
  function idsDiff(field: string, source: Map<string, Row>, action: Action, type: string) {
    const previous = strings(before[field]), next = strings(after[field]);
    for (const id of new Set([...previous, ...next])) if (previous.includes(id) !== next.includes(id)) {
      const row = source.get(id); if (!row) throw invalid("Remoção sem registro de origem.");
      require(action, row.company); event(type, row.company, id);
    }
  }
  if (key === "ontology.clients.v3") {
    const a = projectClients(before as Partial<ClientsSnapshot>), b = projectClients(after as Partial<ClientsSnapshot>);
    const oldExtras = rowMap(before.extraClients, "slug"), nextExtras = rowMap(after.extraClients, "slug");
    for (const slug of nextExtras.keys()) if (!oldExtras.has(slug) && a.allClients.some(c => c.slug === slug)) throw invalid("Um novo cliente não pode substituir um cliente existente.");
    for (const slug of changedKeys(before.clientEdits, after.clientEdits)) {
      require("cliente.configurar", slug);
      const patch = map(after.clientEdits)[slug];
      if (patch && object(patch).slug !== undefined && object(patch).slug !== slug) throw invalid("O identificador do cliente não pode mudar.");
    }
    for (const slug of changedKeys(before.assignments, after.assignments)) require("alocacao.editar", slug);
    const oldClients = new Map(a.allClients.map(c => [c.slug, c])), nextClients = new Map(b.allClients.map(c => [c.slug, c]));
    for (const slug of new Set([...oldClients.keys(), ...nextClients.keys()])) {
      const old = oldClients.get(slug), next = nextClients.get(slug);
      if (!changed(old, next)) continue;
      require(!old ? "clientes.criar" : !next ? "cliente.arquivar" : "cliente.configurar", slug);
      if (old && next && (old.leadId !== next.leadId || old.csId !== next.csId)) require("alocacao.editar", slug);
      event(`client.${!old ? "created" : !next ? "removed" : "updated"}`, slug, slug);
    }
    if (changed(a.allocations, b.allocations) || changed(before.assignments, after.assignments)) require("alocacao.editar");
    entityDiff(rowMap(a.allocations), rowMap(b.allocations), "alocacao.editar", "allocation");
    for (const field of ["enrollments", "participations"]) if (changed(before[field], after[field])) throw invalid("Use as operações de contratação.");
    clientMap("configs", "cliente.configurar", "client.updated");
    const oldArchived = strings(before.archivedClients), nextArchived = strings(after.archivedClients);
    for (const slug of new Set([...oldArchived, ...nextArchived])) if (oldArchived.includes(slug) !== nextArchived.includes(slug)) { require("cliente.arquivar", slug); event(nextArchived.includes(slug) ? "client.archived" : "client.restored", slug, slug); }
  } else if (key === "ontology.workspace.v3") {
    for (const field of ["extraMembers", "memberEdits", "deactivatedIds"]) if (changed(before[field], after[field])) require("equipe.gerenciar");
    for (const field of ["workspaceName", "alertRules", "memberRoles", "allocationRoles"]) if (changed(before[field], after[field])) require("configuracoes.editar");
    if (changed(before.currentUserId, after.currentUserId) && after.currentUserId !== actor.memberId) require("ver-como");
    if (changed(before, after)) event("workspace.updated", undefined, "workspace");
  } else if (key === "ontology.catalog.v2") {
    require("catalogo.editar");
    if (changed(before, after)) event("catalog.updated", undefined, "catalog");
  } else if (key === "ontology.stakeholders.v1") {
    const a = rowMap(before.contacts), b = rowMap(after.contacts);
    entityDiff(a, b, "stakeholders.editar", "stakeholder");
  } else if (key === "ontology.delivery.v2") {
    const a = projectDelivery(before as Partial<DeliverySnapshot>), b = projectDelivery(after as Partial<DeliverySnapshot>);
    entityDiff(rowMap(a.cycles), rowMap(b.cycles), "ciclos.editar", "cycle");
    entityDiff(rowMap(a.tasks), rowMap(b.tasks), "entregas.editar", "delivery");
    const tasks = new Map([...rowMap(a.tasks), ...rowMap(b.tasks)]), cycles = new Map([...rowMap(a.cycles), ...rowMap(b.cycles)]);
    for (const field of ["statusMap", "taskPatches"]) for (const id of changedKeys(before[field], after[field])) { const task = tasks.get(id); if (!task) throw invalid("Tarefa de origem não encontrada."); require("entregas.editar", task.company); }
    for (const id of changedKeys(before.cycleEdits, after.cycleEdits)) { const cycle = cycles.get(id); if (!cycle) throw invalid("Ciclo de origem não encontrado."); require("ciclos.editar", cycle.company); }
    for (const field of ["companyJourney", "companyMilestone", "companyJourneyVersion"]) clientMap(field, "plano.editar", "plan.updated");
    for (const id of changedKeys(before.productPlans, after.productPlans)) {
      const owners = new Set([...a.tasks, ...b.tasks].filter(t => t.journeyId === id).map(t => t.company));
      for (const [company, plan] of Object.entries({ ...map(before.companyJourney), ...map(after.companyJourney) })) if (plan === id) owners.add(company);
      if (!owners.size) throw invalid("Plano privado sem cliente de origem.");
      for (const company of owners) { require("plano.editar", company); event("plan.updated", company, id); }
    }
    for (const cycle of b.cycles) if (changed(a.cycles.find(c => c.id === cycle.id), cycle)) {
      for (const taskId of cycle.taskIds) if (tasks.get(taskId)?.company !== cycle.company) throw invalid("Uma tarefa do ciclo pertence a outro cliente ou não existe.");
    }
  } else if (key === "ontology.engagement.v2") {
    const groups = [
      ["extraMeetings", "meetingEdits", "removedMeetings", meetings, "reunioes.agendar", "meeting"],
      ["extraEvents", "eventEdits", "removedEvents", events, "reunioes.agendar", "event"],
      ["extraPains", "painEdits", "removedPains", pains, "interacoes.registrar", "pain"],
      ["extraSolutions", "solutionEdits", "removedSolutions", solutions, "interacoes.registrar", "solution"],
      ["extraHypotheses", "hypothesisEdits", "removedHypotheses", hypotheses, "interacoes.registrar", "hypothesis"],
    ] as const;
    const meetingSources = new Map<string, Row>();
    for (const [extra, edits, removed, seed, action, type] of groups) {
      const a = merged([...seed], before, extra, edits), b = merged([...seed], after, extra, edits);
      entityDiff(a, b, action, type); idsDiff(removed, new Map([...a, ...b]), action, `${type}.removed`);
      if (type === "meeting") {
        for (const [id, row] of [...a, ...b]) meetingSources.set(id, row);
        for (const [id, meeting] of b) {
          const fileId = map(meeting.google).transcriptDocId;
          if (fileId && fileId !== map(a.get(id)?.google).transcriptDocId) await verifyFile(fileId, meeting.company);
        }
      }
    }
    for (const id of changedKeys(before.notes, after.notes)) { const meeting = meetingSources.get(id); if (!meeting) throw invalid("Notas sem reunião de origem."); require("reunioes.agendar", meeting.company); event("meeting.updated", meeting.company, id); }
    if (changed(before.extraTemplates, after.extraTemplates) || changed(before.templateEdits, after.templateEdits)) { require("catalogo.editar"); event("communication_template.updated", undefined, "templates"); }
    const relationship = (loaded.get("ontology.relationship.v1")?.value ?? {}) as Row;
    const sources = merged(threads, { ...relationship, spaces: relationship.spaces ?? [] }, "spaces");
    const signalCompanies = new Map<string, unknown>();
    for (const thread of sources.values()) for (const message of [...rows(thread.messages ?? []), ...rows(map(relationship.notes)[String(thread.id)] ?? [])]) signalCompanies.set(signalId(String(thread.id), message as ThreadMessage), thread.company);
    for (const field of ["signalReviews", "signalClassifications"]) for (const id of changedKeys(before[field], after[field])) {
      if (!signalCompanies.has(id)) throw invalid("Sinal sem contexto de cliente verificável.");
      require("interacoes.registrar", signalCompanies.get(id)); event("signal.updated", signalCompanies.get(id), id);
    }
  } else if (key === "ontology.documents.v3") {
    const a = merged(documents, before, "extraDocs", "docEdits"), b = merged(documents, after, "extraDocs", "docEdits");
    entityDiff(a, b, "documentos.enviar", "document"); idsDiff("removedDocIds", new Map([...a, ...b]), "documentos.enviar", "document.removed");
    for (const [id, next] of b) if (changed(a.get(id), next)) {
      const old = a.get(id);
      if (["reviewStatus", "reviewedBy", "reviewHistory", "reviewNotes", "reviewedAt"].some(field => changed(old?.[field], next[field])) && actor.access !== "admin") throw new OperationError(403, "permission_denied", "Somente admins revisam documentos.");
      if (!old && next.uploadedBy !== actor.memberId) throw invalid("O envio deve identificar a pessoa autenticada.");
      if (!old) await verifyFile(id, next.company);
    }
  } else if (key === "ontology.knowledge.v2") clientMap("ontologyDrafts", "ontologia.editar", "knowledge.updated");
  else if (key === "ontology.relationship.v1") {
    const a = merged(threads, before, "spaces"), b = merged(threads, after, "spaces");
    entityDiff(a, b, "interacoes.registrar", "interaction");
    const all = new Map([...a, ...b]);
    for (const [id, thread] of b) if (changed(a.get(id), thread)) {
      const oldFiles = new Set(rows(a.get(id)?.messages ?? []).flatMap(m => rows(m.files ?? []).map(f => f.id)));
      for (const file of rows(thread.messages ?? []).flatMap(m => rows(m.files ?? []))) if (!oldFiles.has(file.id)) await verifyFile(file.id, thread.company);
    }
    for (const id of changedKeys(before.notes, after.notes)) {
      const thread = all.get(id); if (!thread) throw invalid("Interação sem cliente de origem.");
      require("interacoes.registrar", thread.company); event("interaction.updated", thread.company, id);
      const oldFiles = new Set(rows(map(before.notes)[id] ?? []).flatMap(m => rows(m.files ?? []).map(f => f.id)));
      for (const file of rows(map(after.notes)[id] ?? []).flatMap(m => rows(m.files ?? []))) if (!oldFiles.has(file.id)) await verifyFile(file.id, thread.company);
    }
    for (const field of ["read", "unread", "pinned"]) idsDiff(field, all, "interacoes.registrar", "interaction.updated");
  }
  const deduplicated = [...new Map(emitted.map(e => [`${e.type}:${e.company}:${e.subject}`, e])).values()];
  const operationId = crypto.randomUUID();
  const fileStatements: D1PreparedStatement[] = [];
  for (const [id, file] of linkedFiles) {
    const tx = crypto.randomUUID();
    fileStatements.push(db.prepare("INSERT INTO file_operation_guards(transaction_id,workspace_id,file_id,expected_status,expected_r2_key) VALUES(?,?,?,?,?)").bind(tx, workspace, id, file.status, file.r2_key), db.prepare("DELETE FROM file_operation_guards WHERE transaction_id=?").bind(tx));
  }
  // A chave do recibo nasce aqui, então não existe recibo anterior para ler.
  await commitOperation(db, { checked: true, workspace, principal: `member:${actor.memberId}`, application: "web", actor: { memberId: actor.memberId, email, kind: "session" }, key: `legacy:${operationId}`, command: `snapshot:${key}`, hash: await requestHash(key, after), id: operationId,
    guards: [...loaded].map(([name, doc]) => ({ key: name, version: doc?.version ?? 0 })), writes: [{ key, value: after }], statements: fileStatements, events: deduplicated, result: { version: baseVersion + 1 } });
  return { version: baseVersion + 1 };
}
