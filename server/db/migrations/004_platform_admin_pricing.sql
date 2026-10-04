-- Plan pricing, editable by platform admins
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(12, 2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_price NUMERIC(12, 2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Suggested launch pricing. Files live in PostgreSQL, so storage is sized to stay
-- profitable on Neon until files move to object storage. Enterprise is priced on request.
UPDATE subscription_plans SET monthly_price = 15000, yearly_price = 150000, storage_limit_bytes = 5368709120, sort_order = 1
WHERE name = 'Starter' AND monthly_price IS NULL;
UPDATE subscription_plans SET monthly_price = 45000, yearly_price = 450000, storage_limit_bytes = 53687091200, project_limit = NULL, sort_order = 2
WHERE name = 'Business' AND monthly_price IS NULL;
UPDATE subscription_plans SET storage_limit_bytes = 268435456000, sort_order = 3
WHERE name = 'Enterprise' AND sort_order = 0;

-- Manually recorded payments: a paid plan runs until current_period_end
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Every platform-admin action is recorded
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  target_name TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);
