-- Additive CRM migration; apply before the backend restart in production.

-- Historical source timestamps remain nullable. Existing leads/cloud data are untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_records (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	version INTEGER NOT NULL, 
	stage VARCHAR(24) NOT NULL, 
	profile TEXT NOT NULL, 
	manual_fields TEXT NOT NULL, 
	created_at FLOAT, 
	updated_at FLOAT, 
	last_contact_at FLOAT, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_crm_records_created_at ON crm_records (created_at);

CREATE INDEX IF NOT EXISTS ix_crm_records_owner_user_id ON crm_records (owner_user_id);

CREATE INDEX IF NOT EXISTS ix_crm_records_stage ON crm_records (stage);

ALTER TABLE crm_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_records FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_sources (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	record_id VARCHAR(36) NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	source_id VARCHAR(256) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_crm_source UNIQUE (owner_user_id, source, source_id), 
	FOREIGN KEY(record_id) REFERENCES crm_records (id)
);

CREATE INDEX IF NOT EXISTS ix_crm_sources_owner_user_id ON crm_sources (owner_user_id);

CREATE INDEX IF NOT EXISTS ix_crm_sources_record_id ON crm_sources (record_id);

ALTER TABLE crm_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_sources FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_deals (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	record_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	service_type VARCHAR(200) NOT NULL, 
	monthly_amount FLOAT, 
	duration_months INTEGER, 
	expected_close_date FLOAT, 
	stage VARCHAR(24) NOT NULL, 
	next_step TEXT NOT NULL, 
	probability FLOAT, 
	loss_reason TEXT NOT NULL, 
	archived BOOLEAN NOT NULL, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	won_at FLOAT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(record_id) REFERENCES crm_records (id)
);

CREATE INDEX IF NOT EXISTS ix_crm_deals_owner_user_id ON crm_deals (owner_user_id);

CREATE INDEX IF NOT EXISTS ix_crm_deals_record_id ON crm_deals (record_id);

CREATE INDEX IF NOT EXISTS ix_crm_deals_stage ON crm_deals (stage);

CREATE INDEX IF NOT EXISTS ix_crm_deals_won_at ON crm_deals (won_at);

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_deals FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_tasks (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	record_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	kind VARCHAR(16) NOT NULL, 
	due_at FLOAT, 
	status VARCHAR(16) NOT NULL, 
	notes TEXT NOT NULL, 
	archived BOOLEAN NOT NULL, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(record_id) REFERENCES crm_records (id)
);

CREATE INDEX IF NOT EXISTS ix_crm_tasks_due_at ON crm_tasks (due_at);

CREATE INDEX IF NOT EXISTS ix_crm_tasks_owner_user_id ON crm_tasks (owner_user_id);

CREATE INDEX IF NOT EXISTS ix_crm_tasks_record_id ON crm_tasks (record_id);

CREATE INDEX IF NOT EXISTS ix_crm_tasks_status ON crm_tasks (status);

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_tasks FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_activities (
	id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	record_id VARCHAR(36), 
	kind VARCHAR(32) NOT NULL, 
	note TEXT NOT NULL, 
	note_history TEXT NOT NULL, 
	channel VARCHAR(24), 
	outcome VARCHAR(80), 
	evidence VARCHAR(32) NOT NULL, 
	recipient VARCHAR(320), 
	provider_id VARCHAR(256), 
	idempotency_key VARCHAR(256), 
	occurred_at FLOAT, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_crm_activity_key UNIQUE (owner_user_id, idempotency_key), 
	FOREIGN KEY(record_id) REFERENCES crm_records (id)
);

CREATE INDEX IF NOT EXISTS ix_crm_activities_kind ON crm_activities (kind);

CREATE INDEX IF NOT EXISTS ix_crm_activities_occurred_at ON crm_activities (occurred_at);

CREATE INDEX IF NOT EXISTS ix_crm_activities_owner_user_id ON crm_activities (owner_user_id);

CREATE INDEX IF NOT EXISTS ix_crm_activities_record_id ON crm_activities (record_id);

ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_activities FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_migrations (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	cursor VARCHAR(64) NOT NULL, 
	state TEXT NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_crm_migration_cursor UNIQUE (owner_user_id, cursor)
);

CREATE INDEX IF NOT EXISTS ix_crm_migrations_owner_user_id ON crm_migrations (owner_user_id);

ALTER TABLE crm_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_migrations FROM anon, authenticated;

COMMIT;

-- CRM access is via the authenticated API. Database roles used by browser clients have no direct table privileges.
