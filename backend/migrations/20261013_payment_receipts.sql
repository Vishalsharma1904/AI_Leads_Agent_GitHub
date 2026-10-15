-- Apply before the billing API rollout. Receipts are writable only by the
-- trusted backend; direct client writes could manufacture paid access.
BEGIN;
CREATE TABLE IF NOT EXISTS payment_receipts (
  payment_id varchar(64) PRIMARY KEY,
  order_id varchar(64) NOT NULL UNIQUE,
  owner_user_id varchar(64) NOT NULL,
  plan varchar(32) NOT NULL,
  amount_paise integer NOT NULL,
  currency varchar(3) NOT NULL,
  status varchar(24) NOT NULL,
  period_start double precision NOT NULL DEFAULT 0,
  period_end double precision NOT NULL DEFAULT 0,
  created_at double precision NOT NULL,
  updated_at double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payment_receipts_owner_user_id ON payment_receipts(owner_user_id);

-- Import the last historical payment without buying another period. Earlier
-- overwritten payment ids are unavailable and need provider reconciliation.
INSERT INTO payment_receipts (payment_id, order_id, owner_user_id, plan, amount_paise,
  currency, status, period_start, period_end, created_at, updated_at)
SELECT payment_id, order_id, owner_user_id, plan,
  CASE plan WHEN 'starter' THEN 49900 ELSE 149900 END,
  'INR', CASE WHEN status IN ('refunded', 'failed') THEN status ELSE 'captured' END,
  GREATEST(COALESCE(period_start, 0), COALESCE(period_end, 0) - 2592000),
  COALESCE(period_end, 0), COALESCE(period_start, 0), COALESCE(updated_at, 0)
FROM subscriptions
WHERE payment_id <> '' AND order_id <> '' AND plan IN ('starter', 'growth')
ON CONFLICT DO NOTHING;

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE payment_receipts FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
