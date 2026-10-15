-- Lifecycle removal checks external identity before deleting a mistaken purchase.
CREATE INDEX IF NOT EXISTS external_references_entity
  ON external_references(workspace_id, entity_id);
