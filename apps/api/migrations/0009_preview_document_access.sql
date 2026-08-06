ALTER TABLE previews ADD COLUMN document_id TEXT;

UPDATE previews AS target
SET document_id = (
  SELECT source.id
  FROM previews AS source
  WHERE source.organization_id = target.organization_id
    AND source.name = target.name
    AND source.repo_host IS target.repo_host
    AND source.repo_org IS target.repo_org
    AND source.repo_name IS target.repo_name
  ORDER BY source.created_at, source.id
  LIMIT 1
);

CREATE INDEX previews_document_id ON previews(document_id);

CREATE TABLE preview_access_codes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_session_hash TEXT
);

CREATE INDEX preview_access_codes_document
ON preview_access_codes(document_id, code_fingerprint, used_at);

INSERT INTO preview_access_codes (id, document_id, code_hash, created_at)
SELECT id, document_id, access_code_hash, created_at
FROM previews
WHERE visibility = 'code' AND access_code_hash IS NOT NULL;

CREATE TABLE preview_access_grants (
  session_hash TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (session_hash, document_id)
);

CREATE INDEX preview_access_grants_expires_at ON preview_access_grants(expires_at);
