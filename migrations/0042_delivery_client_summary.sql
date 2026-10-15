-- Resumo da execução por cliente para carteira, fila e contador de alertas.
-- Uma linha vale só para a fatia exata (geração, revisão, encarnação) e para os
-- valores de cadastro/catálogo registrados em `inputs`/`body`; qualquer
-- diferença faz o leitor projetar a fatia, como fazia antes desta tabela.
CREATE TABLE IF NOT EXISTS delivery_client_summary (
  workspace_id TEXT NOT NULL,
  company TEXT NOT NULL,
  authority_generation TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_incarnation TEXT NOT NULL,
  inputs TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, company)
);
