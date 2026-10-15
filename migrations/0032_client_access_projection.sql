-- Compact authorization projection. The clients document remains authoritative.
CREATE TABLE IF NOT EXISTS client_access_meta (
  workspace_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  source_clients_version INTEGER NOT NULL,
  expected_companies INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_access_allocations (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  company TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, generation, company)
);
