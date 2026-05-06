"""Add jam room visibility and permanence.

Revision ID: 024
Revises: 023
Create Date: 2026-05-06
"""

from typing import Sequence, Union

from alembic import op


revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'")
    op.execute("ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_jam_rooms_visibility_status "
        "ON jam_rooms(status, visibility, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_jam_rooms_visibility_status")
    op.execute("ALTER TABLE jam_rooms DROP COLUMN IF EXISTS is_permanent")
    op.execute("ALTER TABLE jam_rooms DROP COLUMN IF EXISTS visibility")
