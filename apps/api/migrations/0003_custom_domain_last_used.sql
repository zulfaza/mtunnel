ALTER TABLE custom_domains ADD COLUMN last_used_at INTEGER;

CREATE INDEX custom_domains_organization_created
  ON custom_domains(organization_id, created_at DESC);
