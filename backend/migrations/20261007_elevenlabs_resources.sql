CREATE TABLE IF NOT EXISTS elevenlabs_resources (
    kind VARCHAR(32) NOT NULL,
    resource_id VARCHAR(160) NOT NULL,
    owner_user_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    updated_at DOUBLE PRECISION,
    PRIMARY KEY (kind, resource_id)
);
CREATE INDEX IF NOT EXISTS ix_elevenlabs_resources_owner_user_id ON elevenlabs_resources (owner_user_id);
