-- Additive business automation. Run as backend database owner.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_automation_prefs (
	owner_user_id VARCHAR(64) NOT NULL, 
	settings TEXT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (owner_user_id)
);

ALTER TABLE crm_automation_prefs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_automation_prefs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_business_outcomes (
	record_id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	category VARCHAR(24) NOT NULL, 
	channel VARCHAR(24) NOT NULL, 
	summary TEXT NOT NULL, 
	occurred_at FLOAT NOT NULL, 
	PRIMARY KEY (record_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_business_outcomes_category ON crm_business_outcomes (category);

CREATE INDEX IF NOT EXISTS ix_crm_business_outcomes_owner_user_id ON crm_business_outcomes (owner_user_id);

ALTER TABLE crm_business_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_business_outcomes FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_meeting_links (
	task_id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	timezone VARCHAR(64) NOT NULL, 
	duration INTEGER NOT NULL, 
	calendar_id VARCHAR(256) NOT NULL, 
	job_id VARCHAR(36), 
	PRIMARY KEY (task_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_meeting_links_owner_user_id ON crm_meeting_links (owner_user_id);

ALTER TABLE crm_meeting_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_meeting_links FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_business_notices (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	event_key VARCHAR(256) NOT NULL, 
	record_id VARCHAR(36), 
	title VARCHAR(200) NOT NULL, 
	message TEXT NOT NULL, 
	created_at FLOAT NOT NULL, 
	read_at FLOAT, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_crm_notice_key UNIQUE (owner_user_id, event_key)
);

CREATE INDEX IF NOT EXISTS ix_crm_business_notices_created_at ON crm_business_notices (created_at);

CREATE INDEX IF NOT EXISTS ix_crm_business_notices_owner_user_id ON crm_business_notices (owner_user_id);

ALTER TABLE crm_business_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_business_notices FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_call_watches (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	record_id VARCHAR(36) NOT NULL, 
	provider VARCHAR(24) NOT NULL, 
	provider_id VARCHAR(128) NOT NULL, 
	scenario_id VARCHAR(64), 
	state VARCHAR(24) NOT NULL, 
	next_poll FLOAT NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_crm_call_watch UNIQUE (owner_user_id, provider, provider_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_call_watches_owner_user_id ON crm_call_watches (owner_user_id);

ALTER TABLE crm_call_watches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_call_watches FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS crm_reply_cursors (
	owner_user_id VARCHAR(64) NOT NULL, 
	account VARCHAR(320) NOT NULL, 
	since FLOAT NOT NULL, 
	until FLOAT, 
	page_token TEXT, 
	next_poll FLOAT NOT NULL, 
	PRIMARY KEY (owner_user_id)
);

ALTER TABLE crm_reply_cursors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm_reply_cursors FROM anon, authenticated;

COMMIT;
