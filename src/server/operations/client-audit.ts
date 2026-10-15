import type { ServerEnv } from "../context.ts";
import { getDoc } from "../db.ts";
import { projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import { authorizeOperation, type OperationPrincipal } from "./principal.ts";
import { OperationError } from "./errors.ts";

type AuditRow = {
  sequence: string;
  id: string;
  operation_id: string;
  command: string;
  action: string;
  area: string;
  company: string;
  subject: string;
  principal_id: string;
  actor_id: string;
  actor_email: string | null;
  source: "interface" | "api" | "mcp";
  application: string;
  data: string;
  created_at: string;
};

const auditSelect = `SELECT CAST(sequence AS TEXT) AS sequence,id,operation_id,command,action,area,company,subject,principal_id,actor_id,actor_email,source,application,data,created_at
  FROM client_audit_log`;

const projectRow = (row: AuditRow) => ({
  id: row.id,
  operationId: row.operation_id,
  command: row.command,
  action: row.action,
  area: row.area,
  company: row.company || null,
  subject: row.subject,
  actor: { id: row.actor_id, email: row.actor_email, principalId: row.principal_id },
  source: row.source,
  application: row.application,
  data: JSON.parse(row.data) as unknown,
  at: row.created_at,
});

export async function readClientAudit(
  env: ServerEnv,
  principal: OperationPrincipal,
  input: { company: string; cursor?: string; limit?: number },
) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco de dados não configurado.");
  if (!input.company || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.company))
    throw new OperationError(422, "invalid_input", "Informe o cliente.");
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new OperationError(400, "invalid_limit", "Informe um limite inteiro de 1 a 100.");
  const cursor = input.cursor;
  if (cursor !== undefined && (!/^[1-9]\d{0,18}$/.test(cursor) || (cursor.length === 19 && cursor > "9223372036854775807")))
    throw new OperationError(400, "invalid_cursor", "Cursor inválido.");
  const workspace = env.WORKSPACE_ID || "default";
  await authorizeOperation(env.DB, workspace, principal, { action: "clientes.ver", scope: "clients:read", company: input.company });
  const clients = projectClients((await getDoc(env.DB, workspace, "ontology.clients.v3"))?.value as Partial<ClientsSnapshot> | undefined);
  if (!clients.allClients.some(client => client.slug === input.company))
    throw new OperationError(404, "not_found", "Cliente não encontrado.");
  const select = `${auditSelect} WHERE workspace_id=? AND company=?${cursor === undefined ? "" : " AND sequence<CAST(? AS INTEGER)"}
    ORDER BY sequence DESC LIMIT ?`;
  const rows = (await env.DB.prepare(select)
    .bind(workspace, input.company, ...(cursor === undefined ? [] : [cursor]), limit + 1)
    .all<AuditRow>()).results;
  const page = rows.slice(0, limit);
  return {
    data: page.map(projectRow),
    nextCursor: rows.length > limit ? String(page.at(-1)!.sequence) : null,
  };
}

const filterPattern = /^[a-z0-9][a-z0-9_.:-]{0,199}$/i;
function decodeAdminCursor(cursor?: string) {
  if (cursor === undefined) return null;
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const [at, sequence, extra] = atob(padded).split("|");
    if (extra !== undefined || !at || !Number.isFinite(Date.parse(at)) || !/^[1-9]\d{0,18}$/.test(sequence ?? "") || (sequence!.length === 19 && sequence! > "9223372036854775807")) throw new Error();
    return { at, sequence };
  } catch {
    throw new OperationError(400, "invalid_cursor", "Cursor inválido.");
  }
}
const encodeAdminCursor = (row: AuditRow) => btoa(`${row.created_at}|${row.sequence}`).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
function decodePageAnchor(anchor?: string) {
  if (anchor === undefined) return null;
  try {
    const padded = anchor.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(anchor.length / 4) * 4, "=");
    const sequence = atob(padded);
    if (!/^[1-9]\d{0,18}$/.test(sequence) || (sequence.length === 19 && sequence > "9223372036854775807")) throw new Error();
    return sequence;
  } catch {
    throw new OperationError(400, "invalid_anchor", "Referência da listagem inválida.");
  }
}
const encodePageAnchor = (sequence: string) => btoa(sequence).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/** Workspace-wide operational audit. Only current platform admins may read it. */
export async function readAdminAudit(
  env: ServerEnv,
  principal: OperationPrincipal,
  input: { cursor?: string; page?: number; anchor?: string; limit?: number; company?: string; actor?: string; source?: string; area?: string },
) {
  if (!env.DB) throw new OperationError(503, "database_unavailable", "Banco de dados não configurado.");
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new OperationError(400, "invalid_limit", "Informe um limite inteiro de 1 a 100.");
  if (input.company && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.company))
    throw new OperationError(422, "invalid_input", "Cliente inválido.");
  if (input.actor && !filterPattern.test(input.actor)) throw new OperationError(422, "invalid_input", "Ator inválido.");
  if (input.area && !filterPattern.test(input.area)) throw new OperationError(422, "invalid_input", "Área inválida.");
  if (input.source && !["interface", "api", "mcp"].includes(input.source))
    throw new OperationError(422, "invalid_input", "Origem inválida.");
  if (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1_000_000))
    throw new OperationError(400, "invalid_page", "Informe uma página inteira entre 1 e 1000000.");
  if (input.cursor !== undefined && input.page !== undefined)
    throw new OperationError(400, "invalid_pagination", "Use cursor ou página, não os dois ao mesmo tempo.");
  if (input.anchor !== undefined && input.page === undefined)
    throw new OperationError(400, "invalid_pagination", "A referência da listagem exige uma página numerada.");
  if (input.page !== undefined && input.page > 1 && input.anchor === undefined)
    throw new OperationError(400, "invalid_pagination", "Consulte a primeira página e reutilize a referência recebida.");
  const workspace = env.WORKSPACE_ID || "default";
  await authorizeOperation(env.DB, workspace, principal, { action: "auditoria.ver", scope: "workspace:read" });
  const where = ["workspace_id=?"], values: unknown[] = [workspace];
  for (const [column, value] of [["company", input.company], ["actor_id", input.actor], ["source", input.source]] as const) {
    if (value) { where.push(`${column}=?`); values.push(value); }
  }
  if (input.area) {
    where.push("area=?"); values.push(input.area);
  }
  if (input.page !== undefined) {
    const anchor = decodePageAnchor(input.anchor);
    if (anchor) {
      where.push("sequence<=CAST(? AS INTEGER)");
      values.push(anchor);
    }
    const offset = (input.page - 1) * limit;
    const filter = where.join(" AND ");
    const [countResult, rowsResult] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS total,CAST(MAX(sequence) AS TEXT) AS high_water FROM client_audit_log WHERE ${filter}`).bind(...values),
      env.DB.prepare(`${auditSelect} WHERE ${filter} ORDER BY created_at DESC,sequence DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset),
    ]);
    const count = countResult.results[0] as { total?: number; high_water?: string | null } | undefined;
    const total = Number(count?.total ?? 0);
    const rows = rowsResult.results as unknown as AuditRow[];
    return {
      data: rows.map(projectRow),
      page: input.page,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      anchor: input.anchor ?? (count?.high_water ? encodePageAnchor(count.high_water) : null),
      nextCursor: null,
    };
  }
  const cursor = decodeAdminCursor(input.cursor);
  if (cursor) {
    where.push("(created_at<? OR (created_at=? AND sequence<CAST(? AS INTEGER)))");
    values.push(cursor.at, cursor.at, cursor.sequence);
  }
  const rows = (await env.DB.prepare(`${auditSelect} WHERE ${where.join(" AND ")} ORDER BY created_at DESC,sequence DESC LIMIT ?`)
    .bind(...values, limit + 1).all<AuditRow>()).results;
  const page = rows.slice(0, limit);
  return { data: page.map(projectRow), nextCursor: rows.length > limit ? encodeAdminCursor(page.at(-1)!) : null };
}
