-- Validated, queryable projection of the tasks and cycles shown by the product.
-- The legacy document stays authoritative until every writer has moved.
CREATE TABLE IF NOT EXISTS delivery_effective_meta (
  workspace_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  expected_tasks INTEGER NOT NULL,
  expected_cycles INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_client_revisions (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  company TEXT NOT NULL,
  revision INTEGER NOT NULL,
  task_count INTEGER NOT NULL,
  cycle_count INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, generation, company)
);

CREATE TABLE IF NOT EXISTS delivery_effective_tasks (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  company TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  enrollment_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  owner_id TEXT,
  milestone INTEGER,
  kind TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, company, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_page
  ON delivery_effective_tasks(workspace_id, generation, company, ordinal, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_due
  ON delivery_effective_tasks(workspace_id, generation, company, due_at, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_due_order
  ON delivery_effective_tasks(workspace_id, generation, company,
    CASE WHEN due_at IS NULL OR due_at='' THEN 1 ELSE 0 END, due_at, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_status_due
  ON delivery_effective_tasks(workspace_id, generation, company, status, due_at, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_status_due_order
  ON delivery_effective_tasks(workspace_id, generation, company, status,
    CASE WHEN due_at IS NULL OR due_at='' THEN 1 ELSE 0 END, due_at, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_tasks_enrollment
  ON delivery_effective_tasks(workspace_id, generation, company, enrollment_id, ordinal, id);

CREATE TABLE IF NOT EXISTS delivery_effective_cycles (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  company TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  enrollment_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, company, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_cycles_page
  ON delivery_effective_cycles(workspace_id, generation, company, ordinal, id);
CREATE INDEX IF NOT EXISTS idx_delivery_effective_cycles_enrollment
  ON delivery_effective_cycles(workspace_id, generation, company, enrollment_id, ordinal, id);
