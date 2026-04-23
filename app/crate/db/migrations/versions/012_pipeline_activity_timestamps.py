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
    # Intentionally avoid a full-table backfill here. On production-size
    # libraries this can exceed statement_timeout during startup and block
    # both API and worker boot. Runtime code already falls back to
    # updated_at via COALESCE(..., updated_at), so timestamps can be
    # populated lazily by fresh analysis/bliss writes or by an offline
    # one-off maintenance job later.


def downgrade() -> None:
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS bliss_computed_at")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS analysis_completed_at")
