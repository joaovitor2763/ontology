import type { ServerEnv } from "../context";
import { memberOfRoster } from "../authz.ts";
import { workspaceDocument } from "./request-context.ts";
import { getDoc } from "../db.ts";
import { can, normalizeAccess, type Action, type AccessLevel } from "../../modules/workspace/domain/permissions.ts";
import { CREDENTIAL_GUARD, credentialForToken, type Credential, type IntegrationScope } from "./credentials.ts";
import { OperationError } from "./errors.ts";
import { projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import type { VersionGuard } from "./transaction.ts";
import { accessDay, readClientAccess } from "../client-access.ts";

export type OperationPrincipal = {
  id: string; kind: "session" | "integration" | "oauth"; email: string; memberId: string;
  access: AccessLevel; application: string; scopes: IntegrationScope[] | null;
  companies: string[] | null; guards: VersionGuard[];
  /** Origem confiavel definida pelo adaptador; ausente em chamadas internas/testes antigos. */
  channel?: "interface" | "api" | "mcp";
  oauthGrant?: import("./oauth.ts").OAuthGrantReference;
};
/** Roster e guarda saem do mesmo documento, lido uma vez por requisição. */
async function memberPrincipal(db: D1Database, workspace: string, email: string, credential?: Credential): Promise<OperationPrincipal> {
  const { key, doc } = await workspaceDocument(db, workspace);
  const guard: VersionGuard = { key, version: doc?.version ?? 0 };
  const { member } = memberOfRoster(doc?.value, email);
  // Bootstrap is exclusively the existing roster setup flow, never a business credential.
  if (!member?.active || (credential && member.id !== credential.owner_member_id))
    throw new OperationError(403, "inactive_member", "O responsável não possui acesso ativo à plataforma.");
  return {
    id: credential ? `integration:${credential.id}` : `member:${member.id}`,
    kind: credential ? "integration" : "session", email, memberId: member.id,
    access: normalizeAccess(member.access), application: credential ? credential.id : "web",
    scopes: credential ? JSON.parse(credential.scopes) : null,
    companies: credential?.companies ? JSON.parse(credential.companies) : null,
    guards: [guard],
  };
}
/** Invalid Bearer credentials never fall back to a browser session. */
export async function resolveOperationPrincipal(request: Request, env: ServerEnv): Promise<OperationPrincipal> {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco de dados não configurado.");
  const workspace = env.WORKSPACE_ID || "default";
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match) throw new OperationError(401, "invalid_token", "Informe uma credencial Bearer válida.");
    if (!match[1].startsWith("g4d_")) {
      if(!/^[^:\s]+:[^:\s]+:[^:\s]+$/.test(match[1])) throw new OperationError(401,"invalid_token","Token inválido.");
      const { resolveOAuthIdentity } = await import("./oauth.ts");
      const identity = await resolveOAuthIdentity(request, env);
      const member = await memberPrincipal(env.DB, workspace, identity.email);
      return { ...member, ...identity, kind: "oauth", companies: null, guards: [...member.guards, identity.guard] };
    }
    const marker = await getDoc(env.DB, workspace, CREDENTIAL_GUARD);
    const credential = await credentialForToken(env.DB, workspace, match[1]);
    const principal = await memberPrincipal(env.DB, workspace, credential.owner_email, credential);
    principal.guards.push({ key: CREDENTIAL_GUARD, version: marker?.version ?? 0 });
    return principal;
  }
  const { authenticate } = await import("../auth.ts");
  const user = await authenticate(request, env);
  if (!user) throw new OperationError(401, "authentication_required", "Faça login para continuar.");
  return memberPrincipal(env.DB, workspace, user.email.toLowerCase());
}
export async function authorizeOperation(db: D1Database, workspace: string, principal: OperationPrincipal, input: {
  action: Action; scope: IntegrationScope; company?: string;
}): Promise<VersionGuard[]> {
  let current: OperationPrincipal;
  if (principal.kind === "integration") {
    const marker = await getDoc(db, workspace, CREDENTIAL_GUARD);
    const credential = await db.prepare("SELECT id,workspace_id,name,owner_member_id,owner_email,scopes,companies,created_by,created_at,expires_at,revoked_at FROM integration_credentials WHERE workspace_id=? AND id=?")
      .bind(workspace, principal.application).first<Credential>();
    if (!credential || credential.revoked_at || Date.parse(credential.expires_at) <= Date.now())
      throw new OperationError(401, "invalid_token", "Credencial inválida ou expirada.");
    current = await memberPrincipal(db, workspace, credential.owner_email, credential);
    current.guards.push({ key: CREDENTIAL_GUARD, version: marker?.version ?? 0 });
    if (!current.scopes?.includes(input.scope)) throw new OperationError(403, "insufficient_scope", "A integração não possui este escopo.");
    if (current.companies !== null && (!input.company || !current.companies.includes(input.company)))
      throw new OperationError(403, "client_not_allowed", "A integração não possui acesso a este cliente.");
  } else {
    current = await memberPrincipal(db, workspace, principal.email);
    if(principal.kind === "oauth") {
      if(!principal.oauthGrant) throw new OperationError(401,"invalid_token","Conexão OAuth inválida.");
      const { validateOAuthGrant } = await import("./oauth.ts");
      const fresh=await validateOAuthGrant(db,workspace,principal.oauthGrant);
      if(!fresh.scopes.includes(input.scope)) throw new OperationError(403,"insufficient_scope","O aplicativo não recebeu esta permissão.");
      current.guards.push(fresh.guard);
    }
  }
  const today = accessDay();
  const indexed = await readClientAccess(db, workspace, input.company, today);
  const clients = indexed ? null : await getDoc(db, workspace, "ontology.clients.v3");
  const responsibleIds = indexed?.responsibleIds ?? projectClients((clients?.value ?? {}) as Partial<ClientsSnapshot>)
    .allocations.filter(a => a.company === input.company && (!a.from || a.from <= today) && (!a.to || a.to >= today))
    .map(a => a.memberId);
  if (!can({ access: current.access, memberId: current.memberId }, input.action, { responsibleIds }))
    throw new OperationError(403, "permission_denied", "Você não tem permissão para esta ação.");
  return [...current.guards, { key: "ontology.clients.v3", version: indexed?.version ?? clients?.version ?? 0 }];
}
