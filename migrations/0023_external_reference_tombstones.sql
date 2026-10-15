CREATE TABLE IF NOT EXISTS external_reference_tombstones (
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, entity_id)
);

CREATE TRIGGER IF NOT EXISTS external_reference_rejects_tombstone
BEFORE INSERT ON external_references
WHEN EXISTS (
  SELECT 1 FROM external_reference_tombstones
  WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'external_reference_target_deleted');
END;

CREATE TRIGGER IF NOT EXISTS tombstone_rejects_external_reference
BEFORE INSERT ON external_reference_tombstones
WHEN EXISTS (
  SELECT 1 FROM external_references
  WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'external_reference_target_in_use');
END;
