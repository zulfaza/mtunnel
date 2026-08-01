ALTER TABLE previews ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE previews ADD COLUMN access_code_hash TEXT;
