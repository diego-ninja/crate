"""Add hotpath library performance indexes.

Revision ID: 023
Revises: 022
Create Date: 2026-05-05
"""

from typing import Sequence, Union

from alembic import op


revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lib_tracks_lastfm_playcount "
        "ON library_tracks (lastfm_playcount DESC NULLS LAST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_lib_tracks_lastfm_playcount")
