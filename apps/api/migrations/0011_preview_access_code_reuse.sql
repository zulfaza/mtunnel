ALTER TABLE preview_access_codes ADD COLUMN revoked_at INTEGER;

UPDATE preview_access_codes SET revoked_at = used_at WHERE used_at IS NOT NULL;

DROP INDEX preview_access_codes_document;

CREATE INDEX preview_access_codes_document_active
ON preview_access_codes(document_id, code_fingerprint, revoked_at);
