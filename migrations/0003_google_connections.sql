-- Conexões individuais com o Google (Agenda e Meet). O refresh token fica cifrado
-- com GOOGLE_TOKEN_KEY; tokens de acesso nunca são gravados.
CREATE TABLE IF NOT EXISTS google_connections (
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  account_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_email)
);
-- Estados de autorização em andamento (PKCE); expiram em 10 minutos.
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  verifier_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
