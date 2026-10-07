-- Apply in production before enabling Voice Agent Studio (development auto-creates it).
CREATE TABLE IF NOT EXISTS toughtongue_scenarios (
  scenario_id varchar(64) PRIMARY KEY,
  owner_user_id varchar(64) NOT NULL,
  name varchar(255) NOT NULL,
  updated_at double precision
);
CREATE INDEX IF NOT EXISTS ix_toughtongue_scenarios_owner_user_id ON toughtongue_scenarios(owner_user_id);
