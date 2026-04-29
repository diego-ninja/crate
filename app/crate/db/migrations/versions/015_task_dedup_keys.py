"""Add explicit task dedup keys.

Revision ID: 015
Revises: 014
"""

from typing import Sequence, Union

from alembic import op


revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS dedup_key TEXT
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tasks_active_dedup
        ON tasks (type, dedup_key, created_at)
        WHERE dedup_key IS NOT NULL
          AND status IN ('pending', 'running', 'delegated', 'completing')
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_tasks_active_dedup")
    op.execute(
        """
        ALTER TABLE tasks
        DROP COLUMN IF EXISTS dedup_key
        """
    )
