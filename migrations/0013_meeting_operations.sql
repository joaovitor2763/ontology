CREATE TABLE meeting_operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  company TEXT NOT NULL,
  command TEXT NOT NULL,
  desired TEXT NOT NULL,
  pending_meeting TEXT NOT NULL,
  calendar_input TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','uncertain','complete')),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  external_result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX meeting_operations_active ON meeting_operations(workspace_id,meeting_id) WHERE status != 'complete';
