-- Pending ranges are separate from the requested analysis window.
ALTER TABLE whatsapp_jobs ADD COLUMN import_ranges TEXT;
CREATE INDEX whatsapp_jobs_coverage ON whatsapp_jobs(workspace_id,company,group_key,phase,since,until_at);
