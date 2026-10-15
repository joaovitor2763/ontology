CREATE TABLE webhook_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  principal TEXT NOT NULL,
  types TEXT NOT NULL,
  company TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX webhook_subscriptions_workspace ON webhook_subscriptions(workspace_id,active);
CREATE TABLE webhook_deliveries (
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id),
  event_id TEXT NOT NULL REFERENCES operation_events(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_until TEXT,
  last_status INTEGER,
  completed_at TEXT,
  PRIMARY KEY(subscription_id,event_id)
);
CREATE INDEX webhook_deliveries_pending ON webhook_deliveries(status,next_at);
