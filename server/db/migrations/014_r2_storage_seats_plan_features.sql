-- Files and chat documents can live in Cloudflare R2 (storage_key) instead of the database (data).
ALTER TABLE files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS files_storage_key_unique ON files (storage_key) WHERE storage_key IS NOT NULL;
ALTER TABLE chat_attachments ALTER COLUMN data DROP NOT NULL;
ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS storage_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS chat_attachments_storage_key_unique ON chat_attachments (storage_key) WHERE storage_key IS NOT NULL;

-- Plans include some people; more can be added per person. Features hold each plan's limits.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS included_users INTEGER;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS extra_user_price NUMERIC(12, 2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
-- How many people a workspace has paid for (null = what the plan includes).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS seats INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS seats INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'plan';

INSERT INTO subscription_plans (name, user_limit, storage_limit_bytes, project_limit, monthly_price, yearly_price, currency, sort_order, included_users, extra_user_price, features)
VALUES ('Free', 3, 524288000, 3, 0, 0, 'NGN', 0, 3, NULL, '{"forms": 1, "automations": 2, "reports": false, "chatHistoryDays": 90}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Defaults for the paid plans, only where the owner hasn't set them yet.
UPDATE subscription_plans SET included_users = 5, user_limit = GREATEST(user_limit, 50), extra_user_price = 2500,
  features = '{"forms": 10, "automations": 10, "reports": false, "chatHistoryDays": null}'::jsonb
WHERE name = 'Starter' AND included_users IS NULL;
UPDATE subscription_plans SET included_users = 15, user_limit = GREATEST(user_limit, 500), extra_user_price = 2000,
  features = '{"forms": null, "automations": null, "reports": true, "chatHistoryDays": null}'::jsonb
WHERE name = 'Business' AND included_users IS NULL;
UPDATE subscription_plans SET included_users = user_limit,
  features = '{"forms": null, "automations": null, "reports": true, "chatHistoryDays": null}'::jsonb
WHERE included_users IS NULL;
