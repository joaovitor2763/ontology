CREATE TABLE file_operation_guards (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  expected_status TEXT NOT NULL,
  expected_r2_key TEXT NOT NULL
);
CREATE TRIGGER file_operation_guard BEFORE INSERT ON file_operation_guards
WHEN COALESCE((SELECT status FROM files WHERE workspace_id=NEW.workspace_id AND id=NEW.file_id),'missing') != NEW.expected_status
 OR COALESCE((SELECT r2_key FROM files WHERE workspace_id=NEW.workspace_id AND id=NEW.file_id),'') != NEW.expected_r2_key
BEGIN SELECT RAISE(ABORT,'file_version_conflict'); END;
