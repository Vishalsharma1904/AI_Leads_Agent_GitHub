CREATE TABLE IF NOT EXISTS connector_jobs (
    id varchar(36) PRIMARY KEY,
    owner_user_id varchar(64) NOT NULL,
    idempotency_key varchar(64) NOT NULL,
    provider varchar(32) NOT NULL,
    target varchar(256) NOT NULL,
    subject varchar(200) NOT NULL DEFAULT '',
    message text NOT NULL,
    media_url varchar(2048) NOT NULL DEFAULT '',
    run_at double precision NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'queued',
    result_ref varchar(512),
    error varchar(256),
    created_at double precision NOT NULL,
    updated_at double precision NOT NULL,
    CONSTRAINT uq_connector_job_idempotency UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_connector_jobs_owner_user_id ON connector_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_connector_jobs_run_at ON connector_jobs(run_at);
CREATE INDEX IF NOT EXISTS ix_connector_jobs_status ON connector_jobs(status);
ALTER TABLE connector_jobs ENABLE ROW LEVEL SECURITY;
