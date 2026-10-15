import { STAKEHOLDERS_INITIAL } from "../../modules/clients/infrastructure/stakeholders-snapshot.ts";
import { meetings as seedMeetings, threads as seedThreads } from "../../modules/engagement/infrastructure/seed.ts";
import { OperationError } from "./errors.ts";
import { canonical } from "./transaction.ts";

/** Exact supported keys: future versions and private authorization markers are not public snapshots. */
const WRITABLE = new Set([
  "ontology.workspace.v3", "ontology.clients.v3", "ontology.catalog.v2",
  "ontology.delivery.v2", "ontology.engagement.v2", "ontology.documents.v3",
  "ontology.knowledge.v2", "ontology.stakeholders.v1", "ontology.relationship.v1",
]);
const READABLE = new Set([...WRITABLE, "ontology.workspace.v2", "ontology.clients.v2", "ontology.documents.v2", "ontology.praxis.v1", "ontology.services.v1"]);
export function supportedStateKey(key: string, write = false) {
  return (write ? WRITABLE : READABLE).has(key);
}
/** Old browser snapshots may omit new operation-owned fields, but cannot change them. */
export function protectOperationFields(key: string, current: unknown, incoming: unknown, options: { workspaceInitialization?: boolean } = {}): unknown {
  if (key === "ontology.stakeholders.v1") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422,"invalid_snapshot","Stakeholders inválidos.");
    const next={...incoming as Record<string,unknown>},before=(current??{}) as Record<string,unknown>;
    const saved=before.contacts??STAKEHOLDERS_INITIAL.contacts;
    if(Object.hasOwn(next,"contacts")&&canonical(next.contacts)!==canonical(saved))throw new OperationError(409,"operation_required","Use as operações de stakeholders para alterar os contatos.");
    next.contacts=structuredClone(saved);
    return next;
  }
  if (key === "ontology.workspace.v3") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422,"invalid_snapshot","Workspace inválido.");
    const next={...incoming as Record<string,unknown>},before=(current??{}) as Record<string,unknown>;
    if(Object.hasOwn(next,"hidden")&&canonical(next.hidden)!==canonical(before.hidden??[]))throw new OperationError(409,"operation_required","Use a operação de ciência de alerta.");
    if(Object.hasOwn(before,"hidden"))next.hidden=structuredClone(before.hidden);
    if(!options.workspaceInitialization)for(const [field,fallback] of Object.entries({extraMembers:[],memberEdits:{},deactivatedIds:[],workspaceName:"",alertRules:{},memberRoles:[],allocationRoles:[]})){
      const saved=before[field]??fallback;
      if(Object.hasOwn(next,field)&&canonical(next[field])!==canonical(saved))throw new OperationError(409,"operation_required","Use as operações de equipe ou configurações do workspace.");
      if(Object.hasOwn(before,field))next[field]=structuredClone(saved);
    }
    return next;
  }
  if (key === "ontology.catalog.v2")
    throw new OperationError(409, "operation_required", "Use as operações de catálogo para salvar ou publicar produtos e planos.");
  if (key === "ontology.delivery.v2") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Execução inválida.");
    const next = {...incoming as Record<string,unknown>}, previous = (current ?? {}) as Record<string,unknown>;
    for (const field of ["productPlans", "companyJourneyVersion", "companyJourney", "companyMilestone", "cycleEdits", "extraCycles", "statusMap", "extraTasks", "taskPatches"]) {
      const saved = previous[field] ?? (["extraCycles","extraTasks"].includes(field) ? [] : {});
      if (Object.hasOwn(next,field) && canonical(next[field]) !== canonical(saved)) throw new OperationError(409, "operation_required", "Use as operações de tarefas, ciclos e planos para alterar a execução.");
      if (Object.hasOwn(previous, field)) next[field] = structuredClone(saved);
    }
    return next;
  }
  if (key === "ontology.knowledge.v2") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Ontologia inválida.");
    const next = structuredClone(incoming) as Record<string, unknown>, before = (current ?? {}) as Record<string, unknown>;
    if (Object.hasOwn(next, "ontologyDrafts") && canonical(next.ontologyDrafts) !== canonical(before.ontologyDrafts ?? {})) throw new OperationError(409, "operation_required", "Use as operações de ontologia para alterar o mapa do cliente.");
    if (Object.hasOwn(before, "ontologyDrafts")) next.ontologyDrafts = structuredClone(before.ontologyDrafts);
    return next;
  }
  if (key === "ontology.documents.v3") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Documentos inválidos.");
    const next = structuredClone(incoming) as Record<string, unknown>, before = (current ?? {}) as Record<string, unknown>;
    for (const field of ["extraDocs", "docEdits", "removedDocIds"]) {
      const saved = before[field] ?? (field === "docEdits" ? {} : []);
      if (Object.hasOwn(next, field) && canonical(next[field]) !== canonical(saved)) throw new OperationError(409, "operation_required", "Use as operações de documentos para alterar arquivos e metadados.");
      if (Object.hasOwn(before, field)) next[field] = structuredClone(before[field]);
    }
    return next;
  }
  if (key === "ontology.engagement.v2") return protectMeetingFields(current, incoming);
  if (key === "ontology.relationship.v1") return protectInteractionNotes(current, incoming);
  if (key !== "ontology.clients.v3") return incoming;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    throw new OperationError(422, "invalid_snapshot", "Cadastro de clientes inválido.");
  const next = { ...incoming as Record<string, unknown> };
  const previous = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  for (const [field, fallback] of Object.entries({ extraClients: [], clientEdits: {}, configs: {}, archivedClients: [], allocations: [], allocationsMigrated: false, assignments: {} })) {
    const saved = previous[field] ?? fallback;
    if (Object.hasOwn(next, field) && canonical(next[field]) !== canonical(saved)) throw new OperationError(409, "operation_required", "Use as operações de clientes e alocações para alterar cadastro, configuração ou equipe do cliente.");
    if (Object.hasOwn(previous, field)) next[field] = structuredClone(saved);
  }
  for (const field of ["enrollments", "participations"]) {
    const saved = previous[field] ?? [];
    if (Object.hasOwn(next, field) && canonical(next[field]) !== canonical(saved))
      throw new OperationError(409, "operation_required", "Contratações e participantes devem ser alterados pelas operações da plataforma.");
    next[field] = saved;
  }
  return next;
}

function protectMeetingFields(current: unknown, incoming: unknown) {
  const before = (current ?? {}) as Record<string, unknown>;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Reuniões inválidas.");
  const supplied = structuredClone(incoming) as Record<string, unknown>;
  for (const field of ["extraMeetings", "meetingEdits", "notes"]) if (!Object.hasOwn(supplied, field) && Object.hasOwn(before, field)) supplied[field] = structuredClone(before[field]);
  for (const field of ["extraPains", "painEdits", "removedPains", "extraSolutions", "solutionEdits", "removedSolutions", "extraHypotheses", "hypothesisEdits", "removedHypotheses"]) {
    const saved = before[field] ?? (field.endsWith("Edits") ? {} : []);
    if (Object.hasOwn(supplied, field) && canonical(supplied[field]) !== canonical(saved))
      throw new OperationError(409, "operation_required", "Use as operações de diagnóstico para alterar dores, soluções e hipóteses.");
    if (Object.hasOwn(before, field)) supplied[field] = structuredClone(before[field]);
  }
  for (const field of ["extraEvents", "eventEdits", "removedEvents"]) {
    const saved = before[field] ?? (field === "eventEdits" ? {} : []);
    if (Object.hasOwn(supplied, field) && canonical(supplied[field]) !== canonical(saved))
      throw new OperationError(409, "operation_required", "Use as operações de agenda para alterar eventos.");
    if (Object.hasOwn(before, field)) supplied[field] = structuredClone(before[field]);
  }
  for (const field of ["signalReviews", "signalClassifications"]) {
    const saved = before[field] ?? {};
    if (Object.hasOwn(supplied, field) && canonical(supplied[field]) !== canonical(saved))
      throw new OperationError(409, "operation_required", "Use as operações de sinais para alterar revisões e classificações.");
    if (Object.hasOwn(before, field)) supplied[field] = structuredClone(before[field]);
  }
  const next = protectActionLinks(before, supplied);
  const meetings = (doc: Record<string, unknown>) => [
    ...(Array.isArray(doc.extraMeetings) ? doc.extraMeetings : []),
    ...Object.values((doc.meetingEdits ?? {}) as object),
  ] as Record<string, unknown>[];
  const oldMeetings = meetings(before), nextMeetings = meetings(next);
  const refused = () => { throw new OperationError(409, "operation_required", "Use a operação de reunião para alterar o agendamento ou os convites."); };
  for (const meeting of nextMeetings) {
    const old = oldMeetings.find(m => m.id === meeting.id);
    if (!old?.operationId && (meeting.operationId || meeting.schedulingStatus || meeting.cancelledAt)) refused();
    const google = meeting.google as Record<string, unknown> | undefined;
    const oldGoogle = old?.google as Record<string, unknown> | undefined;
    const seed = seedMeetings.find(m => m.id === meeting.id);
    const source = (Array.isArray(before.extraMeetings) ? before.extraMeetings : []).find(m => m.id === meeting.id)
      ?? (seed ? (before.meetingEdits as Record<string, unknown> | undefined)?.[seed.id] ?? seed : undefined);
    const savedGoogle = ((source as Record<string, unknown> | undefined)?.google ?? {}) as Record<string, unknown>;
    for (const field of ["responses", "responsesAt", "recordingUrl", "transcriptUrl", "transcriptDocId", "artifactStatus", "lastArtifactCheckAt", "syncedAt"]) {
      if (google && Object.hasOwn(google, field) && canonical(google[field]) !== canonical(savedGoogle[field])) refused();
      if (Object.hasOwn(savedGoogle, field)) {
        meeting.google ??= {};
        (meeting.google as Record<string, unknown>)[field] = structuredClone(savedGoogle[field]);
      }
    }
    if (google?.eventId && google.eventId !== oldGoogle?.eventId) refused();
  }
  for (const old of oldMeetings.filter(m => m.operationId || (m.google as Record<string, unknown> | undefined)?.eventId)) {
    const updated = nextMeetings.find(m => m.id === old.id);
    if (!updated) refused();
    if (old.schedulingStatus === "pending" || old.schedulingStatus === "uncertain") {
      if (canonical(old) !== canonical(updated)) refused();
      continue;
    }
    const fields = ["operationId", "schedulingStatus", "cancelledAt", "company", "organizerEmail", "title", "startsAt", "durationMin", "attendeeIds", "guests", "modality", "place"];
    if (fields.some(field => canonical(old[field]) !== canonical(updated![field]))) refused();
    const google = (old.google ?? {}) as Record<string, unknown>, nextGoogle = (updated!.google ?? {}) as Record<string, unknown>;
    if (["eventId", "calendarId", "organizer", "etag", "cancelled"].some(field => canonical(google[field]) !== canonical(nextGoogle[field]))) refused();
  }
  // All remote meeting writers now use commands. Existing omission repairs run
  // first so older clients can still save unrelated engagement entities.
  for (const field of ["extraMeetings", "meetingEdits", "notes"]) {
    const fallback = field === "extraMeetings" ? [] : {};
    const normalized = (value: unknown) => {
      const meeting = (row: Record<string, unknown>) => ({ ...row, ...(Array.isArray(row.actions) ? { actions: row.actions.map((action, index) => ({ ...action, id: action.id ?? `${row.id}-a${index + 1}` })) } : {}) });
      if (field === "extraMeetings" && Array.isArray(value)) return value.map(meeting);
      if (field === "meetingEdits" && value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([id, row]) => [id, meeting(row as Record<string, unknown>)]));
      return value;
    };
    if (canonical(normalized(next[field] ?? fallback)) !== canonical(normalized(before[field] ?? fallback)))
      throw new OperationError(409, "operation_required", "Use as operações de reunião para alterar seu conteúdo.");
  }
  return next;
}

/** Match the stable legacy IDs used by withActionIds, including seeded meetings. */
function protectActionLinks(before: Record<string, unknown>, incoming: unknown): Record<string, unknown> {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Reuniões inválidas.");
  type Row = Record<string, unknown>;
  const next = structuredClone(incoming) as Row;
  const refused = () => { throw new OperationError(409, "operation_required", "Use a operação da ação da reunião para criar ou alterar seu vínculo com uma tarefa."); };
  const actions = (meeting: Row) => (Array.isArray(meeting.actions) ? meeting.actions : []).map((action, index) => ({ ...action, id: action.id ?? `${meeting.id}-a${index + 1}` })) as Row[];
  const project = (doc: Row) => {
    // Match projectMeetings: extras are independent; only seed meetings take
    // full replacement edits. A non-seed edit must never mask an extra row.
    const edits = (doc.meetingEdits ?? {}) as Row;
    const extras = (Array.isArray(doc.extraMeetings) ? doc.extraMeetings : []) as Row[];
    // Lifecycle protection must inspect tombstoned records too.
    const projected = [...extras, ...seedMeetings.map(m => (edits[m.id] ?? m) as Row)];
    const result = new Map<string, Row>();
    for (const meeting of projected) {
      const id = String(meeting.id);
      if (result.has(id)) refused();
      result.set(id, meeting);
    }
    return result;
  };
  const savedRemoved = before.removedMeetings ?? [];
  if (Object.hasOwn(next, "removedMeetings") && canonical(next.removedMeetings) !== canonical(savedRemoved)) refused();
  if (Object.hasOwn(before, "removedMeetings")) next.removedMeetings = structuredClone(savedRemoved);
  const previous = project(before);
  // An old client may omit hidden records entirely. Keep their original storage location.
  for (const id of Array.isArray(savedRemoved) ? savedRemoved : []) {
    const extra = (Array.isArray(before.extraMeetings) ? before.extraMeetings : []).find(row => row.id === id);
    if (extra) {
      const extras = (next.extraMeetings ?? []) as Row[];
      if (!extras.some(row => row.id === id)) next.extraMeetings = [...extras, structuredClone(extra)];
    } else {
      const oldEdit = (before.meetingEdits as Row | undefined)?.[id];
      if (oldEdit && !Object.hasOwn((next.meetingEdits ?? {}) as Row, id)) next.meetingEdits = { ...(next.meetingEdits ?? {}) as Row, [id]: structuredClone(oldEdit) };
    }
  }
  const restore = (row: Row, id: string) => {
    const prior = previous.get(id), oldActions = prior ? actions(prior) : [];
    for (const field of ["removedAt", "removedBy", "restoredAt", "restoredBy"]) {
      if (Object.hasOwn(row, field) && canonical(row[field]) !== canonical(prior?.[field])) refused();
      if (prior && Object.hasOwn(prior, field)) row[field] = structuredClone(prior[field]);
    }
    if (!Object.hasOwn(row, "actions") && oldActions.some(a => a.deliveryId || a.removedAt)) row.actions = structuredClone(prior!.actions);
    if (!Array.isArray(row.actions)) return;
    const seen = new Set<unknown>();
    const originalActions = row.actions as Row[];
    if (oldActions.some(action => action.deliveryId || action.removedAt) && originalActions.some(action => action.id === undefined)) {
      // Positional IDs identify historical actions only while their identity and
      // order are unchanged. A checkbox may change; structural edits need IDs.
      const identity = (action: Row) => ({ text: action.text, ownerId: action.ownerId, dueAt: action.dueAt });
      if (originalActions.length !== oldActions.length || originalActions.some((action, index) =>
        canonical(identity(action)) !== canonical(identity(oldActions[index])) ||
        (action.id !== undefined && action.id !== oldActions[index].id))) refused();
    }
    row.actions = actions({ ...row, id }).map((action, index) => {
      if (seen.has(action.id)) refused();
      seen.add(action.id);
      const old = oldActions.find(a => a.id === action.id);
      for (const field of ["removedAt", "removedBy"]) {
        if (Object.hasOwn(action, field) && canonical(action[field]) !== canonical(old?.[field])) refused();
        if (old && Object.hasOwn(old, field)) action[field] = structuredClone(old[field]);
      }
      if (Object.hasOwn(action, "deliveryId")) {
        if (canonical(action.deliveryId) !== canonical(old?.deliveryId)) refused();
      } else if (old?.deliveryId) action.deliveryId = old.deliveryId;
      if (old?.removedAt && canonical(action) !== canonical(old)) refused();
      // Derive identity for comparison without forcing migrations into unrelated writes.
      return { ...originalActions[index], ...Object.fromEntries(["deliveryId", "removedAt", "removedBy"].filter(field => action[field] !== undefined).map(field => [field, action[field]])) };
    });
    const receivedIds = new Set(actions({ ...row, id }).map(action => action.id));
    for (const old of oldActions.filter(action => action.removedAt && !receivedIds.has(action.id))) (row.actions as Row[]).splice(oldActions.indexOf(old), 0, structuredClone((prior!.actions as Row[])[oldActions.indexOf(old)]));
  };
  for (const row of (Array.isArray(next.extraMeetings) ? next.extraMeetings : []) as Row[]) restore(row, String(row.id));
  for (const [id, row] of Object.entries((next.meetingEdits ?? {}) as Row)) restore(row as Row, id);
  const projected = project(next);
  for (const [id, old] of previous) for (const action of actions(old).filter(a => a.deliveryId || a.removedAt)) {
    const updated = projected.get(id);
    const updatedAction = updated && actions(updated).find(a => a.id === action.id);
    if (!updatedAction || updatedAction.deliveryId !== action.deliveryId || (action.removedAt && canonical(updatedAction) !== canonical(action))) refused();
  }
  return next;
}

/** Relationship writers use commands; preserve older clients that omit protected data. */
function protectInteractionNotes(current: unknown, incoming: unknown): unknown {
  type Row = Record<string, unknown>;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new OperationError(422, "invalid_snapshot", "Interações inválidas.");
  const before = (current ?? {}) as Row, next = structuredClone(incoming) as Row;
  const refused = () => { throw new OperationError(409, "operation_required", "Use as operações de interações para alterar notas do cliente e seus anexos."); };
  for (const field of ["spaces", "notes", "read", "unread", "pinned"]) if (!Object.hasOwn(next, field) && Object.hasOwn(before, field)) next[field] = structuredClone(before[field]);
  const oldSpaces = (Array.isArray(before.spaces) ? before.spaces : []) as Row[];
  const protectedSpaces = [...seedThreads, ...oldSpaces].filter(space => space.kind === "notes") as Row[];
  const protectedById = new Map(protectedSpaces.map(space => [String(space.id), space]));
  const incomingSpaces = (Array.isArray(next.spaces) ? next.spaces : []) as Row[];
  for (const space of incomingSpaces) {
    const old = protectedById.get(String(space.id));
    if ((old && canonical(old) !== canonical(space)) || (!old && space.kind === "notes")) refused();
  }
  const restoredSpaces = oldSpaces.filter(space => protectedById.has(String(space.id)) && !incomingSpaces.some(row => row.id === space.id));
  if (restoredSpaces.length) next.spaces = [...incomingSpaces, ...structuredClone(restoredSpaces)];
  const oldNotes = (before.notes ?? {}) as Row, nextNotes = (next.notes ?? {}) as Row;
  const owners = new Map<string, string>();
  for (const space of protectedSpaces) {
    const id = String(space.id), saved = oldNotes[id] ?? [];
    if (Object.hasOwn(nextNotes, id) && canonical(nextNotes[id]) !== canonical(saved)) refused();
    if (Object.hasOwn(oldNotes, id)) nextNotes[id] = structuredClone(saved);
    for (const note of [...(Array.isArray(space.messages) ? space.messages : []), ...(Array.isArray(saved) ? saved : [])] as Row[]) {
      if (typeof note.id === "string") owners.set(note.id, id);
    }
  }
  if (Object.keys(nextNotes).length || Object.hasOwn(next, "notes")) next.notes = nextNotes;
  const rejectMoved = (thread: string, messages: unknown, embedded: boolean) => {
    for (const note of (Array.isArray(messages) ? messages : []) as Row[]) {
      if (typeof note.id !== "string" || !owners.has(note.id)) continue;
      if (owners.get(note.id) !== thread || (embedded && !protectedById.has(thread))) refused();
    }
  };
  for (const [id, notes] of Object.entries(nextNotes)) rejectMoved(id, notes, false);
  for (const space of incomingSpaces) rejectMoved(String(space.id), space.messages, true);
  for (const field of ["spaces", "notes", "read", "unread", "pinned"]) {
    const saved = before[field] ?? (field === "notes" ? {} : []);
    if (Object.hasOwn(next, field) && canonical(next[field]) !== canonical(saved)) refused();
    if (Object.hasOwn(before, field)) next[field] = structuredClone(before[field]);
  }
  return next;
}
