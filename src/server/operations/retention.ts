/**
 * Retenção do diário de operações.
 *
 * `operation_receipts` e `operation_events` crescem uma linha por gesto e nunca
 * eram podados. O cron diário apara os dois, com as duas garantias que eles
 * existem para dar:
 *
 * - **Recibo**: é o que impede um pedido repetido de executar duas vezes. Só
 *   sai depois de 30 dias, muito além de qualquer repetição de navegador, de
 *   integração ou de retomada manual — e a janela é maior que a validade de
 *   qualquer credencial de integração em uso.
 * - **Evento**: é a fonte do feed `/events` e das entregas outbound. Só sai
 *   depois de 90 dias **e** quando toda assinatura ativa já passou dele (o
 *   cursor de um assinante parado nunca é pulado) **e** quando não há nenhuma
 *   entrega registrada apontando para ele.
 *
 * Cada execução apara no máximo `LIMIT_PER_RUN` linhas de cada tabela, para a
 * transação continuar pequena; o que sobrar sai na execução seguinte.
 */
const RECEIPT_DAYS = 30;
const EVENT_DAYS = 90;
const LIMIT_PER_RUN = 5000;

export type RetentionEnv = { DB?: D1Database; WORKSPACE_ID?: string };

function cutoff(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function pruneOperationJournal(env: RetentionEnv) {
  if (!env.DB) return { receipts: 0, events: 0 };
  const db = env.DB;
  const workspace = env.WORKSPACE_ID || "default";
  const receipts = await db
    .prepare(
      `DELETE FROM operation_receipts WHERE rowid IN (
         SELECT rowid FROM operation_receipts WHERE workspace_id=? AND created_at<? LIMIT ?)`,
    )
    .bind(workspace, cutoff(RECEIPT_DAYS), LIMIT_PER_RUN)
    .run();
  const events = await db
    .prepare(
      `DELETE FROM operation_events WHERE rowid IN (
         SELECT e.rowid FROM operation_events e
          WHERE e.workspace_id=? AND e.created_at<?
            AND e.sequence <= COALESCE((SELECT MIN(cursor) FROM webhook_subscriptions
                                         WHERE workspace_id=? AND active=1), e.sequence)
            AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id=e.id)
          LIMIT ?)`,
    )
    .bind(workspace, cutoff(EVENT_DAYS), workspace, LIMIT_PER_RUN)
    .run();
  return {
    receipts: receipts.meta.changes ?? 0,
    events: events.meta.changes ?? 0,
  };
}
