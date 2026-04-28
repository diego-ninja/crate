"""Add idempotency key to user play events.

Revision ID: 014
Revises: 013
"""

from typing import Sequence, Union

from alembic import op


revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE user_play_events
        ADD COLUMN IF NOT EXISTS client_event_id TEXT
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_play_events_user_client_event
        ON user_play_events(user_id, client_event_id)
        WHERE client_event_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_play_events_user_client_event")
    op.execute(
        """
        ALTER TABLE user_play_events
        DROP COLUMN IF EXISTS client_event_id
        """
    )
