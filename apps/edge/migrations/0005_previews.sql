CREATE TABLE previews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  manifest TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX previews_organization_id ON previews(organization_id);
CREATE INDEX previews_expires_at ON previews(expires_at);
