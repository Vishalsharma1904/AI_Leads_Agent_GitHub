-- Additive TextBee queue and per-account dispatch budgets.
BEGIN;

CREATE TABLE IF NOT EXISTS sms_campaigns (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	message TEXT NOT NULL, 
	recipients TEXT NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE INDEX IF NOT EXISTS ix_sms_campaigns_owner_user_id ON sms_campaigns (owner_user_id);

CREATE TABLE IF NOT EXISTS sms_dispatches (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	campaign_id VARCHAR(36) NOT NULL, 
	record_id VARCHAR(36) NOT NULL, 
	phone VARCHAR(24) NOT NULL, 
	day VARCHAR(10) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	provider_id VARCHAR(128), 
	device_id VARCHAR(128) NOT NULL, 
	error TEXT, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sms_owner_phone UNIQUE (owner_user_id, phone)
)

;
CREATE INDEX IF NOT EXISTS ix_sms_dispatches_campaign_id ON sms_dispatches (campaign_id);
CREATE INDEX IF NOT EXISTS ix_sms_dispatches_owner_user_id ON sms_dispatches (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_sms_dispatches_day ON sms_dispatches (day);

CREATE TABLE IF NOT EXISTS sms_daily_budget (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(64) NOT NULL, 
	day VARCHAR(10) NOT NULL, 
	used INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sms_owner_day UNIQUE (owner_user_id, day)
)

;
COMMIT;
