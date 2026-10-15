ALTER TABLE webhook_subscriptions ADD COLUMN last_polled_at TEXT;
CREATE INDEX webhook_subscriptions_poll ON webhook_subscriptions(workspace_id,active,last_polled_at);
