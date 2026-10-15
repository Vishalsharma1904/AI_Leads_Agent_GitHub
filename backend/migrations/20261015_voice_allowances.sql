-- Apply after the developer-control migration using the backend search_path.
BEGIN;
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
