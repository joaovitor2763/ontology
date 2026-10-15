-- Durable KV port for the OAuth provider, isolated by workspace.
CREATE TABLE IF NOT EXISTS oauth_provider_kv (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS oauth_provider_expiry ON oauth_provider_kv(expires_at);
