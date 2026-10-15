-- Every operation commits data, receipt and events together. Guards also cover
-- read-only dependencies (membership, allocation, catalogue) at commit time.
CREATE TABLE operation_guards (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  expected_version INTEGER NOT NULL CHECK(expected_version >= 0),
  PRIMARY KEY(transaction_id, key)
);
CREATE TRIGGER operation_version_guard BEFORE INSERT ON operation_guards
WHEN COALESCE((SELECT version FROM state_documents WHERE workspace_id = NEW.workspace_id AND key = NEW.key), 0) != NEW.expected_version
BEGIN SELECT RAISE(ABORT, 'state_version_conflict'); END;
CREATE TABLE operation_receipts (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, principal_id, idempotency_key)
);
CREATE TABLE operation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  company TEXT,
  subject TEXT NOT NULL,
  actor TEXT NOT NULL,
  application TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX operation_events_feed ON operation_events(workspace_id, sequence);
CREATE TABLE external_references (
  workspace_id TEXT NOT NULL,
  system TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  command TEXT,
  request_hash TEXT,
  operation_id TEXT,
  PRIMARY KEY(workspace_id, system, kind, external_id)
);
