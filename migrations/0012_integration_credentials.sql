CREATE TABLE integration_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  owner_member_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  scopes TEXT NOT NULL,
  companies TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX integration_credentials_workspace ON integration_credentials(workspace_id);
-- This private marker lets operation version guards reject a concurrent revocation.
CREATE TRIGGER integration_credentials_insert AFTER INSERT ON integration_credentials BEGIN
  INSERT INTO state_documents(workspace_id,key,version,body) VALUES(NEW.workspace_id,'ontology.integrationauth.v1',1,'{}')
  ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER integration_credentials_update AFTER UPDATE ON integration_credentials BEGIN
  INSERT INTO state_documents(workspace_id,key,version,body) VALUES(NEW.workspace_id,'ontology.integrationauth.v1',1,'{}')
  ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER integration_credentials_delete AFTER DELETE ON integration_credentials BEGIN
  INSERT INTO state_documents(workspace_id,key,version,body) VALUES(OLD.workspace_id,'ontology.integrationauth.v1',1,'{}')
  ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1;
END;
