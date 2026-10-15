-- Shadow storage for the execution migration. The legacy document remains authoritative
-- until a validated generation and its readers/writers are activated together.
CREATE TABLE IF NOT EXISTS delivery_generations (
  workspace_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  source_version INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  expected_records INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('loading', 'validated', 'active')),
  created_at TEXT NOT NULL,
  validated_at TEXT,
  PRIMARY KEY (workspace_id, generation)
);

CREATE TABLE IF NOT EXISTS delivery_records (
  workspace_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('extraTasks', 'extraCycles', 'taskPatches', 'cycleEdits', 'statusMap', 'productPlans', 'companyJourney', 'companyMilestone', 'companyJourneyVersion')),
  id TEXT NOT NULL,
  ordinal INTEGER,
  company TEXT,
  enrollment_id TEXT,
  product_id TEXT,
  status TEXT,
  due_at TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, kind, id),
  FOREIGN KEY (workspace_id, generation) REFERENCES delivery_generations(workspace_id, generation) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_delivery_records_client
  ON delivery_records(workspace_id, generation, company, kind, enrollment_id, id);
CREATE INDEX IF NOT EXISTS idx_delivery_records_tasks
  ON delivery_records(workspace_id, generation, kind, company, status, due_at, id);
