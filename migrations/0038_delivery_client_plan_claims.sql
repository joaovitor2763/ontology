-- Raw plan references are a separate, revision-bound projection. A missing or
-- stale head cannot certify that a new private plan ID is free in the workspace.
CREATE TABLE IF NOT EXISTS delivery_client_plan_claims (
  workspace_id TEXT NOT NULL,
  projection_generation TEXT NOT NULL,
  company TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, projection_generation, company, plan_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_client_plan_claim_id
  ON delivery_client_plan_claims(workspace_id, projection_generation, plan_id, company);

CREATE TABLE IF NOT EXISTS delivery_client_plan_claim_heads (
  workspace_id TEXT NOT NULL,
  company TEXT NOT NULL,
  authority_generation TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_incarnation TEXT NOT NULL,
  projection_generation TEXT NOT NULL,
  expected_claims INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, company)
);
