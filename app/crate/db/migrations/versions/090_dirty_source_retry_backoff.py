"""Back off dirty sources waiting for canonical dependencies."""

from alembic import op


revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE global_catalog_dirty_sources
        ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_dirty_sources_retry
        ON global_catalog_dirty_sources (next_attempt_at, requested_at, id)
        WHERE completed_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_dirty_sources_retry")
    op.execute(
        """
        ALTER TABLE global_catalog_dirty_sources
        DROP COLUMN IF EXISTS next_attempt_at
        """
    )
