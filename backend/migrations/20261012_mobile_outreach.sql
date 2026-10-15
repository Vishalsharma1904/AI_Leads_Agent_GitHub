-- Apply to the existing authenticated backend database before mobile release.
CREATE TABLE IF NOT EXISTS outreach_jobs (
 id VARCHAR(64) PRIMARY KEY, owner_user_id VARCHAR(64) NOT NULL,
 request_id VARCHAR(64) NOT NULL, digest VARCHAR(64) NOT NULL,
 channel VARCHAR(16) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'queued',
 content TEXT NOT NULL, created_at DOUBLE PRECISION, updated_at DOUBLE PRECISION,
 CONSTRAINT uq_outreach_request UNIQUE(owner_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS ix_outreach_jobs_owner ON outreach_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_outreach_jobs_status ON outreach_jobs(status);
CREATE TABLE IF NOT EXISTS outreach_items (
 id VARCHAR(64) PRIMARY KEY, job_id VARCHAR(64) NOT NULL,
 record_id VARCHAR(64) NOT NULL, recipient VARCHAR(320) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'pending', result TEXT DEFAULT '{}',
 updated_at DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS ix_outreach_items_job ON outreach_items(job_id);
CREATE INDEX IF NOT EXISTS ix_outreach_items_status ON outreach_items(status);
