-- Amplia a trilha permanente para eventos operacionais de todo o workspace.
-- O nome historico da tabela permanece para evitar uma copia destrutiva; uma
-- empresa vazia representa um evento global, sem cliente associado.
ALTER TABLE client_audit_log ADD COLUMN area TEXT NOT NULL DEFAULT 'other';

UPDATE client_audit_log
SET area = CASE
  WHEN instr(action, '.') > 1 THEN substr(action, 1, instr(action, '.') - 1)
  ELSE 'other'
END;

-- A migracao anterior trouxe somente eventos de cliente. Completa o trecho
-- ainda retido do diario com eventos globais, preservando o contexto historico
-- sem inventar canal MCP nem e-mail quando esses dados nao existiam.
INSERT OR IGNORE INTO client_audit_log(
  id, workspace_id, operation_id, command, action, area, company, subject,
  principal_id, actor_id, actor_email, source, application, data, created_at
)
SELECT
  e.id, e.workspace_id, e.operation_id,
  COALESCE(r.command, e.type), e.type,
  CASE
    WHEN instr(e.type, '.') > 1 THEN substr(e.type, 1, instr(e.type, '.') - 1)
    ELSE 'other'
  END,
  COALESCE(e.company, ''), e.subject, e.actor,
  CASE
    WHEN e.actor LIKE 'member:%' THEN substr(e.actor, 8)
    WHEN e.actor LIKE 'integration:%' THEN COALESCE(c.owner_member_id, e.actor)
    ELSE e.actor
  END,
  CASE WHEN e.actor LIKE 'integration:%' THEN c.owner_email ELSE NULL END,
  CASE WHEN e.actor LIKE 'member:%' THEN 'interface' ELSE 'api' END,
  e.application, e.data, e.created_at
FROM operation_events e
LEFT JOIN operation_receipts r
  ON r.workspace_id = e.workspace_id AND r.id = e.operation_id
LEFT JOIN integration_credentials c
  ON c.workspace_id = e.workspace_id AND ('integration:' || c.id) = e.actor
ORDER BY e.created_at ASC, e.sequence ASC;

-- Materializa categorias estaveis para a Data Table, independentemente de o
-- evento historico usar singular, plural ou o nome do comando.
UPDATE client_audit_log
SET area = CASE
  WHEN area IN ('client','clients') THEN 'client'
  WHEN area IN ('enrollment','enrollments') THEN 'enrollment'
  WHEN area IN ('sale','sales') THEN 'sale'
  WHEN area IN ('stakeholder','stakeholders') THEN 'stakeholder'
  WHEN area IN ('participant','participants') THEN 'participant'
  WHEN area IN ('allocation','allocations') THEN 'allocation'
  WHEN area IN ('product','products','product_rollout','product-rollouts') THEN 'product'
  WHEN area IN ('plan','plans') THEN 'plan'
  WHEN area IN ('cycle','cycles') THEN 'cycle'
  WHEN area IN ('task','tasks') THEN 'task'
  WHEN area IN ('meeting','meetings') THEN 'meeting'
  WHEN area IN ('program-event','program-events') THEN 'agenda'
  WHEN area IN ('interaction','interactions','inbox','signal','signals') THEN 'engagement'
  WHEN area IN ('pain','pains','solution','solutions','hypothesis','hypotheses') THEN 'diagnosis'
  WHEN area IN ('document','documents') THEN 'document'
  WHEN area IN ('member','members') THEN 'member'
  WHEN area IN ('webhook','webhooks') THEN 'webhook'
  WHEN area IN ('alert','alerts') THEN 'alert'
  ELSE area
END;

CREATE INDEX client_audit_log_workspace
  ON client_audit_log(workspace_id, created_at DESC, sequence DESC);
CREATE INDEX client_audit_log_area
  ON client_audit_log(workspace_id, area, created_at DESC, sequence DESC);
CREATE INDEX client_audit_log_company_time
  ON client_audit_log(workspace_id, company, created_at DESC, sequence DESC);
CREATE INDEX client_audit_log_actor
  ON client_audit_log(workspace_id, actor_id, created_at DESC, sequence DESC);
CREATE INDEX client_audit_log_source
  ON client_audit_log(workspace_id, source, created_at DESC, sequence DESC);
