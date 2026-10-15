/**
 * Ciência de alerta por pessoa (`alert_acknowledgments`, migração 0041).
 *
 * "Marcar como visto" tira o alerta da fila de quem marcou; para o resto da
 * equipe ele continua aberto. A lista `hidden` do documento do workspace é o
 * arquivo antigo, compartilhado: continua escondendo para todos o que ainda não
 * foi atribuído a alguém por `scripts/migrate-alert-acknowledgments.mjs`.
 */
export type Acknowledged = {
  /** `empresa\u0000alerta` já marcados pelo membro. */
  keys: Set<string>;
  /** Muda sempre que o membro marca algo. */
  fingerprint: string;
};

export const acknowledgmentKey = (company: string, alertId: string) => `${company}\u0000${alertId}`;

/** Uma ida ao D1 por requisição: tudo o que o membro já marcou no workspace. */
export async function readAcknowledged(db: D1Database, workspace: string, memberId: string): Promise<Acknowledged> {
  return acknowledgedFrom(await acknowledgmentsStatement(db, workspace, memberId).all());
}

/** O comando de `readAcknowledged`, para ir no lote de outra leitura. */
export function acknowledgmentsStatement(db: D1Database, workspace: string, memberId: string) {
  return db.prepare(`SELECT company,alert_id,acknowledged_at FROM alert_acknowledgments
    WHERE workspace_id=? AND member_id=?`).bind(workspace, memberId);
}

export function acknowledgedFrom(result: Pick<D1Result, 'results'>): Acknowledged {
  let latest = '';
  const keys = new Set<string>();
  for (const row of result.results as { company: string; alert_id: string; acknowledged_at: string }[]) {
    keys.add(acknowledgmentKey(row.company, row.alert_id));
    if (row.acknowledged_at > latest) latest = row.acknowledged_at;
  }
  return { keys, fingerprint: `${keys.size}:${latest}` };
}

/** Visível para quem pede: nem no arquivo da equipe, nem marcado pela pessoa. */
export function unseenBy(acknowledged: Acknowledged, legacyHidden: readonly string[] | undefined) {
  const hidden = new Set(legacyHidden ?? []);
  return (alert: { company: string; id: string }) =>
    !hidden.has(alert.id) && !acknowledged.keys.has(acknowledgmentKey(alert.company, alert.id));
}

/**
 * Um comando para a seleção inteira: as linhas vão num único parâmetro JSON
 * (`json_each`), longe do limite de 100 parâmetros por comando do D1, e contam
 * um comando só no orçamento do batch.
 */
export function acknowledgmentStatement(db: D1Database, workspace: string, memberId: string,
  rows: { company: string; alertId: string }[], at: string) {
  return db.prepare(`INSERT OR IGNORE INTO alert_acknowledgments
    (workspace_id,member_id,company,alert_id,acknowledged_at)
    SELECT ?,?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),? FROM json_each(?)`)
    .bind(workspace, memberId, at, JSON.stringify(rows.map(row => [row.company, row.alertId])));
}
