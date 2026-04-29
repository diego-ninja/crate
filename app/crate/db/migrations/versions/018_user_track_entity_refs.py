"""Persist track entity refs across user activity tables.

Revision ID: 018
Revises: 017
Create Date: 2026-04-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE play_history ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    op.execute("ALTER TABLE user_play_events ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    op.execute("ALTER TABLE user_track_stats ADD COLUMN IF NOT EXISTS track_entity_uid UUID")

    op.execute(
        """
        UPDATE play_history ph
        SET track_entity_uid = (
            SELECT lt.entity_uid
            FROM library_tracks lt
            WHERE (ph.track_id IS NOT NULL AND lt.id = ph.track_id)
               OR (ph.track_id IS NULL AND COALESCE(ph.track_path, '') <> '' AND lt.path = ph.track_path)
            ORDER BY CASE
                WHEN ph.track_id IS NOT NULL AND lt.id = ph.track_id THEN 0
                WHEN ph.track_id IS NULL AND COALESCE(ph.track_path, '') <> '' AND lt.path = ph.track_path THEN 1
                ELSE 2
            END
            LIMIT 1
        )
        WHERE ph.track_entity_uid IS NULL
        """
    )

    op.execute(
        """
        UPDATE user_play_events upe
        SET track_entity_uid = (
            SELECT lt.entity_uid
            FROM library_tracks lt
            WHERE (upe.track_id IS NOT NULL AND lt.id = upe.track_id)
               OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path)
            ORDER BY CASE
                WHEN upe.track_id IS NOT NULL AND lt.id = upe.track_id THEN 0
                WHEN upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path THEN 1
                ELSE 2
            END
            LIMIT 1
        )
        WHERE upe.track_entity_uid IS NULL
        """
    )

    op.execute(
        """
        UPDATE user_track_stats uts
        SET track_entity_uid = (
            SELECT lt.entity_uid
            FROM library_tracks lt
            WHERE (uts.track_id IS NOT NULL AND lt.id = uts.track_id)
               OR (uts.track_id IS NULL AND COALESCE(uts.track_path, '') <> '' AND lt.path = uts.track_path)
            ORDER BY CASE
                WHEN uts.track_id IS NOT NULL AND lt.id = uts.track_id THEN 0
                WHEN uts.track_id IS NULL AND COALESCE(uts.track_path, '') <> '' AND lt.path = uts.track_path THEN 1
                ELSE 2
            END
            LIMIT 1
        )
        WHERE uts.track_entity_uid IS NULL
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_play_history_track_entity_uid ON play_history(track_entity_uid)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_track_entity_uid ON user_play_events(track_entity_uid)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_user_track_stats_entity_uid ON user_track_stats(track_entity_uid)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_track_stats_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_user_play_events_track_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_play_history_track_entity_uid")
    op.execute("ALTER TABLE user_track_stats DROP COLUMN IF EXISTS track_entity_uid")
    op.execute("ALTER TABLE user_play_events DROP COLUMN IF EXISTS track_entity_uid")
    op.execute("ALTER TABLE play_history DROP COLUMN IF EXISTS track_entity_uid")
