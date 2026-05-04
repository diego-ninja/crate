"""Add cached playback stream variants.

Revision ID: 020
Revises: 019
Create Date: 2026-04-30
"""

from typing import Sequence, Union

from alembic import op


revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS stream_variants (
            id TEXT PRIMARY KEY,
            cache_key TEXT NOT NULL UNIQUE,
            track_id INTEGER CONSTRAINT fk_stream_variants_track REFERENCES library_tracks(id) ON DELETE CASCADE,
            track_entity_uid UUID,
            source_path TEXT NOT NULL,
            source_mtime_ns BIGINT NOT NULL,
            source_size BIGINT NOT NULL,
            source_format TEXT,
            source_bitrate INTEGER,
            source_sample_rate INTEGER,
            source_bit_depth INTEGER,
            preset TEXT NOT NULL,
            delivery_format TEXT NOT NULL,
            delivery_codec TEXT NOT NULL,
            delivery_bitrate INTEGER NOT NULL,
            delivery_sample_rate INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            relative_path TEXT,
            bytes BIGINT,
            error TEXT,
            task_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        DELETE FROM stream_variants sv
        WHERE sv.track_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM library_tracks lt WHERE lt.id = sv.track_id
          )
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_stream_variants_track'
                  AND conrelid = 'stream_variants'::regclass
            ) THEN
                ALTER TABLE stream_variants
                ADD CONSTRAINT fk_stream_variants_track
                FOREIGN KEY (track_id) REFERENCES library_tracks(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_stream_variants_track ON stream_variants(track_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_stream_variants_entity ON stream_variants(track_entity_uid)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_stream_variants_status ON stream_variants(status, updated_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_stream_variants_preset ON stream_variants(preset, status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_stream_variants_preset")
    op.execute("DROP INDEX IF EXISTS idx_stream_variants_status")
    op.execute("DROP INDEX IF EXISTS idx_stream_variants_entity")
    op.execute("DROP INDEX IF EXISTS idx_stream_variants_track")
    op.execute("DROP TABLE IF EXISTS stream_variants")
