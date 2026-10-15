/**
 * Atribui a lista compartilhada antiga (`hidden` do documento do workspace) a
 * quem marcou cada alerta, a partir dos eventos e da auditoria de
 * `alerts.acknowledge` e `alerts.acknowledgeBatch`. Puro: o script
 * `scripts/migrate-alert-acknowledgments.mjs` lê o D1, chama isto e grava.
 *
 * Um ID sem autor identificável (gravado antes das operações, ou por evento
 * cujo principal não se resolve em membro) continua em `hidden`, escondido
 * para toda a equipe como antes.
 */
export type AcknowledgmentSource = {
  type: string;
  company: string | null;
  subject: string;
  data: string | null;
  createdAt: string;
  /** `client_audit_log.actor_id`: o membro, quando a auditoria existe. */
  memberId?: string | null;
  /** `operation_events.actor`: `member:<id>`, `integration:<credencial>` ou `oauth:…`. */
  principal?: string | null;
};

export type PlannedAcknowledgment = { memberId: string; company: string; alertId: string; acknowledgedAt: string };

const TYPES = new Set(['alerts.acknowledge', 'alerts.acknowledgeBatch']);

function alertIdsOf(source: AcknowledgmentSource): string[] {
  if (source.type === 'alerts.acknowledge') return source.subject ? [source.subject] : [];
  try {
    const data = JSON.parse(source.data ?? '{}') as { alertIds?: unknown };
    return Array.isArray(data.alertIds) ? data.alertIds.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Um ID de membro é simples; `oauth:…` e outros atores herdados do backfill 0024 não são pessoas. */
const plainMember = (id: string | null | undefined) => id && !id.includes(':') ? id : null;

function memberOf(source: AcknowledgmentSource, credentialOwners: ReadonlyMap<string, string>) {
  // Autor desconhecido não é atribuído: o alerta continua no arquivo compartilhado.
  if (source.memberId) return plainMember(source.memberId);
  const principal = source.principal ?? '';
  if (principal.startsWith('member:')) return plainMember(principal.slice(7));
  if (principal.startsWith('integration:')) return plainMember(credentialOwners.get(principal.slice(12)));
  return null;
}

export function planAlertAcknowledgmentMigration(input: {
  hidden: readonly string[];
  sources: readonly AcknowledgmentSource[];
  credentialOwners?: ReadonlyMap<string, string>;
}) {
  const hidden = new Set(input.hidden);
  const owners = input.credentialOwners ?? new Map<string, string>();
  const rows = new Map<string, PlannedAcknowledgment>();
  let unresolvedSources = 0;
  for (const source of input.sources) {
    if (!TYPES.has(source.type) || !source.company) continue;
    const ids = alertIdsOf(source).filter(id => hidden.has(id));
    if (!ids.length) continue;
    const memberId = memberOf(source, owners);
    if (!memberId) { unresolvedSources++; continue; }
    for (const alertId of ids) {
      const key = `${memberId}\u0000${source.company}\u0000${alertId}`;
      const previous = rows.get(key);
      // A primeira ciência é a que vale, como no INSERT OR IGNORE do comando.
      if (!previous || source.createdAt < previous.acknowledgedAt)
        rows.set(key, { memberId, company: source.company, alertId, acknowledgedAt: source.createdAt });
    }
  }
  const planned = [...rows.values()].sort((a, b) =>
    a.memberId.localeCompare(b.memberId) || a.company.localeCompare(b.company) || a.alertId.localeCompare(b.alertId));
  const attributed = new Set(planned.map(row => row.alertId));
  const remaining = input.hidden.filter(id => !attributed.has(id));
  return {
    rows: planned,
    /** IDs que saem da lista compartilhada: cada um tem pelo menos uma pessoa. */
    removed: [...attributed].sort(),
    remaining,
    counts: {
      hidden: hidden.size,
      attributed: attributed.size,
      unattributed: new Set(remaining).size,
      rows: planned.length,
      members: new Set(planned.map(row => row.memberId)).size,
      unresolvedSources,
    },
  };
}

/** Linhas em comandos de até `maxBytes`, cada uma com um único literal JSON (`json_each`). */
export function acknowledgmentInsertSql(workspace: string, rows: readonly PlannedAcknowledgment[], maxBytes = 90_000) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const statement = (chunk: PlannedAcknowledgment[]) => `INSERT OR IGNORE INTO alert_acknowledgments
  (workspace_id,member_id,company,alert_id,acknowledged_at)
  SELECT ${quote(workspace)},json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]')
  FROM json_each(${quote(JSON.stringify(chunk.map(row => [row.memberId, row.company, row.alertId, row.acknowledgedAt])))});`;
  const statements: string[] = [];
  let chunk: PlannedAcknowledgment[] = [];
  for (const row of rows) {
    if (chunk.length && new TextEncoder().encode(statement([...chunk, row])).byteLength > maxBytes) {
      statements.push(statement(chunk));
      chunk = [];
    }
    chunk.push(row);
  }
  if (chunk.length) statements.push(statement(chunk));
  return statements;
}

/**
 * Tira `removed` de `hidden` só se o documento ainda está na versão lida (CAS),
 * sem reenviar o corpo: o JSON é reescrito pelo próprio SQLite. Registra a
 * versão nova em `state_history` e poda o histórico como `commitOperation`.
 * O primeiro comando devolve uma linha quando gravou.
 */
export function sharedListUpdateSql(input: { workspace: string; key: string; version: number;
  removed: readonly string[]; now: string; by: string }) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const ws = quote(input.workspace), key = quote(input.key), by = quote(input.by), next = input.version + 1;
  return `UPDATE state_documents SET
    body=json_set(body,'$.hidden',json((SELECT json_group_array(value) FROM json_each(state_documents.body,'$.hidden')
      WHERE value NOT IN (SELECT value FROM json_each(${quote(JSON.stringify(input.removed))}))))),
    version=${next},updated_at=${quote(input.now)},updated_by=${by}
  WHERE workspace_id=${ws} AND key=${key} AND version=${input.version} AND substr(body,1,1)='{'
  RETURNING version;
  INSERT INTO state_history(workspace_id,key,version,updated_at,updated_by,body)
    SELECT workspace_id,key,version,updated_at,updated_by,body FROM state_documents
    WHERE workspace_id=${ws} AND key=${key} AND version=${next} AND updated_by=${by}
      AND NOT EXISTS (SELECT 1 FROM state_history WHERE workspace_id=${ws} AND key=${key} AND version=${next});
  DELETE FROM state_history WHERE workspace_id=${ws} AND key=${key} AND version<=${next - 50};`;
}
