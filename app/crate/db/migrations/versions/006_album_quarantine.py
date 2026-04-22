"""Add quarantine support for album quality upgrades.

Revision ID: 006
Revises: 005
Create Date: 2026-04-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE library_albums
        ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS quarantine_task_id TEXT DEFAULT NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE library_albums DROP COLUMN IF EXISTS quarantined_at")
    op.execute("ALTER TABLE library_albums DROP COLUMN IF EXISTS quarantine_task_id")
