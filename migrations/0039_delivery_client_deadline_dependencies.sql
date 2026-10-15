-- Raw task deadline dependencies match the destructive enrollment guard,
-- including removed extra tasks and patches of seed tasks.
CREATE TABLE IF NOT EXISTS delivery_client_deadline_dependencies (
  workspace_id TEXT NOT NULL,
  projection_generation TEXT NOT NULL,
  company TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  target_task_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, projection_generation, company, source_task_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_client_deadline_target
  ON delivery_client_deadline_dependencies(workspace_id, projection_generation, target_task_id);

CREATE TABLE IF NOT EXISTS delivery_client_deadline_heads (
  workspace_id TEXT NOT NULL,
  company TEXT NOT NULL,
  authority_generation TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_incarnation TEXT NOT NULL,
  projection_generation TEXT NOT NULL,
  expected_dependencies INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, company)
);
