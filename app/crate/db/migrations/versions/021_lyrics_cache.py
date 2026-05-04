"""Add durable lyrics cache.

Revision ID: 021
Revises: 020
Create Date: 2026-05-01
"""

from typing import Sequence, Union

from alembic import op


revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS track_lyrics (
            id SERIAL PRIMARY KEY,
            provider TEXT NOT NULL DEFAULT 'lrclib',
            artist_key TEXT NOT NULL,
            title_key TEXT NOT NULL,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
            synced_lyrics TEXT,
            plain_lyrics TEXT,
            found BOOLEAN NOT NULL DEFAULT TRUE,
            source_json JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_track_lyrics_lookup
        ON track_lyrics(provider, artist_key, title_key)
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_track ON track_lyrics(track_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_entity ON track_lyrics(track_entity_uid)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_updated ON track_lyrics(updated_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_track_lyrics_updated")
    op.execute("DROP INDEX IF EXISTS idx_track_lyrics_entity")
    op.execute("DROP INDEX IF EXISTS idx_track_lyrics_track")
    op.execute("DROP INDEX IF EXISTS idx_track_lyrics_lookup")
    op.execute("DROP TABLE IF EXISTS track_lyrics")
