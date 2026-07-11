ALTER TABLE billing_accounts ADD COLUMN stripe_price_id TEXT;
ALTER TABLE billing_accounts ADD COLUMN stripe_current_period_start INTEGER;
ALTER TABLE billing_accounts ADD COLUMN stripe_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_accounts ADD COLUMN stripe_payment_method_brand TEXT;
ALTER TABLE billing_accounts ADD COLUMN stripe_payment_method_last4 TEXT;
