"""Track portable metadata writes and rich exports.

Revision ID: 022
Revises: 021
Create Date: 2026-05-01
"""

from typing import Sequence, Union

from alembic import op


revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS album_portable_metadata (
            album_id INTEGER PRIMARY KEY REFERENCES library_albums(id) ON DELETE CASCADE,
            album_entity_uid UUID,
            sidecar_path TEXT,
            sidecar_written_at TIMESTAMPTZ,
            audio_tags_written_at TIMESTAMPTZ,
            tracks INTEGER NOT NULL DEFAULT 0,
            tags_written INTEGER NOT NULL DEFAULT 0,
            tag_errors INTEGER NOT NULL DEFAULT 0,
            export_path TEXT,
            exported_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_sidecar ON album_portable_metadata(sidecar_written_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_tags ON album_portable_metadata(audio_tags_written_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_export ON album_portable_metadata(exported_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_album_portable_metadata_export")
    op.execute("DROP INDEX IF EXISTS idx_album_portable_metadata_tags")
    op.execute("DROP INDEX IF EXISTS idx_album_portable_metadata_sidecar")
    op.execute("DROP TABLE IF EXISTS album_portable_metadata")
