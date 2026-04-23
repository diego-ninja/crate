"""Add dedicated timestamps for analysis and bliss activity.

Revision ID: 012
Revises: 011
"""

from typing import Sequence, Union

from alembic import op


revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS analysis_completed_at TIMESTAMPTZ")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS bliss_computed_at TIMESTAMPTZ")

    op.execute(
        """
        UPDATE library_tracks
        SET analysis_completed_at = COALESCE(analysis_completed_at, updated_at)
        WHERE analysis_state = 'done'
          AND analysis_completed_at IS NULL
          AND updated_at IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE library_tracks
        SET bliss_computed_at = COALESCE(bliss_computed_at, updated_at)
        WHERE bliss_state = 'done'
          AND bliss_computed_at IS NULL
          AND updated_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS bliss_computed_at")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS analysis_completed_at")
