import { OperationError } from "./errors.ts";
import { forgetDocuments, freshDocumentSnapshot, rememberDocument } from "./request-context.ts";
import { encodeStateBody } from "../state-body.ts";
import { activeDeliveryHistoryStatements, deliveryRecordStatements } from "./delivery-record-sync.ts";
import { clientShadowStatements } from "./delivery-client-shadow-sync.ts";
import { clientAccessStatements } from "./client-access-sync.ts";
import { clientSummaryStatements } from "./delivery-client-summary-sync.ts";

/** Comandos preparados por batch D1 em modo ativo (limite da plataforma com folga). */
export const ACTIVE_STATEMENT_BUDGET = 850;
export type VersionGuard = { key: string; version: number };
export type OperationEvent = { type: string; company?: string; subject: string; data?: unknown };
export type ExternalReference = { system: string; kind: string; externalId: string; entityId: string };
export type OperationActor = {
  memberId: string;
  email: string;
  kind: "session" | "integration" | "oauth";
  channel?: "interface" | "api" | "mcp";
};
const auditArea = (action: string) => {
  const separator = action.indexOf(".");
  const raw = separator > 0 ? action.slice(0, separator) : "other";
  const aliases: Record<string, string> = {
    clients: "client", enrollments: "enrollment", sales: "sale", stakeholders: "stakeholder", participants: "participant", allocations: "allocation",
    products: "product", product_rollout: "product", "product-rollouts": "product", plans: "plan", cycles: "cycle", tasks: "task", meetings: "meeting",
    "program-event": "agenda", "program-events": "agenda", interaction: "engagement", interactions: "engagement", inbox: "engagement", signal: "engagement", signals: "engagement",
    pain: "diagnosis", pains: "diagnosis", solution: "diagnosis", solutions: "diagnosis", hypothesis: "diagnosis", hypotheses: "diagnosis",
    documents: "document", members: "member", webhooks: "webhook", alerts: "alert",
  };
  return aliases[raw] ?? raw;
};
export type Commit = {
  workspace: string;
  principal: string;
  application: string;
  actor: OperationActor;
  key: string;
  command: string;
  hash: string;
  id: string;
  guards: VersionGuard[];
  writes: { key: string; value: unknown }[];
  events: OperationEvent[];
  /** Audit-only events that must not enter the outbound operation feed. */
  auditEvents?: OperationEvent[];
  references?: ExternalReference[];
  result: unknown;
  /**
   * Compact replay payload persisted in the receipt. The live response may
   * contain large documents, while a retry can rehydrate them from D1.
   */
  receiptResult?: unknown;
  /** Trusted server statements included atomically (never sourced from a request). */
  statements?: D1PreparedStatement[];
  /** A certified client-slice writer in statements advances the active client marker. */
  activeClientDelivery?: boolean;
  /**
   * O chamador já verificou o recibo com esta mesma chave, comando e hash, ou
   * a chave nasceu nesta chamada e não pode ter recibo. A verificação após
   * falha do batch continua valendo nos dois casos.
   */
  checked?: boolean;
  /**
   * Com mais de 10 fatias alteradas, não sincroniza páginas efetivas e inclui
   * `staleHeads` (clientes cujas páginas ficaram defasadas neste commit) em
   * `result.data` e nos eventos. Só para comandos da ponte que alteram muitas
   * fatias, como `plans.publish`; os demais seguem o orçamento.
   */
  reportStaleHeads?: boolean;
};

/** Stable JSON: object order must not change the identity of a request. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export async function requestHash(command: string, input: unknown) {
  const bytes = new TextEncoder().encode(canonical({ command, input }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function receipt(db: D1Database, workspace: string, principal: string, key: string, command: string, hash: string) {
  const row = await db.prepare("SELECT command, request_hash, result FROM operation_receipts WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?")
    .bind(workspace, principal, key).first<{ command: string; request_hash: string; result: string }>();
  if (!row) return null;
  if (row.command !== command || row.request_hash !== hash)
    throw new OperationError(409, "idempotency_conflict", "Esta chave já foi usada para outro pedido.");
  const result=JSON.parse(row.result) as unknown;
  if(result&&typeof result==='object'&&!Array.isArray(result)) {
    const documents=(result as {documents?:unknown}).documents;
    if(Array.isArray(documents)) {
      const references=documents.filter(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&!Object.hasOwn(entry,'value')) as {key?:unknown;version?:unknown;updatedAt?:unknown;updatedBy?:unknown}[];
      if(references.length) {
        if(references.some(reference=>typeof reference.key!=='string'||!Number.isSafeInteger(reference.version))) throw new OperationError(409,'receipt_document_invalid','Consulte o registro: este recibo não identifica seus documentos.');
        const snapshots=await freshDocumentSnapshot(db,workspace,references.map(reference=>reference.key as string));
        let index=0;
        (result as {documents:unknown[]}).documents=documents.map(entry=>{
          if(entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.hasOwn(entry,'value')) return entry;
          const snapshot=snapshots[index++];
          if(!snapshot) throw new OperationError(409,'receipt_document_missing','O documento confirmado não está mais disponível. Atualize a página.');
          const reference=entry as {key:string;version:number;updatedAt?:unknown;updatedBy?:unknown};
          if(snapshot.version!==reference.version)
            return {key:reference.key,value:snapshot.value,version:snapshot.version,updatedAt:snapshot.updatedAt};
          return {
            key:reference.key,
            value:snapshot.value,
            version:snapshot.version,
            updatedAt:typeof reference.updatedAt==='string'?reference.updatedAt:snapshot.updatedAt,
            ...(typeof reference.updatedBy==='string'?{updatedBy:reference.updatedBy}:{}),
          };
        });
      }
    }
  }
  return { result };
}

/** Receipts and command transports carry document identities, never snapshots. */
export function compactCommandResult(value: unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value)) return value;
  const result=value as Record<string,unknown>;
  if(!Array.isArray(result.documents)) return value;
  return {...result,documents:result.documents.map(entry=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry)) return entry;
    const reference=entry as Record<string,unknown>;
    return {key:reference.key,version:reference.version};
  })};
}

/** Receipts keep exact confirmation metadata for identical replay, but never document bodies or future fields. */
function compactReceiptResult(value: unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value)) return value;
  const result=value as Record<string,unknown>;
  if(!Array.isArray(result.documents)) return value;
  return {...result,documents:result.documents.map(entry=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry)) return entry;
    const reference=entry as Record<string,unknown>;
    return {
      key:reference.key,
      version:reference.version,
      ...(typeof reference.updatedAt==='string'?{updatedAt:reference.updatedAt}:{}),
      ...(typeof reference.updatedBy==='string'?{updatedBy:reference.updatedBy}:{}),
    };
  })};
}

/** The SQL trigger aborts even for an arbitrarily old/pruned version. No reliance
 * on history retention, changes() after commit, or process-local locks. */
export async function commitOperation(db: D1Database, input: Commit) {
  // `checked` evita repetir a leitura do recibo que o chamador acabou de fazer.
  const previous = input.checked
    ? null
    : await receipt(db, input.workspace, input.principal, input.key, input.command, input.hash);
  if (previous) return previous.result;
  const versions = new Map(input.guards.map((g) => [g.key, g.version]));
  if (versions.size !== input.guards.length || new Set(input.writes.map((w) => w.key)).size !== input.writes.length)
    throw new Error("Duplicate transaction keys");
  if (input.writes.some((w) => !versions.has(w.key))) throw new Error("Write without version guard");
  const now = new Date().toISOString();
  const tx = crypto.randomUUID();
  const deliveryKey = 'ontology.delivery.v2';
  const needsAuthority = versions.has(deliveryKey) || input.writes.some(write =>
    write.key === 'ontology.clients.v3');
  const authority = needsAuthority ? await db.prepare(`SELECT generation,mode,compatibility_version
    FROM delivery_client_shadow_meta WHERE workspace_id=?`).bind(input.workspace)
    .first<{ generation: string; mode: string; compatibility_version: number }>() : null;
  const active = authority?.mode === 'active';
  if (input.activeClientDelivery && !active)
    throw new OperationError(409, 'version_conflict',
      'A autoridade da execução mudou. Atualize e tente novamente.');
  if (input.activeClientDelivery && (!versions.has(deliveryKey) ||
      !input.writes.some(write => write.key === 'ontology.clients.v3') ||
      input.writes.some(write => write.key === deliveryKey)))
    throw new Error('Invalid active client-delivery composition');
  const expectedCompatibility = active ? versions.get(deliveryKey) ?? authority.compatibility_version : undefined;
  if (active && versions.has(deliveryKey) && expectedCompatibility !== authority.compatibility_version)
    throw new OperationError(409, 'version_conflict', 'A execução mudou. Atualize e tente novamente.');
  const physicalGuards = active ? input.guards.filter(guard => guard.key !== deliveryKey) : input.guards;
  // Um comando para todas as guardas: o gatilho continua sendo por linha.
  const statements: D1PreparedStatement[] = physicalGuards.length ? [db.prepare(
    `INSERT INTO operation_guards(transaction_id,workspace_id,key,expected_version) VALUES${physicalGuards.map(() => "(?,?,?,?)").join(",")}`,
  ).bind(...physicalGuards.flatMap((g) => [tx, input.workspace, g.key, g.version]))] : [];
  if (active) statements.push(db.prepare(`INSERT INTO delivery_compatibility_guards
    (transaction_id,workspace_id,generation,expected_version) VALUES(?,?,?,?)`)
    .bind(tx, input.workspace, authority.generation, expectedCompatibility));
  const receiptStatement = (result: unknown, receiptResult: unknown) =>
    db.prepare("INSERT INTO operation_receipts(workspace_id,principal_id,idempotency_key,id,command,request_hash,result,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(input.workspace, input.principal, input.key, input.id, input.command, input.hash, JSON.stringify(compactReceiptResult(receiptResult ?? result)), now);
  const receiptAt = statements.length;
  statements.push(receiptStatement(input.result, input.receiptResult));
  statements.push(...(input.statements ?? []));
  for (const write of input.writes) {
    const version = versions.get(write.key)! + 1;
    if (active && write.key === deliveryKey) {
      statements.push(...await activeDeliveryHistoryStatements(db, input.workspace,
        version - 1, write.value, Math.max(0, ACTIVE_STATEMENT_BUDGET - statements.length - 60)));
      continue;
    }
    const body = await encodeStateBody(write.value);
    statements.push(db.prepare("INSERT INTO state_documents(workspace_id,key,version,body,updated_at,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=excluded.version,body=excluded.body,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
      .bind(input.workspace, write.key, version, body, now, input.principal));
    statements.push(db.prepare("INSERT INTO state_history(workspace_id,key,version,updated_at,updated_by,body) VALUES(?,?,?,?,?,?)")
      .bind(input.workspace, write.key, version, now, input.principal, body));
    statements.push(db.prepare("DELETE FROM state_history WHERE workspace_id=? AND key=? AND version<=?")
      .bind(input.workspace, write.key, version - 50));
    if (write.key === deliveryKey) {
      const reserved = input.events.length * 2 + (input.auditEvents?.length ?? 0) +
        (input.references?.length ?? 0) + input.writes.length * 3;
      statements.push(...await deliveryRecordStatements(db, input.workspace, version - 1, write.value,
        Math.max(0, ACTIVE_STATEMENT_BUDGET - statements.length - reserved)));
    }
  }
  const shadowReserved = input.events.length * 2 + (input.auditEvents?.length ?? 0) +
    (input.references?.length ?? 0) + (input.guards.length ? 1 : 0);
  statements.push(...await clientAccessStatements(db, input.workspace, input.writes,
    Math.max(0, ACTIVE_STATEMENT_BUDGET - statements.length - shadowReserved)));
  const projection = { staleHeads: [] as string[] };
  if (!input.activeClientDelivery) statements.push(...await clientShadowStatements(db, input.workspace, input.writes,
    Math.max(0, ACTIVE_STATEMENT_BUDGET - statements.length - shadowReserved), active ? 'active' : 'shadow',
    expectedCompatibility, projection, input.reportStaleHeads));
  // Resumo por cliente de cada fatia gravada neste lote (só escritores em `active`
  // marcam a fatia; nem todos guardam a execução, então não depende de `active`), com
  // o cadastro e o catálogo depois da escrita. O que não couber fica defasado.
  statements.push(...await clientSummaryStatements(db, input.workspace, statements, input.writes,
    ACTIVE_STATEMENT_BUDGET - statements.length - shadowReserved - 2));
  let result = input.result;
  const staleHeads = projection.staleHeads;
  if (staleHeads.length) {
    // Sem nomes de clientes no log: a lista vai só para o resultado autorizado.
    console.warn({ event: 'delivery_effective_heads_stale', command: input.command,
      operation: input.id, clients: staleHeads.length });
    if (input.reportStaleHeads) {
      result = withStaleHeads(input.result, staleHeads);
      statements[receiptAt] = receiptStatement(result,
        input.receiptResult === undefined ? undefined : withStaleHeads(input.receiptResult, staleHeads));
    }
  }
  const eventData = (data: unknown) => input.reportStaleHeads && staleHeads.length
    ? { ...(data && typeof data === 'object' ? data : {}), staleHeads } : data ?? {};
  for (const ref of input.references ?? []) statements.push(db.prepare("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id,command,request_hash,operation_id) VALUES(?,?,?,?,?,?,?,?)")
    .bind(input.workspace, ref.system, ref.kind, ref.externalId, ref.entityId, input.command, input.hash, input.id));
  const audit = (event: OperationEvent, eventId: string, data: string) => {
    const source = input.actor.channel ?? (input.actor.kind === "session" ? "interface" : "api");
    statements.push(db.prepare("INSERT INTO client_audit_log(id,workspace_id,operation_id,command,action,area,company,subject,principal_id,actor_id,actor_email,source,application,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(eventId, input.workspace, input.id, input.command, event.type, auditArea(event.type), event.company ?? "", event.subject, input.principal, input.actor.memberId, input.actor.email, source, input.application, data, now));
  };
  for (const event of input.events) {
    const eventId = crypto.randomUUID();
    const data = JSON.stringify({ ...eventData(event.data), versions: Object.fromEntries(input.writes.map(w => [w.key, versions.get(w.key)! + 1])) });
    statements.push(db.prepare("INSERT INTO operation_events(id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(eventId, input.workspace, input.id, event.type, event.company ?? null, event.subject, input.principal, input.application, data, now));
    audit(event, eventId, data);
  }
  for (const event of input.auditEvents ?? []) {
    const data = JSON.stringify({ ...(event.data ?? {}), versions: Object.fromEntries(input.writes.map(w => [w.key, versions.get(w.key)! + 1])) });
    audit(event, crypto.randomUUID(), data);
  }
  if (physicalGuards.length) statements.push(db.prepare("DELETE FROM operation_guards WHERE transaction_id=?").bind(tx));
  if (active) statements.push(db.prepare("DELETE FROM delivery_compatibility_guards WHERE transaction_id=?").bind(tx));
  if (active && statements.length > ACTIVE_STATEMENT_BUDGET) throw new OperationError(503, 'execution_write_too_large',
    'Esta alteração excede o limite de gravação. Divida a operação e tente novamente.');
  try {
    await db.batch(statements);
    // O que foi gravado é o que a próxima leitura desta requisição enxerga.
    forgetDocuments(db);
    for (const write of input.writes)
      rememberDocument(db, input.workspace, write.key, {
        value: write.value,
        version: versions.get(write.key)! + 1,
        updatedAt: now,
      });
  } catch (error) {
    forgetDocuments(db);
    // Concurrent identical calls may have committed while we prepared the batch.
    let replay;
    try {
      replay = await receipt(db, input.workspace, input.principal, input.key, input.command, input.hash);
    } catch (receiptError) {
      // Preserve the write failure when the verification read also fails.
      throw new AggregateError([error, receiptError], "Transaction and receipt lookup failed");
    }
    if (replay) return replay.result;
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
    if (message.includes("state_version_conflict") ||
        message.includes("delivery_client_version_conflict") ||
        message.includes("delivery_global_write_disabled"))
      throw new OperationError(409, "version_conflict", "Os dados ou as permissões mudaram. Atualize e tente novamente.");
    if (message.includes("external_reference_target_in_use"))
      throw new OperationError(409, "external_reference_conflict", "A execução recebeu uma referência externa durante a operação. Atualize e tente novamente.");
    if (message.includes("external_reference_target_deleted"))
      throw new OperationError(409, "external_reference_conflict", "O registro referenciado não existe mais. Atualize a origem antes de tentar novamente.");
    if (message.includes("external_references"))
      throw new OperationError(409, "external_reference_conflict", "Este registro externo já está vinculado. Consulte-o antes de repetir.");
    throw error;
  }
  return result;
}

function withStaleHeads(value: unknown, staleHeads: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return value;
  return { ...result, data: { ...data, staleHeads } };
}
