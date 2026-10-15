-- Preserve global insertion order of raw maps when client slices are reconstructed.
CREATE TABLE IF NOT EXISTS delivery_client_map_order (
  workspace_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cycleEdits','statusMap','taskPatches',
    'productPlans','companyJourney','companyMilestone','companyJourneyVersion')),
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, generation, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_client_map_ordinal
  ON delivery_client_map_order(workspace_id, generation, kind, ordinal);
ALTER TABLE delivery_client_shadow_meta
  ADD COLUMN expected_map_order INTEGER NOT NULL DEFAULT 0;
