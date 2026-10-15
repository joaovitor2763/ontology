CREATE TABLE integration_cache (
 workspace_id TEXT NOT NULL, key TEXT NOT NULL, body TEXT,
 fetched_at INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_owner TEXT,
 PRIMARY KEY(workspace_id,key)
);
CREATE INDEX integration_cache_expiry ON integration_cache(expires_at);
