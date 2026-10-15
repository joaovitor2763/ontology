-- The legacy browser protocol needs a logical version after the global document freezes.
-- Client commands will advance this counter in their snapshot transaction.
ALTER TABLE delivery_client_shadow_meta
  ADD COLUMN compatibility_version INTEGER NOT NULL DEFAULT 0;
UPDATE delivery_client_shadow_meta
  SET compatibility_version=source_delivery_version;
