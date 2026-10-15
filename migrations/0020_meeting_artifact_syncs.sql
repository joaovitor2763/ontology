-- Private recovery pointers only. Files become visible in the final document/meeting transaction.
CREATE TABLE meeting_artifact_syncs (
 workspace_id TEXT NOT NULL,
 principal_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 context TEXT NOT NULL,
 envelope_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,principal_id,idempotency_key)
);
