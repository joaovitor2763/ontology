import type { ServerEnv } from "../context";
import { getDoc } from "../db.ts";
import { resolveMember } from "../authz.ts";
import { authorizeOperation, resolveOperationPrincipal, type OperationPrincipal } from "./principal.ts";
import { commitOperation, type VersionGuard } from "./transaction.ts";
import { OperationError } from "./errors.ts";
import { projectClients, type ClientsSnapshot } from "../../modules/clients/infrastructure/snapshot.ts";
import { documents as seedDocuments } from "../../modules/documents/infrastructure/seed.ts";
import { threads as seedThreads, meetings as seedMeetings } from "../../modules/engagement/infrastructure/seed.ts";
import { projectMeetings } from "../../modules/engagement/infrastructure/snapshot.ts";
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
type File = { id: string; r2_key: string; name: string; mime: string | null; size: number; created_by: string | null; company: string | null; content_hash: string | null; status: "staged" | "ready" | "deleting" };
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
async function metadata(db: D1Database, workspace: string, id: string) {
  return db.prepare("SELECT id,r2_key,name,mime,size,created_by,company,content_hash,status FROM files WHERE workspace_id=? AND id=?").bind(workspace, id).first<File>();
}
/** Include every live reference, including historical versions and timeline attachments. */
async function references(db: D1Database, workspace: string, id: string) {
  const keys = ["ontology.documents.v3", "ontology.documents.v2", "ontology.relationship.v1", "ontology.engagement.v2"];
  const docs = new Map(await Promise.all(keys.map(async key => [key, await getDoc(db, workspace, key)] as const)));
  const document = row((docs.get(keys[0]) ?? docs.get(keys[1]))?.value);
  const edits = row(document.docEdits), removed = Array.isArray(document.removedDocIds) ? document.removedDocIds : [];
  const companies = new Set<string>();
  for (const raw of [...seedDocuments, ...rows(document.extraDocs)]) {
    const d = { ...raw, ...row(edits[raw.id as string]) };
    if (d.id === id && !removed.includes(d.id) && typeof d.company === "string") companies.add(d.company);
  }
  const relationship = row(docs.get(keys[2])?.value);
  for (const thread of [...seedThreads, ...rows(relationship.spaces)]) {
    const messages = [...rows(thread.messages), ...rows(row(relationship.notes)[String(thread.id)])];
    if (messages.some(m => rows(m.files).some(f => f.id === id)) && typeof thread.company === "string") companies.add(thread.company);
  }
  for (const meeting of projectMeetings((docs.get(keys[3])?.value ?? {}) as object)) if (meeting.google?.transcriptDocId === id) companies.add(meeting.company);
  return { companies, guards: [...docs].map(([key, doc]) => ({ key, version: doc?.version ?? 0 })) };
}
/** Retain historical/tombstoned references too; projection filtering must not authorize byte deletion. */
async function retention(db: D1Database, workspace: string, id: string) {
  const keys = ["ontology.documents.v3", "ontology.documents.v2", "ontology.relationship.v1", "ontology.engagement.v2", "ontology.delivery.v2"];
  const docs = await Promise.all(keys.map(async key => ({ key, doc: await getDoc(db, workspace, key) })));
  const fields = new Set(["id", "supersedesId", "transcriptDocId", "documentId", "fileId", "removedDocIds", "documentIds", "fileIds"]);
  const referenced = (value: unknown, field = ""): boolean => {
    if (typeof value === "string") return fields.has(field) && value === id;
    if (Array.isArray(value)) return value.some(item => referenced(item, field));
    return Object.entries(row(value)).some(([key, item]) => (key === id && field === "docEdits") || referenced(item, key));
  };
  if (referenced(seedDocuments) || referenced(seedThreads) || referenced(seedMeetings) || docs.some(({ doc }) => referenced(doc?.value))) throw new OperationError(409, "file_referenced", "O arquivo faz parte do histórico da plataforma e não pode ser apagado. Remova o documento pelas operações da plataforma.");
  return docs.map(({ key, doc }) => ({ key, version: doc?.version ?? 0 }));
}
function unique(guards: VersionGuard[]) {
  const values = new Map<string, number>();
  for (const g of guards) {
    if (values.has(g.key) && values.get(g.key) !== g.version) throw new OperationError(409, "version_conflict", "As permissões mudaram.");
    values.set(g.key, g.version);
  }
  return [...values].map(([key, version]) => ({ key, version }));
}
async function authorizeFile(db: D1Database, workspace: string, principal: OperationPrincipal, file: File, write: boolean) {
  const refs = await references(db, workspace, file.id);
  if (refs.companies.size > 1 || (file.company && [...refs.companies].some(c => c !== file.company))) throw new OperationError(409, "ambiguous_file", "O arquivo tem vínculos conflitantes. Corrija os documentos antes de continuar.");
  const company = file.company ?? [...refs.companies][0];
  const guards = await authorizeOperation(db, workspace, principal, { action: write ? "documentos.enviar" : "clientes.ver", scope: write ? "documents:write" : "documents:read", company });
  if (!refs.companies.size) {
    const { member } = await resolveMember(db, workspace, principal.email);
    if (file.created_by !== principal.id && file.created_by !== principal.email && member?.access !== "admin") throw new OperationError(403, "orphan_file", "Somente quem enviou ou um admin pode acessar um arquivo ainda sem documento.");
  }
  return { company, guards: unique([...guards, ...refs.guards]) };
}
async function mutate(db: D1Database, workspace: string, principal: OperationPrincipal, id: string, company: string | undefined, guards: VersionGuard[], statements: D1PreparedStatement[], type?: string, expected?: { status: string; r2_key: string }) {
  const operation = crypto.randomUUID();
  if (expected) statements = [
    db.prepare("INSERT INTO file_operation_guards(transaction_id,workspace_id,file_id,expected_status,expected_r2_key) VALUES(?,?,?,?,?)").bind(operation, workspace, id, expected.status, expected.r2_key),
    ...statements, db.prepare("DELETE FROM file_operation_guards WHERE transaction_id=?").bind(operation),
  ];
  await commitOperation(db, { workspace, principal: principal.id, application: principal.application, actor: principal, key: `file:${operation}`, command: type ?? "file.stage", hash: operation, id: operation, guards, writes: [], statements, events: type ? [{ type, company, subject: id }] : [], result: { id } });
}
/** R2 objects use unique keys; failed uploads cannot overwrite a referenced object's bytes. */
export async function fileResponse(request: Request, env: ServerEnv, id: string, resolvedPrincipal?: OperationPrincipal): Promise<Response> {
  try {
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(id)) throw new OperationError(400, "invalid_file_id", "Identificador inválido.");
    if (!env.DB || !env.FILES) throw new OperationError(503, "storage_unavailable", "Armazenamento indisponível.");
    const db = env.DB, bucket = env.FILES, workspace = env.WORKSPACE_ID || "default";
    const principal = resolvedPrincipal ?? await resolveOperationPrincipal(request, env);
    if (request.method !== "GET" && !request.headers.has("authorization") && request.headers.get("origin") !== new URL(request.url).origin) throw new OperationError(403, "invalid_origin", "Origem da requisição não permitida.");
    let file = await metadata(db, workspace, id);
    if (request.method === "GET") {
      if (!file) throw new OperationError(404, "file_not_found", "Arquivo não encontrado.");
      const access = await authorizeFile(db, workspace, principal, file, false);
      if (!file.company && access.company) await mutate(db, workspace, principal, id, access.company, access.guards, [db.prepare("UPDATE files SET company=? WHERE workspace_id=? AND id=? AND company IS NULL").bind(access.company, workspace, id)], undefined, file);
      if (file.status !== "ready") throw new OperationError(409, "file_pending", "O arquivo ainda está sendo enviado ou removido.");
      const object = await bucket.get(file.r2_key);
      if (!object) throw new OperationError(404, "file_content_not_found", "Conteúdo não encontrado.");
      return new Response(object.body, { headers: { "content-type": file.mime || "application/octet-stream", "content-length": String(file.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "PUT") {
      const company = request.headers.get("x-client-company") ?? "";
      if (!company) throw new OperationError(422, "client_required", "Informe o cliente do documento.");
      const guards = await authorizeOperation(db, workspace, principal, { action: "documentos.enviar", scope: "documents:write", company });
      const clientsDoc = await getDoc(db, workspace, "ontology.clients.v3");
      if (!projectClients((clientsDoc?.value ?? {}) as Partial<ClientsSnapshot>).clients.some(c => c.slug === company)) throw new OperationError(404, "client_not_found", "Cliente ativo não encontrado.");
      if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) throw new OperationError(413, "file_too_large", "Arquivo maior que 50 MB.");
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_FILE_BYTES) throw new OperationError(413, "file_too_large", "Arquivo maior que 50 MB.");
      const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      const name = decodeURIComponent(request.headers.get("x-file-name") ?? id).slice(0, 500);
      const mime = request.headers.get("content-type") || "application/octet-stream";
      const bound = unique([...guards, { key: "ontology.clients.v3", version: clientsDoc?.version ?? 0 }]);
      if (file) {
        await authorizeFile(db, workspace, principal, file, true);
        if (file.company !== company || file.created_by !== principal.id || file.content_hash !== contentHash || file.status === "deleting") throw new OperationError(409, "file_exists", "Este identificador já pertence a outro envio. Crie uma nova versão do documento.");
        if (file.status === "ready") return Response.json({ id, size: file.size });
      } else {
        const path = `${workspace}/${id}/${crypto.randomUUID()}`;
        try {
          await mutate(db, workspace, principal, id, company, bound, [db.prepare("INSERT INTO files(id,workspace_id,r2_key,name,mime,size,created_by,company,content_hash,status) VALUES(?,?,?,?,?,?,?,?,?,'staged')").bind(id, workspace, path, name, mime, bytes.byteLength, principal.id, company, contentHash)], undefined, { status: "missing", r2_key: "" });
        } catch (error) {
          if (String(error).includes("UNIQUE")) throw new OperationError(409, "file_exists", "Um envio com este identificador já está em andamento.");
          throw error;
        }
        file = (await metadata(db, workspace, id))!;
      }
      await bucket.put(file.r2_key, bytes, { httpMetadata: { contentType: mime } });
      const fresh = await authorizeFile(db, workspace, principal, file, true);
      await mutate(db, workspace, principal, id, company, fresh.guards, [db.prepare("UPDATE files SET status='ready' WHERE workspace_id=? AND id=? AND status='staged' AND content_hash=?").bind(workspace, id, contentHash)], "file.uploaded", { ...file, status: "staged" });
      return Response.json({ id, size: bytes.byteLength }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "DELETE") {
      if (!file) { await authorizeOperation(db, workspace, principal, { action: "documentos.enviar", scope: "documents:write", company: request.headers.get("x-client-company") ?? undefined }); return Response.json({ ok: true }); }
      const access = await authorizeFile(db, workspace, principal, file, true);
      const retained = await retention(db, workspace, id);
      await mutate(db, workspace, principal, id, access.company, unique([...access.guards, ...retained]), [db.prepare("UPDATE files SET status='deleting' WHERE workspace_id=? AND id=?").bind(workspace, id)], undefined, file);
      await bucket.delete(file.r2_key);
      const fresh = await authorizeFile(db, workspace, principal, file, true);
      await mutate(db, workspace, principal, id, fresh.company, fresh.guards, [db.prepare("DELETE FROM files WHERE workspace_id=? AND id=? AND status='deleting'").bind(workspace, id)], "file.deleted", { ...file, status: "deleting" });
      return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    if (String(error).includes("file_version_conflict")) return Response.json({ error: "O arquivo mudou durante a operação. Atualize e tente novamente.", code: "version_conflict" }, { status: 409 });
    if (error instanceof OperationError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "private, no-store" } });
    return Response.json({ error: "Não foi possível concluir a operação do arquivo. Tente novamente.", code: "file_operation_failed" }, { status: 502 });
  }
}
