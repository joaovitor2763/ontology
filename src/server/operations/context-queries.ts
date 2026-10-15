import type { ServerEnv } from "../context.ts";
import { getDoc } from "../db.ts";
import { prefetchDocuments } from "./request-context.ts";
import { resolveMember } from "../authz.ts";
import { authorizeOperation, type OperationPrincipal } from "./principal.ts";
import { type Credential, type IntegrationScope } from "./credentials.ts";
import { OperationError } from "./errors.ts";
import { normalizeAccess, type Action } from "../../modules/workspace/domain/permissions.ts";
import { projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import { projectStakeholders, type StakeholdersSnapshot } from "../../modules/clients/infrastructure/stakeholders-snapshot.ts";
import { projectDelivery, type DeliverySnapshot } from "../../modules/delivery/infrastructure/snapshot.ts";
import { projectMeetings, type EngagementSnapshot } from "../../modules/engagement/infrastructure/snapshot.ts";
import { normalizeCatalogSnapshot, projectCatalog, type CatalogSnapshot } from "../../modules/catalog/infrastructure/snapshot.ts";
import { scopedDeliverySnapshotWithVersion } from "./delivery-record-read.ts";

export type ContextQuery = "me" | "capabilities" | "client.context" | "client.stakeholder-map" | "product.versions";
const capabilities: { action: Action; scope: IntegrationScope }[] = [
  ...(["clients:read", "stakeholders:read", "enrollments:read", "delivery:read", "meetings:read", "catalog:read", "events:read", "documents:read"] as IntegrationScope[]).map(scope => ({ action: "clientes.ver" as const, scope })),
  { action: "clientes.criar", scope: "clients:write" },
  { action: "cliente.configurar", scope: "clients:write" },
  { action: "cliente.arquivar", scope: "clients:write" },
  { action: "alocacao.editar", scope: "clients:write" },
  { action: "cliente.configurar", scope: "enrollments:write" },
  { action: "stakeholders.editar", scope: "stakeholders:write" },
  { action: "stakeholders.editar", scope: "enrollments:write" },
  { action: "plano.editar", scope: "enrollments:write" },
  { action: "documentos.enviar", scope: "documents:write" },
  { action: "plano.editar", scope: "delivery:write" },
  { action: "ciclos.editar", scope: "delivery:write" },
  { action: "entregas.editar", scope: "delivery:write" },
  { action: "reunioes.agendar", scope: "meetings:write" },
  { action: "catalogo.editar", scope: "catalog:write" },
  { action: "configuracoes.editar", scope: "events:read" },
  { action: "configuracoes.editar", scope: "events:write" },
];
/** Discovery revalidates even when the caller retained an earlier principal. */
async function currentIdentity(db: D1Database, workspace: string, principal: OperationPrincipal) {
  let email = principal.email, scopes = principal.scopes, companies = principal.companies;
  let credential: Credential | null = null;
  if (principal.kind === "integration") {
    credential = await db.prepare("SELECT id,workspace_id,name,owner_member_id,owner_email,scopes,companies,created_by,created_at,expires_at,revoked_at FROM integration_credentials WHERE workspace_id=? AND id=?").bind(workspace, principal.application).first<Credential>();
    if (!credential || credential.revoked_at || Date.parse(credential.expires_at) <= Date.now()) throw new OperationError(401, "invalid_token", "Credencial inválida ou expirada.");
    email = credential.owner_email; scopes = JSON.parse(credential.scopes); companies = credential.companies ? JSON.parse(credential.companies) : null;
  } else if (principal.kind === "oauth") {
    if (!principal.oauthGrant) throw new OperationError(401, "invalid_token", "Conexão OAuth inválida.");
    const { validateOAuthGrant } = await import("./oauth.ts");
    scopes = (await validateOAuthGrant(db, workspace, principal.oauthGrant)).scopes;
    companies = null;
  }
  const { member } = await resolveMember(db, workspace, email);
  if (!member?.active || (credential && member.id !== credential.owner_member_id)) throw new OperationError(403, "inactive_member", "O responsável não possui acesso ativo à plataforma.");
  return { memberId: member.id, access: normalizeAccess(member.access), kind: principal.kind, application: principal.application, workspace, scopes, companies };
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new OperationError(422, "invalid_input", `Informe ${name}.`);
  return value;
}
/** Compact client projections; only an explicitly requested public catalog version includes its product definition. */
export async function readContextQuery(env: ServerEnv, principal: OperationPrincipal, query: ContextQuery, input: { company?: string; productId?: string; version?: number } = {}) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco de dados não configurado.");
  const db = env.DB, workspace = env.WORKSPACE_ID || "default";
  // Prefetch only shared documents; execution is fetched by authorized client below.
  prefetchDocuments(db, workspace, ["ontology.clients.v3",
    ...(query === "client.context" ? ["ontology.engagement.v2"] : []),
    ...(query === "client.stakeholder-map" ? ["ontology.stakeholders.v1", "ontology.engagement.v2"] : []),
    ...(query === "product.versions" ? ["ontology.catalog.v2"] : [])]);
  const identity = await currentIdentity(db, workspace, principal);
  const authorize = (scope: IntegrationScope, company?: string, action: Action = "clientes.ver") => authorizeOperation(db, workspace, principal, { scope, company, action });
  const allowed = async (scope: IntegrationScope, company?: string, action: Action = "clientes.ver") => {
    try { await authorize(scope, company, action); return true; }
    catch (error) { if (error instanceof OperationError && error.status === 403 && error.code !== "inactive_member") return false; throw error; }
  };
  if (query === "me") return { data: identity };
  if (query === "capabilities") {
    if (input.company) {
      if (identity.companies !== null && !identity.companies.includes(input.company)) throw new OperationError(403, "client_not_allowed", "A integração não possui acesso a este cliente.");
      const clients = projectClients((await getDoc(db, workspace, "ontology.clients.v3"))?.value as Partial<ClientsSnapshot> | undefined);
      if (!clients.allClients.some(c => c.slug === input.company)) throw new OperationError(404, "not_found", "Cliente não encontrado.");
    }
    const permissions = await Promise.all(capabilities.map(async item => ({ ...item, allowed: await allowed(item.scope, input.company, item.action) })));
    return { data: { identity, company: input.company ?? null, permissions, toolAvailability: "not_evaluated", semantics: "Permissões atuais; regras e pré-condições de cada operação continuam obrigatórias." } };
  }
  if (query === "product.versions") {
    await authorize("catalog:read", input.company);
    const productId = required(input.productId, "o produto");
    const doc = await getDoc(db, workspace, "ontology.catalog.v2");
    const catalog = normalizeCatalogSnapshot(doc?.value as Partial<CatalogSnapshot> | undefined);
    const product = projectCatalog(catalog).products.find(p => p.id === productId);
    if (!product) throw new OperationError(404, "not_found", "Produto não encontrado.");
    const currentVersion = product.version ?? 1;
    const history = catalog.productVersions[productId] ?? [];
    if (input.version !== undefined) {
      if (!Number.isInteger(input.version) || input.version < 1) throw new OperationError(422, "invalid_input", "Informe uma versão inteira positiva.");
      if (input.version === currentVersion) return { data: { productId, version: currentVersion, source: "current", product, documentVersion: doc?.version ?? 0 } };
      const version = history.find(v => v.version === input.version);
      if (!version) throw new OperationError(404, "not_found", "Versão do produto não encontrada.");
      return { data: { productId, version: version.version, source: "snapshot", at: version.at, product: version.snapshot, documentVersion: doc?.version ?? 0 } };
    }
    const definitions = [...history.filter(v => v.version !== currentVersion).map(v => ({ version: v.version, source: "snapshot", at: v.at, product: v.snapshot })), { version: currentVersion, source: "current", at: undefined, product }];
    return { data: { productId, documentVersion: doc?.version ?? 0, versions: definitions.sort((a, b) => a.version - b.version).map(v => ({ version: v.version, source: v.source, at: v.at, name: v.product.name, cycleCount: v.product.cycles.length, taskCount: v.product.cycles.reduce((n, c) => n + c.deliveries.length, 0), current: v.source === "current" })) } };
  }
  if (query !== "client.context" && query !== "client.stakeholder-map") throw new OperationError(404, "not_found", "Consulta não encontrada.");
  const company = required(input.company, "o cliente");
  await authorize(query === "client.context" ? "clients:read" : "stakeholders:read", company);
  if (query === "client.stakeholder-map") await authorize("enrollments:read", company);
  const clientsDoc = await getDoc(db, workspace, "ontology.clients.v3");
  const clients = projectClients(clientsDoc?.value as Partial<ClientsSnapshot> | undefined);
  const client = clients.allClients.find(c => c.slug === company);
  if (!client) throw new OperationError(404, "not_found", "Cliente não encontrado.");
  const enrollments = clients.enrollments.filter(e => e.company === company);
  if (query === "client.stakeholder-map") {
    const doc = await getDoc(db, workspace, "ontology.stakeholders.v1");
    const contacts = [...new Map(projectStakeholders(doc?.value as StakeholdersSnapshot | undefined).filter(s => s.company === company).map(s => [s.id, s])).values()];
    const people = contacts.map(s => ({ id: s.id, name: s.name, accountRole: s.accountRole, primary: s.primary, active: s.active, stance: s.stance, influence: s.influence }));
    const meetingAccess = await allowed("meetings:read", company);
    const meetingsDoc = meetingAccess ? await getDoc(db, workspace, "ontology.engagement.v2") : null;
    const meetings = meetingAccess ? projectMeetings(meetingsDoc?.value as Partial<EngagementSnapshot> | undefined).filter(m => m.company === company && !m.cancelledAt) : [];
    const map = enrollments.map(e => {
      const relationships = [...new Map(clients.participations.filter(p => p.company === company && p.enrollmentId === e.id).map(p => [p.stakeholderId, p])).values()];
      const participants = relationships.flatMap(p => {
        const person = contacts.find(s => s.id === p.stakeholderId);
        return person ? [{ stakeholderId: person.id, accountRole: p.accountRole, primary: p.primary, active: p.active && person.active, stance: p.stance, influence: p.influence }] : [];
      });
      const active = participants.filter(p => p.active), primaryCount = active.filter(p => p.primary).length;
      const linkedMeetings = meetings.filter(m => m.enrollmentIds?.includes(e.id));
      const invitedIds = new Set(linkedMeetings.flatMap(m => m.attendeeIds ?? []));
      const activeIds = new Set(active.map(p => p.stakeholderId));
      const meetingCoverage = meetingAccess ? {
        status: "available", basis: "recorded_invitees", meetingCount: linkedMeetings.length,
        activeParticipantsWithMeeting: active.filter(p => invitedIds.has(p.stakeholderId)).length,
        activeParticipantIdsWithoutMeeting: active.filter(p => !invitedIds.has(p.stakeholderId)).map(p => p.stakeholderId),
        meetingsWithoutActiveParticipants: linkedMeetings.filter(m => !(m.attendeeIds ?? []).some(id => activeIds.has(id))).length,
      } : { status: "unavailable", requiredScope: "meetings:read" };
      return { enrollmentId: e.id, productId: e.productId, status: e.status, archivedAt: e.archivedAt, lifecycleHistory: e.lifecycleHistory, participants,
        counts: { total: participants.length, active: active.length, activePrimary: primaryCount },
        gaps: { noActiveParticipants: active.length === 0, noActivePrimary: primaryCount === 0, multipleActivePrimaries: primaryCount > 1, unresolvedReferences: relationships.length - participants.length, unknownStance: active.filter(p => p.stance === undefined || p.stance === "desconhecido").length, unspecifiedInfluence: active.filter(p => p.influence === undefined).length }, meetingCoverage, expectedRoles: null };
    });
    const activeMemberships = new Map(people.map(p => [p.id, map.filter(e => e.participants.some(member => member.stakeholderId === p.id && member.active)).length]));
    const counts = { total: people.length, active: people.filter(p => p.active).length, shared: people.filter(p => (activeMemberships.get(p.id) ?? 0) > 1).length, unassigned: people.filter(p => p.active && !activeMemberships.get(p.id)).length };
    const versions: Record<string, number> = { "ontology.clients.v3": clientsDoc?.version ?? 0, "ontology.stakeholders.v1": doc?.version ?? 0 };
    if (meetingAccess) versions["ontology.engagement.v2"] = meetingsDoc?.version ?? 0;
    return { data: { company, people, counts, countBasis: "unique_contacts_and_active_participations", enrollments: map, versions } };
  }
  const unavailable: string[] = [], sections: Record<string, unknown> = {}, versions: Record<string, number> = { "ontology.clients.v3": clientsDoc?.version ?? 0 };
  const encoded=encodeURIComponent(company);
  const related:Record<string,{href:string;tool:string}>={};
  if (await allowed("enrollments:read", company)) {
    sections.enrollments = enrollments.map(e => ({ id: e.id, productId: e.productId, productVersion: e.productVersion, milestone: e.milestone ?? null, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, planId: e.planId, archivedAt: e.archivedAt, lifecycleHistory: e.lifecycleHistory }));
    related.enrollments={href:`/api/v1/enrollments?company=${encoded}`,tool:'enrollments_list'};
  }
  else unavailable.push("enrollments");
  if (await allowed("workspace:read", company)) {
    sections.allocations=clients.allocations.filter(a=>a.company===company).map(a=>({memberId:a.memberId,role:a.role,enrollmentId:a.enrollmentId??null,percent:a.percent,from:a.from,to:a.to}));
    related.allocations={href:`/api/v1/allocations?company=${encoded}`,tool:'allocations_list'};
    related.members={href:`/api/v1/members?company=${encoded}`,tool:'members_list'};
  } else unavailable.push("allocations");
  if (await allowed("stakeholders:read", company)) related.stakeholders={href:`/api/v1/clients/${encoded}/stakeholders`,tool:'stakeholders_list'};
  else unavailable.push("stakeholders");
  if (await allowed("documents:read", company)) related.documents={href:`/api/v1/documents?company=${encoded}`,tool:'documents_list'};
  else unavailable.push("documents");
  if (await allowed("delivery:read", company)) {
    const scoped = await scopedDeliverySnapshotWithVersion(db, workspace, company);
    const doc = scoped ? null : await getDoc(db, workspace, "ontology.delivery.v2");
    const execution = projectDelivery((scoped?.snapshot ?? doc?.value) as Partial<DeliverySnapshot> | undefined, company);
    sections.execution = { cycleCount: execution.cycles.length, taskCount: execution.tasks.length, tasksByStatus: Object.fromEntries([...new Set(execution.tasks.map(t => t.status))].map(status => [status, execution.tasks.filter(t => t.status === status).length])) };
    versions["ontology.delivery.v2"] = scoped?.sourceVersion ?? doc?.version ?? 0;
  } else unavailable.push("execution");
  if (await allowed("meetings:read", company)) {
    const doc = await getDoc(db, workspace, "ontology.engagement.v2");
    sections.meetings = projectMeetings(doc?.value as Partial<EngagementSnapshot> | undefined).filter(m => m.company === company).map(m => ({ id: m.id, title: m.title, startsAt: m.startsAt, cancelledAt: m.cancelledAt, schedulingStatus: m.schedulingStatus })).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 5);
    versions["ontology.engagement.v2"] = doc?.version ?? 0;
  } else unavailable.push("meetings");
  return { data: { client: { slug: client.slug, name: client.name, status: client.status, archived: !clients.clients.some(c => c.slug === company) }, sections, unavailable, versions, links: { client: `/clientes/${encoded}`, related } } };
}
