"""Add consolidated track popularity signals and score columns.

Revision ID: 004
Revises: 003
Create Date: 2026-04-21
"""

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for col, typedef in [
        ("lastfm_top_rank", "INTEGER"),
        ("spotify_track_popularity", "INTEGER"),
        ("spotify_top_rank", "INTEGER"),
        ("popularity_score", "DOUBLE PRECISION"),
        ("popularity_confidence", "DOUBLE PRECISION"),
    ]:
        op.execute(f"""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN {col} {typedef};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

    op.execute("""
        UPDATE library_tracks
        SET popularity_score = COALESCE(popularity_score, popularity / 100.0),
            popularity_confidence = COALESCE(
                popularity_confidence,
                CASE WHEN popularity IS NOT NULL THEN 0.2 ELSE 0.0 END
            )
        WHERE popularity IS NOT NULL
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lib_tracks_popularity_score "
        "ON library_tracks(popularity_score DESC NULLS LAST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_lib_tracks_popularity_score")
    for col in [
        "popularity_confidence",
        "popularity_score",
        "spotify_top_rank",
        "spotify_track_popularity",
        "lastfm_top_rank",
    ]:
        op.execute(f"ALTER TABLE library_tracks DROP COLUMN IF EXISTS {col}")
