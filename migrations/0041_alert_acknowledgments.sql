-- Ciência de alerta por pessoa. Antes, "Marcar como visto" gravava o ID na
-- lista `hidden` do documento do workspace e escondia o alerta para toda a
-- equipe; agora cada membro tem a própria fila. A lista `hidden` continua sendo
-- lida como arquivo da equipe até `scripts/migrate-alert-acknowledgments.mjs`
-- atribuir os IDs a quem os marcou; depois só guarda os que não têm autor.
-- A chave primária cobre a leitura da fila (workspace + membro).
CREATE TABLE IF NOT EXISTS alert_acknowledgments (
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  company TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, member_id, company, alert_id)
) WITHOUT ROWID;
