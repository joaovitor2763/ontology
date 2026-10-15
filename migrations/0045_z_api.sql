CREATE TABLE z_api_settings (
 workspace_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, credentials_enc TEXT NOT NULL,
 webhook_secret_enc TEXT NOT NULL, webhook_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE z_api_channels (
 workspace_id TEXT NOT NULL, channel TEXT NOT NULL, company TEXT NOT NULL,
 PRIMARY KEY(workspace_id, channel), UNIQUE(workspace_id, company)
);
CREATE TABLE z_api_messages (
 workspace_id TEXT NOT NULL, instance_id TEXT NOT NULL, message_id TEXT NOT NULL,
 channel TEXT NOT NULL, company TEXT NOT NULL, at TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL,
 from_me INTEGER NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id, instance_id, message_id)
);
CREATE INDEX z_api_messages_page ON z_api_messages(workspace_id, channel, at DESC, message_id DESC);
CREATE INDEX z_api_messages_retention ON z_api_messages(received_at);
