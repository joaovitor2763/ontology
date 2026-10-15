-- A SQL page is usable only while it represents the exact authoritative
-- client revision. The old global effective generation remains independent.
ALTER TABLE delivery_client_snapshots ADD COLUMN incarnation TEXT NOT NULL DEFAULT '';
UPDATE delivery_client_snapshots SET incarnation=lower(hex(randomblob(16))) WHERE incarnation='';
ALTER TABLE delivery_client_guards ADD COLUMN expected_incarnation TEXT NOT NULL DEFAULT '';
DROP TRIGGER IF EXISTS delivery_client_guard_check;
CREATE TRIGGER delivery_client_guard_check
BEFORE INSERT ON delivery_client_guards
WHEN NOT EXISTS (
  SELECT 1 FROM delivery_client_shadow_meta m
  JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
    AND s.generation=m.generation
  WHERE m.workspace_id=NEW.workspace_id AND m.generation=NEW.generation
    AND m.mode=NEW.expected_mode AND s.company=NEW.company
    AND s.revision=NEW.expected_revision AND s.incarnation=NEW.expected_incarnation
)
BEGIN SELECT RAISE(ABORT, 'delivery_client_version_conflict'); END;
CREATE TABLE IF NOT EXISTS delivery_client_effective_heads (
  workspace_id TEXT NOT NULL,
  company TEXT NOT NULL,
  authority_generation TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_incarnation TEXT NOT NULL,
  projection_generation TEXT NOT NULL,
  expected_tasks INTEGER NOT NULL,
  expected_cycles INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, company)
);
