-- Login is separate from the per-member Calendar/Meet connection.
CREATE TABLE IF NOT EXISTS login_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_states_expiry ON login_states(expires_at);
CREATE TABLE IF NOT EXISTS login_sessions (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_sessions_expiry ON login_sessions(expires_at);
