-- Apply to the production PostgreSQL database before deploying product insights.
-- Development SQLite creates these tables automatically when AUTO_CREATE_SCHEMA=true.
CREATE TABLE IF NOT EXISTS product_sessions (
  id varchar(36) PRIMARY KEY,
  user_id varchar(64) NOT NULL,
  device_id varchar(64) NOT NULL,
  device_label varchar(80) NOT NULL,
  platform varchar(24) NOT NULL,
  region varchar(80) NOT NULL,
  started_at double precision NOT NULL,
  last_seen_at double precision NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_product_sessions_user_id ON product_sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_product_sessions_device_id ON product_sessions(device_id);
CREATE INDEX IF NOT EXISTS ix_product_sessions_started_at ON product_sessions(started_at);
CREATE INDEX IF NOT EXISTS ix_product_sessions_last_seen_at ON product_sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS product_errors (
  id varchar(36) PRIMARY KEY,
  user_id varchar(64) NOT NULL,
  kind varchar(24) NOT NULL,
  message varchar(300) NOT NULL,
  page varchar(80) NOT NULL,
  created_at double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_product_errors_user_id ON product_errors(user_id);
CREATE INDEX IF NOT EXISTS ix_product_errors_created_at ON product_errors(created_at);

CREATE TABLE IF NOT EXISTS product_bug_reports (
  id varchar(36) PRIMARY KEY,
  user_id varchar(64) NOT NULL,
  email varchar(255) NOT NULL,
  title varchar(120) NOT NULL,
  description text NOT NULL,
  steps text NOT NULL,
  page varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  created_at double precision NOT NULL,
  updated_at double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_product_bug_reports_user_id ON product_bug_reports(user_id);
CREATE INDEX IF NOT EXISTS ix_product_bug_reports_created_at ON product_bug_reports(created_at);
