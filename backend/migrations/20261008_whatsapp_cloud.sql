-- Run before enabling the direct Meta WhatsApp routes in production.
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS whatsapp_per_day integer DEFAULT 20;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS whatsapp_used integer DEFAULT 0;
ALTER TABLE tenant_limits ADD COLUMN IF NOT EXISTS whatsapp_total integer DEFAULT 0;
CREATE TABLE IF NOT EXISTS whatsapp_connections (
 owner_user_id varchar(64) PRIMARY KEY, waba_id varchar(64) NOT NULL UNIQUE,
 phone_number_id varchar(64) NOT NULL UNIQUE, display_phone_number varchar(64) DEFAULT '',
 onboarding_status varchar(32) DEFAULT 'cloud_ready', sync_requests text DEFAULT '{}', updated_at double precision
);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
 id varchar(36) PRIMARY KEY, owner_user_id varchar(64) NOT NULL,
 idempotency_key varchar(128) NOT NULL, request_hash varchar(64) NOT NULL,
 phone_number_id varchar(64) NOT NULL, "to" varchar(24) NOT NULL, template varchar(120) NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'reserved', provider_message_id varchar(256) DEFAULT '',
 detail text DEFAULT '', created_at double precision, updated_at double precision,
 CONSTRAINT uq_whatsapp_request UNIQUE(owner_user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_owner_user_id ON whatsapp_messages(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_provider_message_id ON whatsapp_messages(provider_message_id);
CREATE TABLE IF NOT EXISTS whatsapp_receipts (
 id varchar(64) PRIMARY KEY, owner_user_id varchar(64) NOT NULL, field varchar(64) NOT NULL,
 phone_number_id varchar(64) DEFAULT '', provider_message_id varchar(256) DEFAULT '',
 status varchar(24) DEFAULT '', metadata_json text DEFAULT '{}', created_at double precision
);
CREATE INDEX IF NOT EXISTS ix_whatsapp_receipts_owner_user_id ON whatsapp_receipts(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_whatsapp_receipts_provider_message_id ON whatsapp_receipts(provider_message_id);
