-- Additive: existing captured messages keep their original body and no metadata.
-- Only allowlisted descriptions; no provider URLs, raw payloads or binaries.
ALTER TABLE z_api_messages ADD COLUMN attachment_json TEXT
 CHECK (attachment_json IS NULL OR (json_valid(attachment_json) AND json_type(attachment_json) = 'object'));
