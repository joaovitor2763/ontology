-- Auditoria permanente e append-only das mutacoes vinculadas a clientes.
-- Diferente de operation_events, esta tabela nao participa do feed/outbound e
-- nao e removida pela politica de retencao do diario operacional.
-- Operacoes de agenda podem terminar em outra requisicao; o snapshot abaixo
-- preserva o autor e o canal da intencao original durante a reconciliacao.
ALTER TABLE meeting_operations ADD COLUMN actor_id TEXT;
ALTER TABLE meeting_operations ADD COLUMN actor_email TEXT;
ALTER TABLE meeting_operations ADD COLUMN actor_source TEXT CHECK(actor_source IN ('interface','api','mcp'));
ALTER TABLE meeting_operations ADD COLUMN actor_application TEXT;

CREATE TABLE client_audit_log (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  command TEXT NOT NULL,
  action TEXT NOT NULL,
  company TEXT NOT NULL,
  subject TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_email TEXT,
  source TEXT NOT NULL CHECK(source IN ('interface','api','mcp')),
  application TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX client_audit_log_company
  ON client_audit_log(workspace_id, company, sequence DESC);
CREATE INDEX client_audit_log_operation
  ON client_audit_log(workspace_id, operation_id);
CREATE INDEX client_audit_log_subject
  ON client_audit_log(workspace_id, company, action, subject, operation_id);

-- Aproveita o trecho ainda retido do diario para clientes atuais. Eventos
-- antigos nao distinguiam REST de MCP e nao guardavam o e-mail da sessao;
-- nesses casos preservamos a identidade tecnica disponivel sem inventar dado.
INSERT OR IGNORE INTO client_audit_log(
  id, workspace_id, operation_id, command, action, company, subject,
  principal_id, actor_id, actor_email, source, application, data, created_at
)
SELECT
  e.id, e.workspace_id, e.operation_id,
  COALESCE(r.command, e.type), e.type, e.company, e.subject,
  e.actor,
  CASE
    WHEN e.actor LIKE 'member:%' THEN substr(e.actor, 8)
    WHEN c.owner_member_id IS NOT NULL THEN c.owner_member_id
    ELSE e.actor
  END,
  c.owner_email,
  CASE WHEN e.application = 'web' THEN 'interface' ELSE 'api' END,
  e.application, e.data, e.created_at
FROM operation_events e
LEFT JOIN operation_receipts r
  ON r.workspace_id = e.workspace_id AND r.id = e.operation_id
LEFT JOIN integration_credentials c
  ON c.workspace_id = e.workspace_id AND e.actor = 'integration:' || c.id
WHERE e.company IS NOT NULL
ORDER BY e.sequence ASC;
