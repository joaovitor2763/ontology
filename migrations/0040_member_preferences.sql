-- Preferências pessoais de interface (visões salvas, aba inicial do cliente).
-- Uma linha por pessoa e chave; o navegador mantém uma cópia para abrir sem
-- esperar a rede, e a mais recente vence.
CREATE TABLE IF NOT EXISTS member_preferences (
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email, key)
);
