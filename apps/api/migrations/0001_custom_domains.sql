CREATE TABLE custom_domains (
  hostname TEXT PRIMARY KEY,
  tunnel_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_dns', 'provisioning', 'active', 'failed')),
  cloudflare_hostname_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX custom_domains_owner_id ON custom_domains(owner_id);
CREATE INDEX custom_domains_tunnel_id ON custom_domains(tunnel_id);
CREATE INDEX custom_domains_routing ON custom_domains(hostname, status);
