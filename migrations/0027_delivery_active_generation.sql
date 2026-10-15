-- Only one relational execution generation may serve a workspace at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_one_active_generation
  ON delivery_generations(workspace_id) WHERE status='active';
