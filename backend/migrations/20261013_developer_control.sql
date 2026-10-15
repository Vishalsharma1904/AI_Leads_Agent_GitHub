-- Apply after backup using the backend database search_path. No user credentials/client grants.

BEGIN;

CREATE TABLE IF NOT EXISTS account_controls (
	user_id VARCHAR(64) NOT NULL, 
	status VARCHAR(16) DEFAULT 'pending' NOT NULL, 
	expires_at FLOAT DEFAULT 0 NOT NULL, 
	features TEXT DEFAULT '{}' NOT NULL, 
	monthly_limits TEXT DEFAULT '{}' NOT NULL, 
	note VARCHAR(500) DEFAULT '' NOT NULL, 
	revision INTEGER DEFAULT 1 NOT NULL, 
	disclosure_version VARCHAR(32) DEFAULT '' NOT NULL, 
	disclosure_at FLOAT DEFAULT 0 NOT NULL, 
	revoked_before FLOAT DEFAULT 0 NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (user_id)
);

ALTER TABLE account_controls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON account_controls FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS control_audit (
	id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(64) NOT NULL, 
	target_id VARCHAR(64) NOT NULL, 
	action VARCHAR(64) NOT NULL, 
	detail TEXT DEFAULT '{}' NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_control_audit_created_at ON control_audit (created_at);

CREATE INDEX IF NOT EXISTS ix_control_audit_actor_id ON control_audit (actor_id);

CREATE INDEX IF NOT EXISTS ix_control_audit_target_id ON control_audit (target_id);

ALTER TABLE control_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON control_audit FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS control_releases (
	id VARCHAR(36) NOT NULL, 
	version VARCHAR(40) NOT NULL, 
	platform VARCHAR(20) NOT NULL, 
	manifest TEXT NOT NULL, 
	notes VARCHAR(2000) DEFAULT '' NOT NULL, 
	status VARCHAR(16) DEFAULT 'draft' NOT NULL, 
	cohort INTEGER DEFAULT 0 NOT NULL, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (id)
);

ALTER TABLE control_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON control_releases FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS control_usage (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(64) NOT NULL, 
	request_id VARCHAR(160) NOT NULL, 
	meter VARCHAR(32) NOT NULL, 
	provider VARCHAR(64) DEFAULT '' NOT NULL, 
	amount FLOAT DEFAULT 0 NOT NULL, 
	state VARCHAR(24) DEFAULT 'reserved' NOT NULL, 
	basis VARCHAR(24) DEFAULT 'app_count' NOT NULL, 
	estimated_cost FLOAT, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_control_usage_request UNIQUE (user_id, request_id, meter)
);

CREATE INDEX IF NOT EXISTS ix_control_usage_user_id ON control_usage (user_id);

CREATE INDEX IF NOT EXISTS ix_control_usage_created_at ON control_usage (created_at);

ALTER TABLE control_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON control_usage FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS managed_sessions (
	user_id VARCHAR(64) NOT NULL, 
	session_id VARCHAR(128) NOT NULL, 
	revoked INTEGER DEFAULT 0 NOT NULL, 
	last_seen FLOAT NOT NULL, 
	PRIMARY KEY (user_id, session_id)
);

ALTER TABLE managed_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON managed_sessions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS provider_assignments (
	user_id VARCHAR(64) NOT NULL, 
	provider VARCHAR(64) NOT NULL, 
	mode VARCHAR(16) DEFAULT 'disabled' NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (user_id, provider)
);

ALTER TABLE provider_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON provider_assignments FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS provider_budgets (
	provider VARCHAR(64) NOT NULL, 
	monthly_units FLOAT DEFAULT 0 NOT NULL, 
	used_units FLOAT DEFAULT 0 NOT NULL, 
	month VARCHAR(7) DEFAULT '' NOT NULL, 
	unit VARCHAR(24) DEFAULT 'requests' NOT NULL, 
	enabled INTEGER DEFAULT 0 NOT NULL, 
	monthly_spend FLOAT DEFAULT 0 NOT NULL, 
	reserved_spend FLOAT DEFAULT 0 NOT NULL, 
	cost_per_request FLOAT DEFAULT 0 NOT NULL, 
	PRIMARY KEY (provider)
);

ALTER TABLE provider_budgets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON provider_budgets FROM anon, authenticated;

-- Additive daily speech meters; existing rows retain their other allowances.
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS tts_characters_per_day INTEGER DEFAULT 50000;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_seconds_per_day INTEGER DEFAULT 3600;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_sessions_per_day INTEGER DEFAULT 100;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS tts_characters_used INTEGER DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_seconds_used INTEGER DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_sessions_used INTEGER DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS tts_characters_total INTEGER DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_seconds_total INTEGER DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS voice_sessions_total INTEGER DEFAULT 0;

COMMIT;

-- Backend SQL role must own these tables or have explicit service-only grants.
