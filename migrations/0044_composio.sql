CREATE TABLE IF NOT EXISTS composio_settings (
  workspace_id TEXT PRIMARY KEY,
  api_key_enc TEXT NOT NULL,
  auth_configs TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS composio_connections (
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  toolkit_slug TEXT NOT NULL,
  connected_account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, member_id, toolkit_slug),
  UNIQUE (workspace_id, connected_account_id)
);
