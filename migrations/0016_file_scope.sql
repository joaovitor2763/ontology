ALTER TABLE files ADD COLUMN company TEXT;
ALTER TABLE files ADD COLUMN content_hash TEXT;
ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('staged','ready','deleting'));
CREATE INDEX files_company ON files(workspace_id,company);
