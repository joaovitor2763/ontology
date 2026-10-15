ALTER TABLE webhook_subscriptions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE webhook_management_guards (
 id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 checked_at TEXT NOT NULL
);
CREATE TRIGGER webhook_management_guard BEFORE INSERT ON webhook_management_guards
WHEN NOT EXISTS (SELECT 1 FROM webhook_subscriptions WHERE id=NEW.subscription_id AND revision=NEW.revision)
 OR EXISTS (SELECT 1 FROM webhook_deliveries WHERE subscription_id=NEW.subscription_id AND lease_until>NEW.checked_at)
BEGIN SELECT RAISE(ABORT,'webhook_management_conflict'); END;
CREATE TABLE webhook_attempts (
 subscription_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 attempt INTEGER NOT NULL,
 attempted_at TEXT NOT NULL,
 status_code INTEGER,
 outcome TEXT NOT NULL,
 PRIMARY KEY(subscription_id,event_id,attempt),
 FOREIGN KEY(subscription_id,event_id) REFERENCES webhook_deliveries(subscription_id,event_id)
);

ALTER TABLE webhook_deliveries ADD COLUMN retry_start_attempt INTEGER NOT NULL DEFAULT 0;
