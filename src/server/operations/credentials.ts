import { can, normalizeAccess } from "../../modules/workspace/domain/permissions.ts";
import { resolveMember } from "../authz.ts";
import { OperationError } from "./errors.ts";

export const integrationScopes = [
  "clients:read", "clients:write", "stakeholders:read", "stakeholders:write",
  "enrollments:read", "enrollments:write", "delivery:read", "delivery:write",
  "meetings:read", "meetings:write", "catalog:read", "catalog:write",
  "events:read", "events:write", "documents:read", "documents:write",
  "engagement:read", "engagement:write", "knowledge:read", "knowledge:write",
  "workspace:read", "workspace:write",
] as const;
export type IntegrationScope = typeof integrationScopes[number];
export const CREDENTIAL_GUARD = "ontology.integrationauth.v1";
export type Credential = {
  id: string; workspace_id: string; name: string; owner_member_id: string;
  owner_email: string; scopes: string; companies: string | null;
  created_by: string; created_at: string; expires_at: string; revoked_at: string | null;
};
export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
async function requireAdmin(db: D1Database, workspace: string, email: string) {
  const guard = await db.prepare("SELECT key,version FROM state_documents WHERE workspace_id=? AND key LIKE 'ontology.workspace.v%' ORDER BY CAST(substr(key,21) AS INTEGER) DESC LIMIT 1")
    .bind(workspace).first<{ key: string; version: number }>();
  const { member } = await resolveMember(db, workspace, email);
  if (!member?.active || member.access !== "admin")
    throw new OperationError(403, "permission_denied", "Somente admins ativos gerenciam credenciais.");
  return guard ?? { key: "ontology.workspace.v3", version: 0 };
}
async function guardedCredentialWrite(db: D1Database, workspace: string, guard: { key: string; version: number }, statement: D1PreparedStatement) {
  const transaction = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare("INSERT INTO operation_guards(transaction_id,workspace_id,key,expected_version) VALUES(?,?,?,?)").bind(transaction, workspace, guard.key, guard.version),
      statement,
      db.prepare("DELETE FROM operation_guards WHERE transaction_id=?").bind(transaction),
    ]);
  } catch (error) {
    if (String(error).includes("state_version_conflict")) throw new OperationError(409, "version_conflict", "As permissões mudaram. Atualize e tente novamente.");
    throw error;
  }
}
export async function issueIntegrationCredential(db: D1Database, workspace: string, actorEmail: string, input: {
  name: string; ownerEmail: string; scopes: IntegrationScope[]; companies?: string[]; expiresAt: string;
}) {
  const guard = await requireAdmin(db, workspace, actorEmail);
  return persistCredential(db, workspace, actorEmail, input, guard);
}
async function persistCredential(db: D1Database, workspace: string, actorEmail: string, input: {name: string; ownerEmail: string; scopes: IntegrationScope[]; companies?: string[]; expiresAt: string}, guard: {key: string; version: number}) {
  if (!input || typeof input.name !== "string" || typeof input.ownerEmail !== "string" || typeof input.expiresAt !== "string") throw new OperationError(422, "invalid_credential", "Informe nome, responsável e validade da credencial.");
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const { member } = await resolveMember(db, workspace, ownerEmail);
  if (!member?.active) throw new OperationError(422, "invalid_owner", "Escolha um membro ativo como responsável.");
  if (!input.name.trim() || input.name.length > 100 || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now())
    throw new OperationError(422, "invalid_credential", "Informe nome e validade futura da credencial.");
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.some(s => !integrationScopes.includes(s)))
    throw new OperationError(422, "invalid_scope", "Informe escopos válidos para a integração.");
  if (input.companies !== undefined && (!Array.isArray(input.companies) || input.companies.some(c => typeof c !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c))))
    throw new OperationError(422, "invalid_companies", "Informe identificadores de clientes válidos.");
  const id = crypto.randomUUID();
  const token = `g4d_${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")}`;
  const expiresAt = new Date(input.expiresAt).toISOString();
  await guardedCredentialWrite(db, workspace, guard, db.prepare("INSERT INTO integration_credentials(id,workspace_id,name,token_hash,owner_member_id,owner_email,scopes,companies,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, workspace, input.name.trim(), await tokenHash(token), member.id, ownerEmail,
      JSON.stringify([...new Set(input.scopes)]), input.companies === undefined ? null : JSON.stringify([...new Set(input.companies)]),
      actorEmail, new Date().toISOString(), expiresAt));
  return { id, token, expiresAt };
}
export async function revokeIntegrationCredential(db: D1Database, workspace: string, actorEmail: string, id: string) {
  const guard = await requireAdmin(db, workspace, actorEmail);
  await guardedCredentialWrite(db, workspace, guard, db.prepare("UPDATE integration_credentials SET revoked_at=? WHERE workspace_id=? AND id=? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), workspace, id));
}
export async function listIntegrationCredentials(db: D1Database, workspace: string, actorEmail: string) {
  await requireAdmin(db, workspace, actorEmail);
  return (await db.prepare("SELECT id,name,owner_member_id,owner_email,scopes,companies,created_by,created_at,expires_at,revoked_at FROM integration_credentials WHERE workspace_id=? ORDER BY created_at DESC")
    .bind(workspace).all<Omit<Credential, "workspace_id">>()).results;
}
export async function credentialForToken(db: D1Database, workspace: string, token: string): Promise<Credential> {
  if (!/^g4d_[a-f0-9]{64}$/.test(token)) throw new OperationError(401, "invalid_token", "Credencial inválida ou expirada.");
  const row = await db.prepare("SELECT id,workspace_id,name,owner_member_id,owner_email,scopes,companies,created_by,created_at,expires_at,revoked_at FROM integration_credentials WHERE workspace_id=? AND token_hash=?")
    .bind(workspace, await tokenHash(token)).first<Credential>();
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now())
    throw new OperationError(401, "invalid_token", "Credencial inválida ou expirada.");
  return row;
}

/** Personal keys inherit current membership and allocations; no caller-selected owner or grants. */
async function personalKeyOwner(db: D1Database, workspace: string, email: string) {
  const guard = await db.prepare("SELECT key,version FROM state_documents WHERE workspace_id=? AND key LIKE 'ontology.workspace.v%' ORDER BY CAST(substr(key,21) AS INTEGER) DESC LIMIT 1").bind(workspace).first<{key: string; version: number}>();
  const { member } = await resolveMember(db, workspace, email);
  if (!member?.active || !can({access: normalizeAccess(member.access), memberId: member.id}, "api-keys.gerenciar"))
    throw new OperationError(403, "permission_denied", "Entre com um usuário ativo para gerenciar suas chaves.");
  return {member, guard: guard ?? {key: "ontology.workspace.v3", version: 0}};
}
export async function issuePersonalApiKey(db: D1Database, workspace: string, email: string, input: Record<string, unknown>) {
  const {guard} = await personalKeyOwner(db, workspace, email);
  if (Object.keys(input).some(key => !["name", "expiresInDays"].includes(key)) || typeof input.name !== "string" || ![30,90,365].includes(input.expiresInDays as number))
    throw new OperationError(422, "invalid_credential", "Informe nome e validade de 30, 90 ou 365 dias.");
  return persistCredential(db, workspace, email, {name: input.name, ownerEmail: email, scopes: [...integrationScopes], expiresAt: new Date(Date.now() + Number(input.expiresInDays)*86400000).toISOString()}, guard);
}
export async function listPersonalApiKeys(db: D1Database, workspace: string, email: string) {
  const {member} = await personalKeyOwner(db, workspace, email);
  return (await db.prepare("SELECT id,name,created_at,expires_at,revoked_at FROM integration_credentials WHERE workspace_id=? AND owner_member_id=? AND owner_email=? ORDER BY created_at DESC,id DESC").bind(workspace, member.id, email).all()).results;
}
export async function revokePersonalApiKey(db: D1Database, workspace: string, email: string, id: string) {
  const {member,guard} = await personalKeyOwner(db, workspace, email);
  const own = await db.prepare("SELECT id FROM integration_credentials WHERE workspace_id=? AND id=? AND owner_member_id=? AND owner_email=?").bind(workspace,id,member.id,email).first();
  if (!own) throw new OperationError(404, "not_found", "Chave não encontrada.");
  await guardedCredentialWrite(db, workspace, guard, db.prepare("UPDATE integration_credentials SET revoked_at=? WHERE workspace_id=? AND id=? AND owner_member_id=? AND owner_email=? AND revoked_at IS NULL").bind(new Date().toISOString(),workspace,id,member.id,email));
}
