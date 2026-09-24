"""Create auth, credential, lead job, and lead record tables."""
from alembic import op
import sqlalchemy as sa

revision = "0001_enterprise_schema"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("user_accounts", sa.Column("id", sa.String(64), primary_key=True), sa.Column("email", sa.String(255), nullable=False), sa.Column("password_hash", sa.String(255)), sa.Column("salt", sa.String(64)), sa.Column("name", sa.String(255), nullable=False), sa.Column("company", sa.String(255)), sa.Column("phone", sa.String(64)), sa.Column("role", sa.String(64)), sa.Column("avatar", sa.String(255)), sa.Column("created_at", sa.Float), sa.Column("last_login", sa.Float))
    op.create_index("ix_user_accounts_email", "user_accounts", ["email"], unique=True)
    op.create_table("user_cloud_data", sa.Column("id", sa.Integer, primary_key=True), sa.Column("email", sa.String(255), nullable=False), sa.Column("data_type", sa.String(64), nullable=False), sa.Column("payload", sa.Text, nullable=False), sa.Column("updated_at", sa.Float))
    op.create_table("provider_credentials", sa.Column("id", sa.Integer, primary_key=True), sa.Column("owner_user_id", sa.String(64), nullable=False), sa.Column("provider", sa.String(64), nullable=False), sa.Column("ciphertext", sa.Text, nullable=False), sa.Column("nonce", sa.String(64), nullable=False), sa.Column("key_version", sa.Integer, nullable=False), sa.Column("updated_at", sa.Float))
    op.create_index("uq_provider_owner", "provider_credentials", ["owner_user_id", "provider"], unique=True)
    op.create_table("lead_jobs", sa.Column("id", sa.String(64), primary_key=True), sa.Column("owner_user_id", sa.String(64), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("request_payload", sa.Text, nullable=False), sa.Column("result_count", sa.Integer), sa.Column("error", sa.Text), sa.Column("idempotency_key", sa.String(128)), sa.Column("created_at", sa.Float), sa.Column("updated_at", sa.Float))
    op.create_index("uq_job_idempotency", "lead_jobs", ["owner_user_id", "idempotency_key"], unique=True)
    op.create_table("lead_records", sa.Column("id", sa.String(64), primary_key=True), sa.Column("owner_user_id", sa.String(64), nullable=False), sa.Column("job_id", sa.String(64), nullable=False), sa.Column("payload", sa.Text, nullable=False), sa.Column("created_at", sa.Float))

def downgrade():
    op.drop_table("lead_records")
    op.drop_index("uq_job_idempotency", table_name="lead_jobs")
    op.drop_table("lead_jobs")
    op.drop_index("uq_provider_owner", table_name="provider_credentials")
    op.drop_table("provider_credentials")
    op.drop_table("user_cloud_data")
    op.drop_index("ix_user_accounts_email", table_name="user_accounts")
    op.drop_table("user_accounts")
