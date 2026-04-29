"""Persist playlist track refs with entity_uid/storage_id.

Revision ID: 017
Revises: 016
"""

from typing import Sequence, Union

from alembic import op


revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS track_storage_id UUID")
    op.execute("ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    op.execute(
        """
        WITH matched AS (
            SELECT
                pt.id AS playlist_track_id,
                lt.id AS track_id,
                lt.entity_uid,
                lt.storage_id,
                lt.path,
                lt.title,
                lt.filename,
                lt.artist,
                lt.album,
                lt.duration
            FROM playlist_tracks pt
            JOIN LATERAL (
                SELECT id, entity_uid, storage_id, path, title, filename, artist, album, duration
                FROM library_tracks lt
                WHERE (pt.track_id IS NOT NULL AND lt.id = pt.track_id)
                   OR (pt.track_entity_uid IS NOT NULL AND lt.entity_uid = pt.track_entity_uid)
                   OR (pt.track_storage_id IS NOT NULL AND lt.storage_id = pt.track_storage_id)
                   OR (
                        pt.track_path IS NOT NULL
                        AND pt.track_path != ''
                        AND (
                            lt.path = pt.track_path
                            OR lt.path LIKE ('%/' || pt.track_path)
                        )
                   )
                ORDER BY CASE
                    WHEN pt.track_id IS NOT NULL AND lt.id = pt.track_id THEN 0
                    WHEN pt.track_entity_uid IS NOT NULL AND lt.entity_uid = pt.track_entity_uid THEN 1
                    WHEN pt.track_storage_id IS NOT NULL AND lt.storage_id = pt.track_storage_id THEN 2
                    WHEN pt.track_path IS NOT NULL AND lt.path = pt.track_path THEN 3
                    ELSE 4
                END
                LIMIT 1
            ) lt ON TRUE
        )
        UPDATE playlist_tracks pt
        SET
            track_id = COALESCE(pt.track_id, matched.track_id),
            track_entity_uid = COALESCE(pt.track_entity_uid, matched.entity_uid),
            track_storage_id = COALESCE(pt.track_storage_id, matched.storage_id),
            track_path = COALESCE(NULLIF(pt.track_path, ''), matched.path),
            title = COALESCE(NULLIF(pt.title, ''), matched.title, matched.filename),
            artist = COALESCE(NULLIF(pt.artist, ''), matched.artist),
            album = COALESCE(NULLIF(pt.album, ''), matched.album),
            duration = CASE
                WHEN COALESCE(pt.duration, 0) > 0 THEN pt.duration
                ELSE COALESCE(matched.duration, pt.duration, 0)
            END
        FROM matched
        WHERE pt.id = matched.playlist_track_id
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_storage_id
        ON playlist_tracks(track_storage_id)
        WHERE track_storage_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_entity_uid
        ON playlist_tracks(track_entity_uid)
        WHERE track_entity_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_playlist_tracks_track_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_playlist_tracks_track_storage_id")
    op.execute("ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS track_entity_uid")
    op.execute("ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS track_storage_id")
