ALTER TABLE custom_domains RENAME COLUMN owner_id TO organization_id;

DROP INDEX custom_domains_owner_id;
CREATE INDEX custom_domains_organization_id ON custom_domains(organization_id);
