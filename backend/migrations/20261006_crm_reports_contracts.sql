-- Additive PostgreSQL migration. Existing contract dates remain unknown.
BEGIN;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS contract_start_date FLOAT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS contract_end_date FLOAT;
CREATE INDEX IF NOT EXISTS ix_crm_records_owner_created ON crm_records(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_crm_deals_owner_stage_won ON crm_deals(owner_user_id, archived, stage, won_at);
CREATE INDEX IF NOT EXISTS ix_crm_deals_owner_renewal ON crm_deals(owner_user_id, archived, stage, contract_end_date);
CREATE INDEX IF NOT EXISTS ix_crm_tasks_owner_due ON crm_tasks(owner_user_id, archived, status, due_at);
CREATE INDEX IF NOT EXISTS ix_crm_activity_owner_occurred ON crm_activities(owner_user_id, occurred_at);
COMMIT;
