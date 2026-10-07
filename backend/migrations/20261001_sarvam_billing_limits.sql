-- Apply in production before shipping Voice Calling, plans or daily limits.
-- Development auto-creates these (AUTO_CREATE_SCHEMA); production does not,
-- so without this file every one of those endpoints 500s on a fresh Postgres.

-- One row per tenant: everything needed to place a Sarvam call. No secrets
-- here — the API key lives encrypted in provider_credentials.
CREATE TABLE IF NOT EXISTS sarvam_settings (
  owner_user_id varchar(64) PRIMARY KEY,
  org_id varchar(128) DEFAULT '',
  workspace_id varchar(128) DEFAULT '',
  app_id varchar(128) DEFAULT '',
  app_version integer DEFAULT 1,
  connection_id varchar(128) DEFAULT '',
  agent_phone_number varchar(24) DEFAULT '',
  updated_at double precision
);

-- Razorpay subscriptions. Activated only by a verified signature, never by
-- anything the browser claims.
CREATE TABLE IF NOT EXISTS subscriptions (
  owner_user_id varchar(64) PRIMARY KEY,
  plan varchar(32) DEFAULT '',
  status varchar(24) DEFAULT 'none',
  period_end double precision DEFAULT 0,
  period_start double precision DEFAULT 0,
  calls_used integer DEFAULT 0,
  order_id varchar(64) DEFAULT '',
  payment_id varchar(64) DEFAULT '',
  updated_at double precision
);

-- Daily ceilings and today's spend, per tenant. This table is the reason a
-- customer cannot give themselves more leads or calls: the numbers live here,
-- on the server, not in the app they were shipped.
CREATE TABLE IF NOT EXISTS tenant_limits (
  owner_user_id varchar(64) PRIMARY KEY,
  email varchar(255) DEFAULT '',
  leads_per_day integer DEFAULT 50,
  calls_per_day integer DEFAULT 25,
  day varchar(10) DEFAULT '',
  leads_used integer DEFAULT 0,
  calls_used integer DEFAULT 0,
  leads_total integer DEFAULT 0,
  calls_total integer DEFAULT 0,
  blocked integer DEFAULT 0,
  note varchar(500) DEFAULT '',
  last_seen double precision DEFAULT 0,
  updated_at double precision
);

-- The operator console lists tenants by who was active most recently.
CREATE INDEX IF NOT EXISTS ix_tenant_limits_last_seen ON tenant_limits(last_seen DESC);
