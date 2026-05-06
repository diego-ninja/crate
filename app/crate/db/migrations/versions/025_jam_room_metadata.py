"""Add searchable jam room metadata.

Revision ID: 025
Revises: 024
Create Date: 2026-05-06
"""

from typing import Sequence, Union

from alembic import op


revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS description TEXT")
    op.execute("ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("CREATE INDEX IF NOT EXISTS idx_jam_rooms_tags ON jam_rooms USING GIN (tags)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_jam_rooms_tags")
    op.execute("ALTER TABLE jam_rooms DROP COLUMN IF EXISTS tags")
    op.execute("ALTER TABLE jam_rooms DROP COLUMN IF EXISTS description")
