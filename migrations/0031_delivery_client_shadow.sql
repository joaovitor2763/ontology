-- Isolated client aggregates. The legacy document remains authoritative in shadow mode.
CREATE TABLE IF NOT EXISTS delivery_client_shadow_meta (
  workspace_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'active')),
  source_delivery_version INTEGER NOT NULL,
  source_clients_version INTEGER NOT NULL,
  expected_clients INTEGER NOT NULL,
  expected_owners INTEGER NOT NULL,
  expected_orphans INTEGER NOT NULL,
  expected_array_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_client_snapshots (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  company TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, company)
);

CREATE TABLE IF NOT EXISTS delivery_entity_owners (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'cycle')),
  id TEXT NOT NULL,
  company TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_entity_owners_company
  ON delivery_entity_owners(workspace_id, generation, company, kind, id);

CREATE TABLE IF NOT EXISTS delivery_client_orphans (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, kind, id)
);

-- Preserve the interleaving of raw arrays across clients for exact rollback.
CREATE TABLE IF NOT EXISTS delivery_client_array_order (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('extraTasks', 'extraCycles')),
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  company TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_client_array_ordinal
  ON delivery_client_array_order(workspace_id, generation, kind, ordinal);

-- A future client-authoritative writer must prove its generation and revision
-- within the same D1 batch. This is deliberately independent of state_documents.
CREATE TABLE IF NOT EXISTS delivery_client_guards (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  company TEXT NOT NULL,
  generation TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  expected_mode TEXT NOT NULL CHECK (expected_mode IN ('shadow', 'active')),
  PRIMARY KEY (transaction_id, workspace_id, company)
);
CREATE TRIGGER IF NOT EXISTS delivery_client_guard_check
BEFORE INSERT ON delivery_client_guards
WHEN NOT EXISTS (
    SELECT 1 FROM delivery_client_shadow_meta m
    JOIN delivery_client_snapshots s
      ON s.workspace_id=m.workspace_id AND s.generation=m.generation
    WHERE m.workspace_id=NEW.workspace_id AND m.generation=NEW.generation
      AND m.mode=NEW.expected_mode AND s.company=NEW.company
      AND s.revision=NEW.expected_revision
  )
BEGIN SELECT RAISE(ABORT, 'delivery_client_version_conflict'); END;
