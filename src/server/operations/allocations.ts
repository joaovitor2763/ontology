import type { ServerEnv } from "../context";
import { getDoc } from "../db.ts";
import { authorizeOperation, type OperationPrincipal } from "./principal.ts";
import { canonical, commitOperation, receipt, requestHash } from "./transaction.ts";
import { OperationError } from "./errors.ts";
import * as v from "./input.ts";
import { projectClients, normalizeClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import {
  upsertAllocation,
  removeAllocation,
  allocationError,
  systemAllocationRoleLabels,
  type Allocation,
} from "../../modules/clients/domain/allocation.ts";
import { people } from "../../modules/workspace/infrastructure/seed.ts";
import { normalizeAllocationRoles, type Person } from "../../modules/workspace/domain/models.ts";
import { currentAllocations, effectiveClientAllocations } from "./allocation-relations.ts";

import { setClientResponsible } from "../../modules/clients/domain/set-responsible.ts";

const KEY = "ontology.clients.v3";

function date(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = v.string(value, "data", undefined, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text)
    v.invalid("Informe uma data válida.");
  return text;
}

/** First mutation persists the complete effective allocation set, including legacy assignments. */
export async function executeAllocationCommand(env: ServerEnv, principal: OperationPrincipal, command: string, input: unknown, key: string, expectedVersions: Record<string, number> = {}) {
  if (!["allocations.save", "allocations.remove", "clients.setResponsible"].includes(command)) v.invalid("Operação de alocação inválida.");
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  const db = env.DB, workspace = env.WORKSPACE_ID || "default", raw = v.object(input), company = v.id(raw.company), saving = command === "allocations.save", settingResponsible = command === "clients.setResponsible";
  if (Object.keys(raw).some(field => !(settingResponsible ? ["company", "memberId", "enrollmentId"] : saving ? ["company", "allocation"] : ["company", "allocationId"]).includes(field))) v.invalid("Campo de alocação inválido.");
  const auth = await authorizeOperation(db, workspace, principal, { action: settingResponsible ? "cliente.responsaveis" : "alocacao.editar", scope: "workspace:write", company });
  const hash = await requestHash(command, input), saved = await receipt(db, workspace, principal.id, key, command, hash);
  if (saved) return saved.result;
  const rosterKey = auth.find(guard => guard.key.startsWith("ontology.workspace."))!.key;
  const [doc, rosterDoc] = await Promise.all([getDoc(db, workspace, KEY), getDoc(db, workspace, rosterKey)]);
  const versions = new Map<string, number>();
  for (const guard of [...auth, { key: KEY, version: doc?.version ?? 0 }, { key: rosterKey, version: rosterDoc?.version ?? 0 }]) {
    if (versions.has(guard.key) && versions.get(guard.key) !== guard.version) throw new OperationError(409, "version_conflict", "As permissões mudaram.");
    versions.set(guard.key, guard.version);
  }
  for (const [name, version] of Object.entries(expectedVersions)) {
    if (!Number.isSafeInteger(version) || version < 0) v.invalid("Versão inválida.");
    if (versions.has(name) && versions.get(name) !== version) throw new OperationError(409, "version_conflict", "Atualize as alocações antes de continuar.");
  }
  const state = normalizeClientsSnapshot(doc?.value ?? {}), current = projectClients(state);
  if (!current.clients.some(client => client.slug === company)) throw new OperationError(404, "client_not_found", "Cliente ativo não encontrado.");
  const before = canonical(state);
  const at = new Date().toISOString();
  let allocations = current.allocations, allocation: Allocation | undefined, affected: Allocation | undefined, subject: string;
  const roster = (rosterDoc?.value ?? {}) as { extraMembers?: Person[]; memberEdits?: Record<string, Partial<Person>>; deactivatedIds?: string[]; allocationRoles?: unknown };
  const requireMember = (memberId: string) => {
    const member = [...(roster.extraMembers ?? []), ...people.filter(person => person.org === "praxis")]
      .map(person => ({ ...person, ...roster.memberEdits?.[person.id] }))
      .find(person => person.id === memberId);
    if (!member || roster.deactivatedIds?.includes(memberId)) v.invalid("Escolha um membro ativo da equipe.");
  };
  const previousResponsibleIds = [...new Set(current.allocations.filter(row => row.company === company && row.role === "responsavel" && row.enrollmentId === raw.enrollmentId).map(row => row.memberId))];
  if (settingResponsible) {
    const memberId = raw.memberId === null ? null : v.id(raw.memberId, "responsável");
    if (memberId) requireMember(memberId);
    const enrollmentId = raw.enrollmentId === undefined ? undefined : v.id(raw.enrollmentId, "contratação");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
    try { allocations = setClientResponsible(allocations, current.enrollments, { company, memberId, enrollmentId }, at, today); }
    catch (error) { v.invalid(error instanceof Error ? error.message : "Contratação inválida."); }
    allocation = allocations.find(row => row.company === company && row.role === "responsavel" && row.enrollmentId === enrollmentId);
    affected = allocation; subject = company;
    if (!enrollmentId) state.clientEdits = { ...state.clientEdits, [company]: { ...state.clientEdits[company], leadId: memberId ?? "" } };
  } else if (saving) {
    const body = v.object(raw.allocation);
    if (Object.keys(body).some(field => !["id", "memberId", "role", "enrollmentId", "percent", "from", "to"].includes(field))) v.invalid("Campo da alocação inválido.");
    if (body.percent === undefined) v.invalid("Informe a dedicação da alocação.");
    const memberId = v.id(body.memberId), role = v.id(body.role, "papel");
    const enrollmentId = body.enrollmentId === undefined || body.enrollmentId === null || body.enrollmentId === "" ? undefined : v.id(body.enrollmentId, "contratação");
    if (enrollmentId && !current.enrollments.some(enrollment => enrollment.id === enrollmentId && enrollment.company === company)) v.invalid("Escolha uma contratação deste cliente.");
    const customRoles = normalizeAllocationRoles(roster.allocationRoles);
    if (!Object.hasOwn(systemAllocationRoleLabels, role) && !customRoles.some(candidate => candidate.id === role)) v.invalid("Escolha um papel de alocação cadastrado no workspace.");
    requireMember(memberId);
    const id = body.id === undefined ? undefined : v.id(body.id);
    const existing = id ? allocations.find(row => row.id === id) : allocations.find(row => row.company === company && row.memberId === memberId && row.role === role && (row.enrollmentId ?? "") === (enrollmentId ?? ""));
    if (id && (!existing || existing.company !== company)) throw new OperationError(404, "allocation_not_found", "Alocação não encontrada neste cliente.");
    allocation = { id: existing?.id ?? `alloc-${crypto.randomUUID()}`, company, memberId, role, enrollmentId, percent: v.number(body.percent, 0, 0, 100), from: date(body.from), to: date(body.to), createdAt: existing?.createdAt ?? at, updatedAt: at };
    const error = allocationError(allocation);
    if (error) v.invalid(error);
    allocations = upsertAllocation(allocations, allocation); affected = allocation; subject = allocation.id;
  } else {
    subject = v.id(raw.allocationId);
    affected = allocations.find(row => row.id === subject && row.company === company);
    if (!affected) throw new OperationError(404, "allocation_not_found", "Alocação não encontrada neste cliente.");
    allocations = removeAllocation(allocations, subject);
  }
  const value = { ...state, allocations, allocationsMigrated: true }, changed = canonical(value) !== before;
  return commitOperation(db, {
    workspace, principal: principal.id, application: principal.application, actor: principal, key, command, hash, checked: true, id: crypto.randomUUID(),
    guards: [...versions].map(([guardKey, version]) => ({ key: guardKey, version })), writes: changed ? [{ key: KEY, value }] : [],
    events: changed ? [{ type: command, company, subject, data: { ...(settingResponsible ? { previousResponsibleIds, scope: raw.enrollmentId ? "enrollment" : "client", memberId: raw.memberId } : { memberId: affected?.memberId }), role: settingResponsible ? "responsavel" : affected?.role, enrollmentId: settingResponsible ? raw.enrollmentId ?? null : affected?.enrollmentId ?? null, percent: affected?.percent } }] : [],
    result: { data: { ...(settingResponsible ? { company, memberId: raw.memberId, enrollmentId: raw.enrollmentId ?? null } : {}), ...(allocation ? { allocation } : {}), allocations: allocations.filter(row => row.company === company) }, documents: principal.kind === "session" ? [{ key: KEY, value, version: (doc?.version ?? 0) + (changed ? 1 : 0), updatedAt: changed ? at : doc?.updatedAt ?? at }] : [] },
  });
}

export async function readAllocations(env: ServerEnv, principal: OperationPrincipal, input: { company?: string; memberId?: string; role?: string; limit?: number; offset?: number; expectedVersion?: number }) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco indisponível.");
  const company = input.company === undefined ? undefined : v.id(input.company), memberId = input.memberId === undefined ? undefined : v.id(input.memberId, "membro"), role = input.role === undefined ? undefined : v.id(input.role, "papel");
  const workspace = env.WORKSPACE_ID || "default", limit = input.limit ?? 50, offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) v.invalid("Paginação inválida.");
  if (!company && !memberId) v.invalid("Informe company ou memberId para consultar alocações.");
  if (company) await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "workspace:read", company });
  const document = await getDoc(env.DB, workspace, KEY);
  if (input.expectedVersion !== undefined) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) v.invalid("Versão esperada inválida.");
    if (input.expectedVersion !== (document?.version ?? 0)) throw new OperationError(409, "snapshot_changed", "A lista mudou. Recomece pela primeira página.", { snapshotVersion: document?.version ?? 0 });
  }
  const clients = projectClients(document?.value ?? {});
  const activeClients = new Set(clients.clients.map(client => client.slug));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const source = company ? clients.allocations : effectiveClientAllocations(clients, currentAllocations(clients, today));
  const candidates = source.filter(allocation =>
    (!company || allocation.company === company) && (!memberId || allocation.memberId === memberId) && (!role || allocation.role === role));
  const permitted = company ? candidates : [];
  if (!company) {
    if (principal.companies === null) {
      await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "workspace:read" });
      permitted.push(...candidates);
    } else {
      const byCompany = new Map<string, Allocation[]>();
      for (const allocation of candidates) byCompany.set(allocation.company, [...(byCompany.get(allocation.company) ?? []), allocation]);
      for (const [slug, allocations] of byCompany) {
        if (principal.companies && !principal.companies.includes(slug)) continue;
        try {
          await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "workspace:read", company: slug });
          permitted.push(...allocations);
        } catch (error) {
          if (!(error instanceof OperationError) || !["permission_denied", "client_not_allowed"].includes(error.code)) throw error;
        }
      }
    }
    if (!permitted.length) {
      let visible = false;
      for (const slug of activeClients) {
        if (principal.companies && !principal.companies.includes(slug)) continue;
        try {
          await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "workspace:read", company: slug });
          visible = true;
          break;
        } catch (error) {
          if (!(error instanceof OperationError) || !["permission_denied", "client_not_allowed"].includes(error.code)) throw error;
        }
      }
      if (!visible) throw new OperationError(403, "permission_denied", "Você não tem permissão para consultar alocações.");
    }
  }
  const rows = permitted
    .sort((left, right) => (left.enrollmentId ?? "").localeCompare(right.enrollmentId ?? "") || left.role.localeCompare(right.role) || left.id.localeCompare(right.id));
  return { data: rows.slice(offset, offset + limit), total: rows.length, totalClients: new Set(rows.map(row => row.company)).size, snapshotVersion: document?.version ?? 0, nextOffset: offset + limit < rows.length ? offset + limit : null };
}
