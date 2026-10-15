-- Registro de execuções de IA pelo AI Gateway (preparado; sem uso até a IA ser ligada).
CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  requested_by TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_workspace ON ai_runs(workspace_id, created_at);
