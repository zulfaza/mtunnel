CREATE TABLE billing_accounts (
  organization_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_status TEXT,
  stripe_current_period_end INTEGER,
  domain_credits INTEGER NOT NULL DEFAULT 0 CHECK (domain_credits >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE billing_orders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('midtrans', 'stripe')),
  amount_idr INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX billing_orders_organization_created
  ON billing_orders(organization_id, created_at DESC);

CREATE TABLE billing_domain_credits (
  order_id TEXT PRIMARY KEY REFERENCES billing_orders(id),
  organization_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX billing_domain_credits_organization
  ON billing_domain_credits(organization_id);
