-- A rollback or an old Worker must never overwrite client-authoritative data.
-- The gate is inert while the per-client generation remains in shadow mode.
CREATE TRIGGER IF NOT EXISTS delivery_global_insert_gate
BEFORE INSERT ON state_documents
WHEN NEW.key='ontology.delivery.v2' AND EXISTS (
  SELECT 1 FROM delivery_client_shadow_meta
  WHERE workspace_id=NEW.workspace_id AND mode='active'
)
BEGIN SELECT RAISE(ABORT, 'delivery_global_write_disabled'); END;

CREATE TRIGGER IF NOT EXISTS delivery_global_update_gate
BEFORE UPDATE ON state_documents
WHEN NEW.key='ontology.delivery.v2' AND EXISTS (
  SELECT 1 FROM delivery_client_shadow_meta
  WHERE workspace_id=NEW.workspace_id AND mode='active'
)
BEGIN SELECT RAISE(ABORT, 'delivery_global_write_disabled'); END;

CREATE TRIGGER IF NOT EXISTS delivery_global_delete_gate
BEFORE DELETE ON state_documents
WHEN OLD.key='ontology.delivery.v2' AND EXISTS (
  SELECT 1 FROM delivery_client_shadow_meta
  WHERE workspace_id=OLD.workspace_id AND mode='active'
)
BEGIN SELECT RAISE(ABORT, 'delivery_global_write_disabled'); END;
