-- High-volume integration data stays outside versioned workspace documents.
CREATE TABLE whatsapp_messages (
 workspace_id TEXT NOT NULL, company TEXT NOT NULL, group_key TEXT NOT NULL,
 id TEXT NOT NULL, at TEXT NOT NULL, day TEXT NOT NULL, sender TEXT NOT NULL,
 text TEXT NOT NULL, PRIMARY KEY(workspace_id, company, group_key, id)
);
CREATE INDEX whatsapp_messages_day ON whatsapp_messages(workspace_id, company, group_key, day, at, id);
CREATE INDEX whatsapp_messages_time ON whatsapp_messages(workspace_id, company, group_key, at, id);
CREATE TABLE whatsapp_jobs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, company TEXT NOT NULL, group_key TEXT NOT NULL,
 group_json TEXT NOT NULL, since TEXT NOT NULL, until_at TEXT NOT NULL,
 cursor_at TEXT, cursor_id TEXT, summary_cursor TEXT, phase TEXT NOT NULL DEFAULT 'import', status TEXT NOT NULL DEFAULT 'pending',
 imported INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, requested_by TEXT NOT NULL,
 CHECK(status IN ('pending','running','complete','failed','cancelled'))
);
CREATE UNIQUE INDEX whatsapp_one_active ON whatsapp_jobs(workspace_id,company) WHERE phase='import' AND status IN ('pending','running');
CREATE INDEX whatsapp_jobs_work ON whatsapp_jobs(workspace_id,status,lease_until,created_at);
CREATE TABLE ai_suggestions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, company TEXT NOT NULL,
 source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_hash TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL, model TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 reviewed_at TEXT, reviewed_by TEXT,
 CHECK(status IN ('pending','accepted','dismissed')),
 UNIQUE(workspace_id,company,source_kind,source_id,source_hash)
);
CREATE INDEX ai_suggestions_context ON ai_suggestions(workspace_id,company,source_kind,source_id,status,created_at);
CREATE INDEX ai_suggestions_inbox ON ai_suggestions(workspace_id,company,status,created_at);
CREATE TABLE integration_schedule (workspace_id TEXT NOT NULL, name TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(workspace_id,name));
CREATE TABLE ai_generation_locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX ai_suggestions_page ON ai_suggestions(workspace_id,company,status,created_at,id);
CREATE INDEX whatsapp_jobs_client ON whatsapp_jobs(workspace_id,company,created_at);
