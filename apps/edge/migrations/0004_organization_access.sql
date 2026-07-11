CREATE TABLE organization_access (
  organization_id TEXT PRIMARY KEY,
  unrestricted INTEGER NOT NULL DEFAULT 0 CHECK (unrestricted IN (0, 1)),
  updated_at INTEGER NOT NULL
);
