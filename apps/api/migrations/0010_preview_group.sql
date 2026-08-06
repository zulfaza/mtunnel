ALTER TABLE previews ADD COLUMN group_name TEXT;
CREATE INDEX previews_custom_group_version ON previews(organization_id, group_name, name, repo_host, repo_org, repo_name, version);
