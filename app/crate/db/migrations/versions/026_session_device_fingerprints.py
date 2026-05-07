"""Persist auth session device fingerprints.

Revision ID: 026
Revises: 025
Create Date: 2026-05-07
"""

from typing import Sequence, Union

from alembic import op


revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_fingerprint TEXT")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_sessions_user_app_device
        ON sessions(user_id, app_id, device_fingerprint)
        WHERE revoked_at IS NULL AND device_fingerprint IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_sessions_user_app_device")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS device_fingerprint")
