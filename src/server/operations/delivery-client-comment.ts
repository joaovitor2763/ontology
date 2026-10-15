import type { ServerEnv } from '../context.ts';
import { getDoc } from '../db.ts';
import { encodeCompressedStateBody, decodeStateBody } from '../state-body.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery,
  type DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { mergeTaskOverride } from '../../modules/delivery/domain/task-overrides.ts';
import type { Delivery, DeliveryHistoryEntry } from '../../modules/delivery/domain/models.ts';
import { deliveryMapOrder } from '../delivery-client-slices.ts';
import { changedScheduleError, deliveryPatchError } from '../../modules/delivery/domain/delivery-policy.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { currentDocuments, type ClientDocument } from '../../modules/documents/domain/models.ts';
import { documents as seedDocuments } from '../../modules/documents/infrastructure/seed.ts';
import { recordHistory } from '../../modules/delivery/domain/history.ts';
import { scheduledExecution } from '../../modules/delivery/application/task-deadlines.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { historyObservations } from '../delivery-history.ts';
import { clientEffectiveStatements, readClientEffectiveHead } from './delivery-client-effective-sync.ts';
import { clientPlanClaimStatements, readClientPlanClaimHead } from './delivery-client-plan-claims.ts';
import { clientDeadlineStatements, readClientDeadlineHead } from './delivery-client-deadline-dependencies.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';
import { id, invalid, object, string } from './input.ts';
import { commitOperation, receipt, requestHash, type VersionGuard } from './transaction.ts';
import { markSliceWrite } from './delivery-client-summary-sync.ts';

const DELIVERY = 'ontology.delivery.v2';
type ActiveRow = { generation: string; mode: string; compatibility_version: number;
  source_delivery_version: number; source_clients_version: number;
  delivery_version: number | null; clients_version: number | null;
  company: string | null; revision: number | null; incarnation: string | null; body: string | null;
  body_sha256: string | null };
const hash = async (plain: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const changed = () => new OperationError(503, 'execution_snapshot_incomplete',
  'A execução está sendo atualizada. Tente novamente.');

/** Fast path for comments on active client authority. */
export async function tryActiveTaskComment(
  env: ServerEnv, principal: OperationPrincipal, input: unknown, key: string,
  expectedVersions: Record<string, number>,
  expectedClientSnapshot?: string,
): Promise<{ data: unknown; documents: []; clientSnapshot?: string } | null> {
  if (!env.DB) return null;
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  const raw = object(input);
  if (Object.keys(raw).some(field => field !== 'taskId' && field !== 'text'))
    invalid('O pedido contém campos que não podem ser alterados por esta operação.');
  const taskId = id(raw.taskId), text = string(raw.text, 'comentário', undefined, 10000);
  if (!text) invalid('Escreva o comentário.');
  const hashRequest = await requestHash('tasks.comment', input);
  const previous = await receipt(db, workspace, principal.id, key, 'tasks.comment', hashRequest);
  if (previous) {
    const saved = previous.result as { data: unknown; companies: string[]; clientSnapshot?: string };
    for (const company of saved.companies) await authorizeOperation(db, workspace, principal,
      { action: 'entregas.editar', scope: 'delivery:write', company });
    return { data: saved.data, documents: [],
      ...(saved.clientSnapshot ? { clientSnapshot: saved.clientSnapshot } : {}) };
  }
  const row = await db.prepare(`SELECT m.generation,m.mode,m.compatibility_version,
      m.source_delivery_version,m.source_clients_version,
      d.version AS delivery_version,c.version AS clients_version,
      o.company,s.revision,s.incarnation,s.body,s.body_sha256
    FROM delivery_client_shadow_meta m
    LEFT JOIN state_documents d ON d.workspace_id=m.workspace_id AND d.key='ontology.delivery.v2'
    LEFT JOIN state_documents c ON c.workspace_id=m.workspace_id AND c.key='ontology.clients.v3'
    LEFT JOIN delivery_entity_owners o ON o.workspace_id=m.workspace_id
      AND o.generation=m.generation AND o.kind='task' AND o.id=?
    LEFT JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
      AND s.generation=m.generation AND s.company=o.company
    WHERE m.workspace_id=?`).bind(taskId, workspace).first<ActiveRow>();
  if (!row || row.mode !== 'active') return null;
  if (row.delivery_version !== row.source_delivery_version ||
      row.clients_version !== row.source_clients_version) throw changed();
  if (!row.company) throw new OperationError(404, 'task_not_found', 'Tarefa não encontrada.');
  if (!row.body || row.revision === null || !row.incarnation || !row.body_sha256) throw changed();
  const before = await decodeStateBody(row.body) as DeliverySnapshot;
  if (await hash(JSON.stringify(before)) !== row.body_sha256) throw changed();
  const authGuards = await authorizeOperation(db, workspace, principal,
    { action: 'entregas.editar', scope: 'delivery:write', company: row.company });
  const currentClientSnapshot = `${row.generation}:${row.incarnation}:${row.revision}`;
  if (expectedClientSnapshot && expectedClientSnapshot !== currentClientSnapshot)
    throw new OperationError(409, 'snapshot_changed',
      'A execução do cliente mudou. Atualize antes de salvar.',
      { clientSnapshot: currentClientSnapshot });
  const [clientsDoc, catalogDoc, contactsDoc, documentsDoc] = await Promise.all([
    getDoc(db, workspace, 'ontology.clients.v3'),
    getDoc(db, workspace, 'ontology.catalog.v2'),
    getDoc(db, workspace, 'ontology.stakeholders.v1'),
    getDoc(db, workspace, 'ontology.documents.v3'),
  ]);
  const clients = projectClients((clientsDoc?.value ?? {}) as object);
  if (!clients.clients.some(client => client.slug === row.company))
    throw new OperationError(404, 'client_not_found', 'Cliente não encontrado ou arquivado.');
  const state = normalizeDeliverySnapshot(before);
  const projected = projectDelivery(state, row.company);
  const current = projected.tasks.find(task => task.id === taskId);
  if (!current || current.company !== row.company)
    throw new OperationError(404, 'task_not_found', 'Tarefa não encontrada.');
  const cycle = projected.cycles.find(item => item.taskIds.includes(taskId));
  const effectiveScope = !current.enrollmentId && cycle?.enrollmentId
    ? { ...current, productId: current.productId ?? cycle.productId, enrollmentId: cycle.enrollmentId }
    : current;
  const enrollment = effectiveScope.enrollmentId
    ? clients.enrollments.find(item => item.id === effectiveScope.enrollmentId &&
      item.company === current.company && item.productId === effectiveScope.productId)
    : null;
  if (effectiveScope.enrollmentId && (!enrollment || !enrollmentCanReceiveWork(enrollment)))
    invalid('A contratação está encerrada ou arquivada e não pode receber alterações.');
  if (!effectiveScope.enrollmentId && effectiveScope.productId &&
      clients.enrollments.some(item => item.company === row.company &&
        item.productId === effectiveScope.productId) && !current.productId)
    invalid('Escolha explicitamente a contratação deste produto.');
  const rosterKey = authGuards.find(guard => guard.key.startsWith('ontology.workspace.'))?.key;
  if (!rosterKey) throw changed();
  const rosterDoc = await getDoc(db, workspace, rosterKey);
  const roster = (rosterDoc?.value ?? {}) as { extraMembers?: typeof people;
    memberEdits?: Record<string, Partial<(typeof people)[number]>>; deactivatedIds?: string[] };
  const members = [...people.filter(person => person.org === 'praxis'),
    ...(roster.extraMembers ?? [])].map(person => ({ ...person, ...roster.memberEdits?.[person.id] }))
    .filter(person => !roster.deactivatedIds?.includes(person.id));
  const contacts = projectStakeholders(contactsDoc?.value as Parameters<typeof projectStakeholders>[0]);
  if (!members.some(member => member.id === current.ownerId) &&
      !contacts.some(contact => contact.company === row.company && contact.id === current.ownerId && contact.active))
    invalid('Escolha um responsável ativo da equipe ou deste cliente.');
  if (current.productId && !projectCatalog((catalogDoc?.value ?? {}) as object)
    .products.some(product => product.id === current.productId)) invalid('Produto não encontrado.');
  if (cycle && (current.company !== cycle.company ||
      (current.productId && current.productId !== cycle.productId) ||
      (current.enrollmentId && current.enrollmentId !== cycle.enrollmentId)))
    invalid('A tarefa e o ciclo precisam pertencer ao mesmo cliente, produto e contratação.');
  const documents = (documentsDoc?.value ?? {}) as { extraDocs?: ClientDocument[];
    removedDocIds?: string[]; docEdits?: Record<string, Partial<ClientDocument>> };
  const activeDocuments = currentDocuments([...seedDocuments, ...(documents.extraDocs ?? [])]
    .map(doc => ({ ...doc, ...documents.docEdits?.[doc.id] }))
    .filter(doc => !documents.removedDocIds?.includes(doc.id)));
  // A comment changes no field: only the closed-cycle rule on the status applies, never stored dates.
  const issue = deliveryPatchError({ status: current.status }, cycle, { current,
    linkedDocuments: activeDocuments.filter(doc => doc.company === row.company &&
      doc.relatedTaskId === taskId).length });
  if (issue) invalid(issue);
  const guards = new Map(authGuards.map(guard => [guard.key, guard.version]));
  for (const [key, doc] of [['ontology.clients.v3', clientsDoc],
    ['ontology.catalog.v2', catalogDoc], ['ontology.stakeholders.v1', contactsDoc],
    ['ontology.documents.v3', documentsDoc], [rosterKey, rosterDoc]] as const) {
    if (guards.has(key) && guards.get(key) !== (doc?.version ?? 0))
      throw new OperationError(409, 'version_conflict', 'Os dados mudaram durante a operação.');
    guards.set(key, doc?.version ?? 0);
  }
  if (expectedVersions[DELIVERY] !== undefined && expectedVersions[DELIVERY] !== row.compatibility_version)
    throw new OperationError(412, 'version_conflict', 'Os dados foram alterados. Atualize antes de salvar.');
  for (const [guardKey, version] of guards)
    if (expectedVersions[guardKey] !== undefined && expectedVersions[guardKey] !== version)
      throw new OperationError(412, 'version_conflict', 'Os dados foram alterados. Atualize antes de salvar.');
  const at = new Date().toISOString(), actor = principal.memberId;
  const patch: Partial<Delivery> = { comments: [...(current.comments ?? []),
    { id: `comment-${crypto.randomUUID()}`, text, by: actor, at }],
    history: [...(current.history ?? []), { field: 'comment', by: actor, at } satisfies DeliveryHistoryEntry] };
  const merged: Partial<Delivery> = { ...patch,
    history: [...(patch.history ?? []), ...recordHistory(current, patch, actor, at)] };
  let next: DeliverySnapshot = { ...state,
    extraTasks: state.extraTasks.map(item => item.id === taskId ? { ...item, ...merged } : item),
    taskPatches: { ...state.taskPatches,
      [taskId]: mergeTaskOverride(state.taskPatches[taskId] ?? {}, merged) },
  };
  const nextProjected = projectDelivery(next, row.company);
  for (const task of nextProjected.tasks) {
    const deadline = task.deadline;
    if (deadline?.mode !== 'task') continue;
    const parent = nextProjected.tasks.find(candidate => candidate.id === deadline.taskId);
    if (!parent) return null; // A legacy cross-client dependency needs full-workspace validation.
    if (task.enrollmentId && parent.enrollmentId !== task.enrollmentId)
      invalid('A referência de prazo deve pertencer à mesma contratação.');
  }
  try {
    next = scheduledExecution(next, nextProjected.tasks, nextProjected.cycles,
      Object.fromEntries(clients.allClients.map(client => [client.slug, client.startedAt])),
      Object.fromEntries(clients.enrollments.map(item => [item.id, item.startsAt])));
  } catch (error) { invalid(error instanceof Error ? error.message : 'Revise as dependências de prazo.'); }
  const finalTasks = projectDelivery(next, row.company).tasks;
  const final = finalTasks.find(task => task.id === taskId);
  if (!final) throw changed();
  const finalIssue = changedScheduleError(projected.tasks, finalTasks);
  if (finalIssue) invalid(finalIssue);
  const taskIds = new Set(nextProjected.tasks.map(task => task.id));
  const beforeHistory = new Set((await historyObservations(before, taskIds))
    .map(entry => `${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`));
  const additions = (await historyObservations(next, taskIds))
    .filter(entry => !entry.isLegacySummary &&
      !beforeHistory.has(`${entry.taskId}\u0000${entry.entryHash}\u0000${entry.occurrence}`));
  const priorMapOrder = deliveryMapOrder(before);
  const nextMapOrder = deliveryMapOrder(next);
  const newMapKeys = [...nextMapOrder.keys()].filter(identity => !priorMapOrder.has(identity));
  const plain = JSON.stringify(next), body = await encodeCompressedStateBody(next);
  const transactionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO delivery_client_guards
      (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
      VALUES(?,?,?,?,?,'active',?)`)
      .bind(transactionId, workspace, row.company, row.generation, row.revision, row.incarnation),
    markSliceWrite(db, workspace, db.prepare(`UPDATE delivery_client_snapshots SET revision=revision+1,body=?,body_sha256=?
      WHERE workspace_id=? AND generation=? AND company=? AND revision=? AND incarnation=?`)
      .bind(body, await hash(plain), workspace, row.generation, row.company, row.revision, row.incarnation),
    { company: row.company, generation: row.generation, revision: row.revision + 1,
      incarnation: row.incarnation, plain }),
  ];
  for (const identity of newMapKeys) {
    const [kind, id] = identity.split('\u0000');
    statements.push(db.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal)
      VALUES(?,?,?,?,(SELECT COALESCE(MAX(ordinal)+1,0) FROM delivery_client_map_order
        WHERE workspace_id=? AND generation=? AND kind=?))`)
      .bind(workspace, row.generation, kind, id, workspace, row.generation, kind));
  }
  statements.push(db.prepare(`UPDATE delivery_client_shadow_meta SET
    expected_map_order=expected_map_order+?,
    compatibility_version=compatibility_version+1,updated_at=?
    WHERE workspace_id=? AND generation=? AND mode='active'`)
    .bind(newMapKeys.length, at, workspace, row.generation));
  for (const entry of additions) statements.push(db.prepare(`INSERT INTO delivery_task_history
    (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,
     is_legacy_summary,source_first_version,source_last_version)
    SELECT ?,?,?,?,?,?,?,0,m.compatibility_version,m.compatibility_version
    FROM delivery_client_shadow_meta m WHERE m.workspace_id=? AND m.generation=? AND m.mode='active'`)
    .bind(workspace, entry.taskId, crypto.randomUUID(), entry.entryHash, entry.occurrence,
      entry.entryJson, entry.eventAt, workspace, row.generation));
  const claimHead = await readClientPlanClaimHead(db, workspace, row.company);
  statements.push(...clientPlanClaimStatements(db, workspace, row.company,
    row.generation, row.revision, row.incarnation, before, next, claimHead,
    Math.max(0, Math.min(200, 800 - statements.length - 1))));
  const deadlineHead = await readClientDeadlineHead(db, workspace, row.company);
  statements.push(...clientDeadlineStatements(db, workspace, row.company,
    row.generation, row.revision, row.incarnation, before, next, deadlineHead,
    Math.max(0, Math.min(200, 800 - statements.length - 1))));
  const effectiveHead = await readClientEffectiveHead(db, workspace, row.company);
  statements.push(...clientEffectiveStatements(db, workspace, row.company, row.generation,
    row.revision, row.incarnation, before, next, effectiveHead,
    Math.max(0, Math.min(400, 800 - statements.length))));
  statements.push(db.prepare('DELETE FROM delivery_client_guards WHERE transaction_id=?')
    .bind(transactionId));
  if (statements.length > 800) throw new OperationError(503, 'execution_write_too_large',
    'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
  const result = { data: { task: final }, companies: [row.company],
    clientSnapshot: `${row.generation}:${row.incarnation}:${row.revision + 1}` };
  const committed = await commitOperation(db, { workspace, principal: principal.id,
    application: principal.application, actor: principal, key, command: 'tasks.comment',
    hash: hashRequest, id: crypto.randomUUID(), guards: [
      ...[...guards].map(([key, version]) => ({ key, version })),
      ...(expectedVersions[DELIVERY] === undefined ? [] :
        [{ key: DELIVERY, version: expectedVersions[DELIVERY] }]),
    ] as VersionGuard[],
    writes: [], statements, events: [{ type: 'tasks.comment', company: row.company,
      subject: taskId, data: { command: 'tasks.comment', taskIds: [taskId] } }],
    result, checked: true }) as { data: unknown; companies: string[]; clientSnapshot: string };
  return { data: committed.data, documents: [], clientSnapshot: committed.clientSnapshot };
}
