"""Add metric_rollups and worker_logs tables.

Revision ID: 002
Revises: 001
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS metric_rollups (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            tags_json JSONB DEFAULT '{}',
            period TEXT NOT NULL,
            bucket_start TIMESTAMPTZ NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            sum_value DOUBLE PRECISION DEFAULT 0,
            min_value DOUBLE PRECISION,
            max_value DOUBLE PRECISION,
            avg_value DOUBLE PRECISION,
            p95_value DOUBLE PRECISION,
            UNIQUE(name, tags_json, period, bucket_start)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_metric_rollups_query ON metric_rollups(name, bucket_start DESC)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS worker_logs (
            id BIGSERIAL PRIMARY KEY,
            worker_id TEXT NOT NULL,
            task_id TEXT,
            level TEXT NOT NULL DEFAULT 'info',
            category TEXT NOT NULL DEFAULT 'general',
            message TEXT NOT NULL,
            metadata_json JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_worker_logs_worker ON worker_logs(worker_id, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_worker_logs_task ON worker_logs(task_id, id) WHERE task_id IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_worker_logs_level ON worker_logs(level, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS worker_logs")
    op.execute("DROP TABLE IF EXISTS metric_rollups")
