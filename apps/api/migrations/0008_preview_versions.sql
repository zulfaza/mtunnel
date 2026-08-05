ALTER TABLE previews ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX previews_version_group ON previews(organization_id, name, repo_host, repo_org, repo_name, version);
