-- Pay for 1, 3, 6 or 12 months at a time.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_billing_interval_check;
ALTER TABLE payments ADD CONSTRAINT payments_billing_interval_check
  CHECK (billing_interval IN ('monthly', 'quarterly', 'biannual', 'yearly'));

-- OVO's pricing: Free, Starter and Business are per workspace with people included and a price
-- per extra person; Enterprise is priced on request. These apply to every workspace right away.
INSERT INTO subscription_plans (name, user_limit, storage_limit_bytes, project_limit, monthly_price, yearly_price, currency, sort_order, active, included_users, extra_user_price, features)
VALUES
  ('Free', 3, 524288000, 3, 0, 0, 'NGN', 0, true, 3, NULL,
   '{"forms": 1, "automations": 2, "reports": false, "chatHistoryDays": 90}'::jsonb),
  ('Starter', 50, 26843545600, 20, 15000, 150000, 'NGN', 1, true, 5, 2500,
   '{"forms": 10, "automations": 10, "reports": false, "chatHistoryDays": null}'::jsonb),
  ('Business', 500, 107374182400, NULL, 45000, 450000, 'NGN', 2, true, 15, 2000,
   '{"forms": null, "automations": null, "reports": true, "chatHistoryDays": null}'::jsonb),
  ('Enterprise', 2147483647, 536870912000, NULL, NULL, NULL, 'NGN', 3, true, 2147483647, NULL,
   '{"forms": null, "automations": null, "reports": true, "chatHistoryDays": null}'::jsonb)
ON CONFLICT (name) DO UPDATE SET
  user_limit = EXCLUDED.user_limit, storage_limit_bytes = EXCLUDED.storage_limit_bytes, project_limit = EXCLUDED.project_limit,
  monthly_price = EXCLUDED.monthly_price, yearly_price = EXCLUDED.yearly_price, currency = EXCLUDED.currency,
  sort_order = EXCLUDED.sort_order, active = true, included_users = EXCLUDED.included_users,
  extra_user_price = EXCLUDED.extra_user_price, features = EXCLUDED.features;

-- Older plans are no longer offered (workspaces already on one keep it until they change plan).
UPDATE subscription_plans SET active = false WHERE name NOT IN ('Free', 'Starter', 'Business', 'Enterprise');
