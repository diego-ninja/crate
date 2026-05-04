"""Make catalog storage IDs optional legacy aliases.

Revision ID: 019
Revises: 018
Create Date: 2026-04-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE library_artists ALTER COLUMN storage_id DROP NOT NULL")
    op.execute("ALTER TABLE library_albums ALTER COLUMN storage_id DROP NOT NULL")
    op.execute("ALTER TABLE library_tracks ALTER COLUMN storage_id DROP NOT NULL")

    op.execute("DROP INDEX IF EXISTS idx_lib_artists_storage_id")
    op.execute("DROP INDEX IF EXISTS idx_lib_albums_storage_id")
    op.execute("DROP INDEX IF EXISTS idx_lib_tracks_storage_id")

    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_storage_id ON library_artists(storage_id) WHERE storage_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_storage_id ON library_albums(storage_id) WHERE storage_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_storage_id ON library_tracks(storage_id) WHERE storage_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_lib_tracks_storage_id")
    op.execute("DROP INDEX IF EXISTS idx_lib_albums_storage_id")
    op.execute("DROP INDEX IF EXISTS idx_lib_artists_storage_id")

    op.execute("UPDATE library_artists SET storage_id = entity_uid WHERE storage_id IS NULL AND entity_uid IS NOT NULL")
    op.execute("UPDATE library_albums SET storage_id = entity_uid WHERE storage_id IS NULL AND entity_uid IS NOT NULL")
    op.execute("UPDATE library_tracks SET storage_id = entity_uid WHERE storage_id IS NULL AND entity_uid IS NOT NULL")

    op.execute("ALTER TABLE library_artists ALTER COLUMN storage_id SET NOT NULL")
    op.execute("ALTER TABLE library_albums ALTER COLUMN storage_id SET NOT NULL")
    op.execute("ALTER TABLE library_tracks ALTER COLUMN storage_id SET NOT NULL")

    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_storage_id ON library_artists(storage_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_storage_id ON library_albums(storage_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_storage_id ON library_tracks(storage_id)")
