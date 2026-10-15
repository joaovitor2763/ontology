-- Cursor pagination uses the task and event ordering, including undated legacy events.
CREATE INDEX IF NOT EXISTS idx_delivery_task_history_page
  ON delivery_task_history(workspace_id, task_id, COALESCE(event_at, ''), entry_id);
