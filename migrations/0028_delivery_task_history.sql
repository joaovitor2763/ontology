-- Recoverable task history, independent of the 40-entry UI snapshot summary.
-- Identical entries observed simultaneously have distinct occurrence numbers.
CREATE TABLE IF NOT EXISTS delivery_task_history (
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  event_at TEXT,
  is_legacy_summary INTEGER NOT NULL DEFAULT 0 CHECK(is_legacy_summary IN (0,1)),
  source_first_version INTEGER NOT NULL,
  source_last_version INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,task_id,entry_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_task_history_task
  ON delivery_task_history(workspace_id,task_id,event_at,entry_hash,occurrence);
