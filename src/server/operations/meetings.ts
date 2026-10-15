import type { ServerEnv } from "../context";
import { getDoc } from "../db.ts";
import { createCalendarEvent, changeCalendarEvent, getConnection, googleEnabled, type CreateEventInput } from "../google.ts";
import { eventAttendees } from "../../modules/engagement/application/google-meet.ts";
import { normalizeInteractionTags } from "../../modules/engagement/domain/interaction-tags.ts";
import { meetingError, validEmail, withActionIds } from "../../modules/engagement/domain/meetings.ts";
import type { Meeting, MeetingGoogle } from "../../modules/engagement/domain/models.ts";
import { normalizeEngagementSnapshot, projectMeetings, putMeetingSnapshot } from "../../modules/engagement/infrastructure/snapshot.ts";
import { projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import { projectStakeholders, type StakeholdersSnapshot } from "../../modules/clients/infrastructure/stakeholders-snapshot.ts";
import { projectDelivery, type DeliverySnapshot } from "../../modules/delivery/infrastructure/snapshot.ts";
import { people } from "../../modules/workspace/infrastructure/seed.ts";
import type { Person } from "../../modules/workspace/domain/models.ts";
import { authorizeOperation, type OperationPrincipal } from "./principal.ts";
import { canonical, commitOperation, receipt, requestHash, type VersionGuard } from "./transaction.ts";
import { forgetDocuments } from "./request-context.ts";
import { OperationError } from "./errors.ts";
import { readActiveCompanySlice } from './delivery-client-task-write.ts';

const KEY = "ontology.engagement.v2";
export type MeetingCommand = "meetings.create" | "meetings.update" | "meetings.reschedule" | "meetings.cancel";
type Journal = { id: string; meeting_id: string; company: string; principal_id: string; command: MeetingCommand; desired: string; pending_meeting: string; calendar_input: string; status: "pending" | "uncertain" | "complete"; external_result: string | null; error: string | null; actor_id: string | null; actor_email: string | null; actor_source: "interface" | "api" | "mcp" | null; actor_application: string | null };
type CalendarIntent = { event: CreateEventInput; organizer: string; previous?: MeetingGoogle };
const invalid = (message: string) => new OperationError(422, "invalid_meeting", message);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Informe os dados da reunião.");
  return value as Record<string, unknown>;
}
function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== "string" || v.length > 300)) throw invalid(`Revise ${field}.`);
  return [...new Set(value as string[])];
}
function normalizeMeeting(raw: Record<string, unknown>, existing: Meeting | undefined, principal: OperationPrincipal): Meeting {
  const next: Meeting = existing ? { ...existing } : {
    id: `m-${crypto.randomUUID()}`, company: "", title: "", kind: "alinhamento", modality: "online",
    startsAt: "", durationMin: 45, attendeeIds: [], guests: [], summary: "", notes: "", decisions: [], actions: [],
    tags: [], organizerEmail: principal.email, createdAt: new Date().toISOString(),
  };
  for (const field of ["removedAt", "removedBy", "restoredAt", "restoredBy"] as const)
    if (Object.hasOwn(raw, field) && canonical(raw[field]) !== canonical(existing?.[field])) throw invalid("Use as operações de remoção e restauração da reunião.");
  // Author, identity, external references and operation state never come from callers.
  const textFields = ["company", "title", "startsAt", "place", "summary", "notes", "cycleId", "deliveryId", "learnings", "implications"] as const;
  for (const key of textFields) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length > (key === "notes" ? 50000 : 8000)) throw invalid(`Campo inválido: ${key}.`);
    next[key] = (raw[key] as string).trim();
  }
  if (existing && next.company !== existing.company) throw invalid("Não é possível trocar o cliente de uma reunião existente.");
  if (raw.durationMin !== undefined) {
    if (typeof raw.durationMin !== "number" || !Number.isInteger(raw.durationMin) || raw.durationMin < 1 || raw.durationMin > 1440) throw invalid("Informe uma duração entre 1 e 1440 minutos.");
    next.durationMin = raw.durationMin;
  }
  for (const field of ["attendeeIds", "guests", "enrollmentIds", "decisions"] as const) if (raw[field] !== undefined) next[field] = stringList(raw[field], field);
  if (raw.kind !== undefined) {
    if (!["kickoff", "workshop", "steering", "demo", "alinhamento", "suporte", "retro", "entrevista", "apresentacao"].includes(String(raw.kind))) throw invalid("Tipo de reunião inválido.");
    next.kind = raw.kind as Meeting["kind"];
  }
  if (raw.modality !== undefined) {
    if (raw.modality !== "online" && raw.modality !== "presencial") throw invalid("Modalidade inválida.");
    next.modality = raw.modality;
  }
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.length > 100) throw invalid("Revise as ações combinadas.");
    const previousActions = existing ? withActionIds(existing).actions : [];
    const hasLinkedActions = previousActions.some(action => action.deliveryId || action.removedAt);
    next.actions = raw.actions.map((value, index) => {
      const action = record(value);
      if (["text", "ownerId", "dueAt"].some(k => typeof action[k] !== "string")) throw invalid("Revise as ações combinadas.");
      if (hasLinkedActions && (typeof action.id !== "string" || !action.id.trim())) throw invalid("Informe os identificadores das ações para preservar seus vínculos com tarefas.");
      const id = typeof action.id === "string" ? action.id : previousActions[index]?.id ?? crypto.randomUUID();
      const prior = previousActions.find(a => a.id === id);
      if (Object.hasOwn(action, "deliveryId") && action.deliveryId !== prior?.deliveryId) throw invalid("Use a conversão da ação para criar o vínculo com uma tarefa.");
      for (const field of ["removedAt", "removedBy"] as const)
        if (Object.hasOwn(action, field) && canonical(action[field]) !== canonical(prior?.[field])) throw invalid("Use as operações de remoção e restauração da ação.");
      if (prior?.removedAt) {
        if (["text", "ownerId", "dueAt", "done"].some(field => canonical(action[field]) !== canonical(prior[field as keyof typeof prior]))) throw invalid("Restaure a ação antes de editar seu conteúdo.");
        return prior;
      }
      return { id, text: String(action.text), ownerId: String(action.ownerId), dueAt: String(action.dueAt), done: action.done === true,
        ...(prior?.deliveryId ? { deliveryId: prior.deliveryId } : {}) };
    });
    // Older editors may omit removed actions; their retained history is not a deletion request.
    next.actions.push(...previousActions.filter(action => action.removedAt && !next.actions.some(next => next.id === action.id)));
    if (new Set(next.actions.map(a => a.id)).size !== next.actions.length) throw invalid("As ações precisam ter identificadores únicos.");
    if (previousActions.some(a => a.deliveryId && !next.actions.some(next => next.id === a.id))) throw invalid("Uma ação vinculada a uma tarefa não pode ser removida por esta edição.");
  }
  if (raw.tags !== undefined) next.tags = normalizeInteractionTags(raw.tags);
  if (raw.prep !== undefined) {
    const prep = record(raw.prep);
    const allowed = ["homeworkDone", "hypothesisIds", "questions", "purpose", "importance", "preview", "format", "preReadSent", "rehearsed", "speakers"];
    if (Object.keys(prep).some(k => !allowed.includes(k)) || Object.entries(prep).some(([k, v]) => k === "hypothesisIds" ? !Array.isArray(v) || v.some(id => typeof id !== "string") : ["homeworkDone", "preReadSent", "rehearsed"].includes(k) ? typeof v !== "boolean" : typeof v !== "string")) throw invalid("Preparação da reunião inválida.");
    next.prep = prep as Meeting["prep"];
  }
  const error = meetingError(next);
  if (error) throw invalid(error);
  // Require an explicit zone: a server's local timezone must not reinterpret a meeting.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(next.startsAt)) throw invalid("Informe o horário com fuso explícito.");
  return { ...next, startsAt: new Date(next.startsAt).toISOString(), updatedAt: new Date().toISOString() };
}
function uniqueGuards(guards: VersionGuard[]) {
  const map = new Map<string, number>();
  for (const g of guards) {
    if (map.has(g.key) && map.get(g.key) !== g.version) throw new OperationError(409, "version_conflict", "Os dados mudaram durante a operação.");
    map.set(g.key, g.version);
  }
  return [...map].map(([key, version]) => ({ key, version }));
}
async function response(db: D1Database, workspace: string, principal: OperationPrincipal, meetingId: string, operationId?: string) {
  const doc = await getDoc(db, workspace, KEY);
  const meeting = projectMeetings((doc?.value ?? {}) as object).find(m => m.id === meetingId);
  const operation = operationId ? await db.prepare("SELECT status,error FROM meeting_operations WHERE workspace_id=? AND id=?").bind(workspace, operationId).first<{ status: string; error: string | null }>() : null;
  return { data: { meeting, operation: operation ? { id: operationId, ...operation } : null }, documents: doc && principal.kind === "session" ? [{ key: KEY, ...doc }] : [] };
}

/** Intent and the pending local record commit before any Google request. */
export async function executeMeetingCommand(env: ServerEnv, principal: OperationPrincipal, command: MeetingCommand, input: unknown, key: string, expectedVersions: Record<string, number> = {}) {
  const db = env.DB;
  if (!db) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  const workspace = env.WORKSPACE_ID || "default", raw = record(input), hash = await requestHash(command, input);
  const doc = await getDoc(db, workspace, KEY), state = normalizeEngagementSnapshot((doc?.value ?? {}) as object);
  const previousReceipt = await receipt(db, workspace, principal.id, key, command, hash);
  if (previousReceipt) {
    const saved = previousReceipt.result as { meetingId: string; operationId?: string; company: string };
    await authorizeOperation(db, workspace, principal, { action: "reunioes.agendar", scope: "meetings:write", company: saved.company });
    if (saved.operationId) await resumeMeetingOperation(env, principal, saved.operationId);
    return response(db, workspace, principal, saved.meetingId, saved.operationId);
  }
  const existing = command === "meetings.create" ? undefined : projectMeetings(state).find(m => m.id === raw.meetingId);
  if (command !== "meetings.create" && !existing) throw new OperationError(404, "meeting_not_found", "Reunião não encontrada.");
  if (existing?.schedulingStatus === "pending" || existing?.schedulingStatus === "uncertain") throw new OperationError(409, "meeting_operation_pending", "Retome a operação pendente desta reunião antes de editá-la.");
  if (existing?.cancelledAt) throw new OperationError(409, "meeting_cancelled", "A reunião já está cancelada.");
  const patch = command === "meetings.create" ? record(raw.meeting) : command === "meetings.reschedule" ? record(raw.patch ?? { startsAt: raw.startsAt, durationMin: raw.durationMin }) : command === "meetings.update" ? record(raw.patch) : {};
  const meeting = normalizeMeeting(patch, existing, principal);
  const authGuards = await authorizeOperation(db, workspace, principal, { action: "reunioes.agendar", scope: "meetings:write", company: meeting.company });
  const clientsDoc = await getDoc(db, workspace, "ontology.clients.v3");
  const clients = projectClients((clientsDoc?.value ?? {}) as Partial<ClientsSnapshot>);
  if (!clients.clients.some(c => c.slug === meeting.company)) throw new OperationError(404, "client_not_found", "Cliente ativo não encontrado.");
  if (meeting.enrollmentIds?.some(id => !clients.enrollments.some(e => e.id === id && e.company === meeting.company))) throw invalid("Contratação não pertence ao cliente.");
  const external = command === "meetings.create" ? raw.sendInvites === true : Boolean(existing?.google?.eventId) && command !== "meetings.update";
  if (command === "meetings.update" && existing?.google?.eventId && ["title", "startsAt", "durationMin", "attendeeIds", "guests", "summary", "notes", "place", "modality"].some(k => canonical(meeting[k as keyof Meeting]) !== canonical(existing[k as keyof Meeting])))
    throw invalid("Use reagendar para alterar o evento e enviar as atualizações dos convites.");
  if (external && existing?.google?.eventId && (existing.modality ?? "online") !== (meeting.modality ?? "online"))
    throw invalid("Para trocar a modalidade de um evento Google, cancele-o e crie uma nova reunião.");
  if (external && principal.kind === "integration") throw new OperationError(403, "organizer_delegation_required", "Uma credencial de sistema não pode usar a agenda pessoal sem delegação.");
  if (external && existing && (existing.organizerEmail ?? existing.google?.organizer) !== principal.email) throw new OperationError(403, "organizer_required", "Somente o organizador pode alterar o evento Google.");
  if (external && !googleEnabled(env)) throw new OperationError(503, "google_unavailable", "Integração Google não configurada.");
  const stakeholderDoc = await getDoc(db, workspace, "ontology.stakeholders.v1");
  const stakeholders = projectStakeholders(stakeholderDoc?.value as StakeholdersSnapshot | undefined);
  const rosterKey = authGuards.find(g => g.key.startsWith("ontology.workspace."))!.key;
  const rosterDoc = await getDoc(db, workspace, rosterKey);
  const roster = (rosterDoc?.value ?? {}) as { extraMembers?: Person[]; memberEdits?: Record<string, Partial<Person>>; deactivatedIds?: string[] };
  const members = [...people.filter(p => p.org === "praxis"), ...(roster.extraMembers ?? [])].map(p => ({ ...p, ...roster.memberEdits?.[p.id] })).filter(p => !roster.deactivatedIds?.includes(p.id));
  const emails: string[] = [];
  for (const id of (command === "meetings.cancel" || (command === "meetings.update" && patch.attendeeIds === undefined) ? [] : meeting.attendeeIds)) {
    const person = members.find(m => m.id === id) ?? stakeholders.find(s => s.id === id && s.company === meeting.company && s.active);
    if (!person) throw invalid("Participante inexistente, inativo ou de outro cliente.");
    if (external && (!person.email || !validEmail(person.email))) throw invalid("Todos os convidados precisam de e-mail válido para receber convite.");
    if (person.email) emails.push(person.email);
  }
  const hasExecutionReference = Boolean(meeting.cycleId || meeting.deliveryId);
  const activeSlice = hasExecutionReference
    ? await readActiveCompanySlice(db, workspace, meeting.company) : null;
  const needsDeliveryGuard = hasExecutionReference || expectedVersions["ontology.delivery.v2"] !== undefined;
  const deliveryDoc = !needsDeliveryGuard ? null : activeSlice
    ? { value: activeSlice.snapshot, version: activeSlice.version }
    : await getDoc(db, workspace, "ontology.delivery.v2");
  if (meeting.cycleId || meeting.deliveryId) {
    const delivery = projectDelivery((deliveryDoc?.value ?? {}) as Partial<DeliverySnapshot>, meeting.company);
    if (meeting.cycleId && !delivery.cycles.some(c => c.id === meeting.cycleId)) throw invalid("Ciclo não pertence ao cliente.");
    if (meeting.deliveryId && !delivery.tasks.some(d => d.id === meeting.deliveryId)) throw invalid("Tarefa não pertence ao cliente.");
  }
  const guards = uniqueGuards([...authGuards, { key: KEY, version: doc?.version ?? 0 }, { key: "ontology.clients.v3", version: clientsDoc?.version ?? 0 }, { key: rosterKey, version: rosterDoc?.version ?? 0 }, { key: "ontology.stakeholders.v1", version: stakeholderDoc?.version ?? 0 }, ...(needsDeliveryGuard ? [{ key: "ontology.delivery.v2", version: deliveryDoc?.version ?? 0 }] : [])]);
  for (const guard of guards) if (expectedVersions[guard.key] !== undefined && expectedVersions[guard.key] !== guard.version) throw new OperationError(412, "version_conflict", "O registro foi alterado. Atualize antes de salvar.");
  const operationId = crypto.randomUUID(), now = new Date().toISOString();
  if (command === "meetings.cancel") { meeting.cancelledAt = now; if (meeting.google) meeting.google = { ...meeting.google, cancelled: true }; }
  const pending: Meeting = external ? { ...(existing ?? meeting), schedulingStatus: "pending", operationId, updatedAt: now } : { ...meeting, schedulingStatus: "complete", operationId };
  let intent: CalendarIntent | undefined;
  if (external) {
    const connection = await getConnection(db, workspace, principal.email);
    if (!connection || connection.status !== "connected" || connection.account_email.toLowerCase() !== principal.email.toLowerCase()) throw new OperationError(409, "google_connection_required", "Conecte sua própria conta Google antes de enviar convites.");
    const timeZone = typeof raw.timeZone === "string" ? raw.timeZone : "America/Sao_Paulo";
    try { new Intl.DateTimeFormat("en", { timeZone }); } catch { throw invalid("Fuso horário inválido."); }
    intent = { organizer: principal.email, previous: existing?.google ? { ...existing.google, ...(typeof raw.expectedGoogleEtag === "string" ? { etag: raw.expectedGoogleEtag } : {}) } : undefined, event: { requestId: operationId, eventId: await requestHash("calendar.event", { workspace, operationId }), title: meeting.title, description: meeting.notes || meeting.summary, location: meeting.place, startsAt: meeting.startsAt, endsAt: new Date(Date.parse(meeting.startsAt) + meeting.durationMin * 60000).toISOString(), timeZone, attendees: eventAttendees([...emails, ...(meeting.guests ?? [])], principal.email), withMeet: meeting.modality !== "presencial" } };
  }
  const saved = { meetingId: meeting.id, company: meeting.company, ...(external ? { operationId } : {}) };
  const source = principal.channel ?? (principal.kind === "session" ? "interface" : "api");
  const statements = intent ? [db.prepare("INSERT INTO meeting_operations(id,workspace_id,principal_id,meeting_id,company,command,desired,pending_meeting,calendar_input,status,created_at,updated_at,actor_id,actor_email,actor_source,actor_application) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)")
    .bind(operationId, workspace, principal.id, meeting.id, meeting.company, command, JSON.stringify(meeting), JSON.stringify(pending), JSON.stringify(intent), now, now, principal.memberId, principal.email, source, principal.application)] : [];
  const committed = await commitOperation(db, { workspace, principal: principal.id, application: principal.application, actor: principal, key, command, hash, checked: true, id: operationId, guards, writes: [{ key: KEY, value: putMeetingSnapshot(state, pending) }], statements,
    events: command === "meetings.create" ? [{ type: "meeting.created", company: meeting.company, subject: meeting.id }] : external ? [] : [{ type: command === "meetings.cancel" ? "meeting.cancelled" : "meeting.updated", company: meeting.company, subject: meeting.id }], result: saved }) as typeof saved;
  if (committed.operationId) await resumeMeetingOperation(env, principal, committed.operationId);
  return response(db, workspace, principal, committed.meetingId, committed.operationId);
}

/** Safe to call again after a timeout: Google identity/operation markers prevent duplicate invitations. */
export async function resumeMeetingOperation(env: ServerEnv, principal: OperationPrincipal, operationId: string) {
  const db = env.DB!, workspace = env.WORKSPACE_ID || "default";
  const journal = await db.prepare("SELECT * FROM meeting_operations WHERE workspace_id=? AND id=? AND principal_id=?").bind(workspace, operationId, principal.id).first<Journal>();
  if (!journal) throw new OperationError(404, "operation_not_found", "Operação não encontrada.");
  await authorizeOperation(db, workspace, principal, { action: "reunioes.agendar", scope: "meetings:write", company: journal.company });
  if (journal.status === "complete") return response(db, workspace, principal, journal.meeting_id, operationId);
  if (principal.kind === "integration") throw new OperationError(403, "organizer_required", "Esta operação exige a identidade do organizador.");
  const owner = crypto.randomUUID();
  const claimed = await db.prepare("UPDATE meeting_operations SET lease_owner=?,lease_until=? WHERE workspace_id=? AND id=? AND status!='complete' AND lease_until<?")
    .bind(owner, Date.now() + 120000, workspace, operationId, Date.now()).run();
  if (!claimed.meta.changes) return response(db, workspace, principal, journal.meeting_id, operationId);
  const intent = JSON.parse(journal.calendar_input) as CalendarIntent;
  if (intent.organizer !== principal.email) throw new OperationError(403, "organizer_required", "Organizador incompatível.");
  try {
    let result: MeetingGoogle;
    if (journal.external_result) result = JSON.parse(journal.external_result);
    else {
      result = journal.command === "meetings.create"
        ? await createCalendarEvent(env, db, workspace, principal.email, intent.event)
        : await changeCalendarEvent(env, db, workspace, principal.email, { operationId, eventId: intent.previous!.eventId!, calendarId: intent.previous!.calendarId || "primary", expectedEtag: intent.previous?.etag, cancel: journal.command === "meetings.cancel", event: intent.event });
      await db.prepare("UPDATE meeting_operations SET external_result=?,updated_at=? WHERE workspace_id=? AND id=? AND lease_owner=?")
        .bind(JSON.stringify(result), new Date().toISOString(), workspace, operationId, owner).run();
    }
    // Chamada ao Google concluída: revalidar permissões e reunião no banco.
    forgetDocuments(db);
    const guards = await authorizeOperation(db, workspace, principal, { action: "reunioes.agendar", scope: "meetings:write", company: journal.company });
    const doc = await getDoc(db, workspace, KEY), state = normalizeEngagementSnapshot((doc?.value ?? {}) as object);
    const current = projectMeetings(state).find(m => m.id === journal.meeting_id);
    if (!current || canonical(current) !== canonical(JSON.parse(journal.pending_meeting))) throw new OperationError(409, "meeting_changed", "A reunião local mudou. Reconcilie a operação antes de continuar.");
    const desired = JSON.parse(journal.desired) as Meeting;
    const complete: Meeting = { ...desired, schedulingStatus: "complete", operationId, updatedAt: new Date().toISOString(), google: { ...desired.google, ...result, syncedAt: new Date().toISOString() }, ...(journal.command === "meetings.create" && result.meetLink ? { place: result.meetLink } : {}) };
    const originalActor = {
      memberId: journal.actor_id ?? principal.memberId,
      email: journal.actor_email ?? principal.email,
      kind: principal.kind,
      channel: journal.actor_source ?? principal.channel,
    };
    await commitOperation(db, { workspace, principal: journal.principal_id, application: journal.actor_application ?? principal.application, actor: originalActor, key: `meeting-complete:${operationId}`, command: "meetings.complete", hash: operationId, id: crypto.randomUUID(), guards: uniqueGuards([...guards, { key: KEY, version: doc?.version ?? 0 }]), writes: [{ key: KEY, value: putMeetingSnapshot(state, complete) }],
      events: [{ type: journal.command === "meetings.create" ? "meeting.scheduled" : journal.command === "meetings.cancel" ? "meeting.cancelled" : "meeting.rescheduled", company: journal.company, subject: journal.meeting_id }],
      statements: [db.prepare("UPDATE meeting_operations SET status='complete',lease_until=0,error=NULL,updated_at=? WHERE workspace_id=? AND id=? AND lease_owner=?").bind(new Date().toISOString(), workspace, operationId, owner)], result: { meetingId: journal.meeting_id } });
  } catch {
    // No raw provider response or token is persisted. The outcome may already exist remotely.
    await db.prepare("UPDATE meeting_operations SET status='uncertain',lease_until=0,error=?,updated_at=? WHERE workspace_id=? AND id=? AND lease_owner=?")
      .bind("Resultado pendente de confirmação. Retome a mesma operação para reconciliar sem duplicar convites.", new Date().toISOString(), workspace, operationId, owner).run();
  }
  return response(db, workspace, principal, journal.meeting_id, operationId);
}

/** Business reads never return the raw engagement snapshot to scoped integrations. */
export async function readMeetings(env: ServerEnv, principal: OperationPrincipal, filter: { company?: string; meetingId?: string } = {}) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  const workspace = env.WORKSPACE_ID || "default";
  const doc = await getDoc(env.DB, workspace, KEY);
  const rows = projectMeetings((doc?.value ?? {}) as object).filter(m => (!filter.company || m.company === filter.company) && (!filter.meetingId || m.id === filter.meetingId));
  const permitted = rows.filter(m => principal.companies === null || principal.companies.includes(m.company));
  for (const company of new Set(permitted.map(m => m.company))) await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "meetings:read", company });
  // Also validate empty lists: missing permission must not be mistaken for an empty result.
  if (!permitted.length) await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "meetings:read", company: filter.company ?? principal.companies?.[0] });
  return { items: permitted, version: doc?.version ?? 0 };
}
export async function readMeetingOperation(env: ServerEnv, principal: OperationPrincipal, operationId: string) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  const workspace = env.WORKSPACE_ID || "default";
  const op = await env.DB.prepare("SELECT id,meeting_id,company,status,error,updated_at FROM meeting_operations WHERE workspace_id=? AND id=?")
    .bind(workspace, operationId).first<{ id: string; meeting_id: string; company: string; status: string; error: string | null; updated_at: string }>();
  if (!op) throw new OperationError(404, "operation_not_found", "Operação não encontrada.");
  await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "meetings:read", company: op.company });
  return { operation: op };
}
