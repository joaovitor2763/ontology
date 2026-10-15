-- The global delivery document freezes in active mode. A logical-version guard
-- protects commands that read it, including commands that only write another
-- document, against a concurrent client-authoritative write or mode switch.
CREATE TABLE IF NOT EXISTS delivery_compatibility_guards (
  transaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, workspace_id)
);
CREATE TRIGGER IF NOT EXISTS delivery_compatibility_guard_check
BEFORE INSERT ON delivery_compatibility_guards
WHEN NOT EXISTS (
  SELECT 1 FROM delivery_client_shadow_meta m
  JOIN state_documents d ON d.workspace_id=m.workspace_id
    AND d.key='ontology.delivery.v2' AND d.version=m.source_delivery_version
  JOIN state_documents c ON c.workspace_id=m.workspace_id
    AND c.key='ontology.clients.v3' AND c.version=m.source_clients_version
  WHERE m.workspace_id=NEW.workspace_id AND m.generation=NEW.generation
    AND m.mode='active' AND m.compatibility_version=NEW.expected_version
)
BEGIN SELECT RAISE(ABORT, 'delivery_client_version_conflict'); END;
