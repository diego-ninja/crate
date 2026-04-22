"""Add consolidated popularity score columns for albums and artists.

Revision ID: 005
Revises: 004
Create Date: 2026-04-21
"""

from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table, columns in [
        (
            "library_albums",
            [
                ("popularity_score", "DOUBLE PRECISION"),
                ("popularity_confidence", "DOUBLE PRECISION"),
            ],
        ),
        (
            "library_artists",
            [
                ("popularity", "INTEGER"),
                ("popularity_score", "DOUBLE PRECISION"),
                ("popularity_confidence", "DOUBLE PRECISION"),
            ],
        ),
    ]:
        for col, typedef in columns:
            op.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE {table} ADD COLUMN {col} {typedef};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)

    op.execute("""
        UPDATE library_albums
        SET popularity_score = COALESCE(popularity_score, popularity / 100.0),
            popularity_confidence = COALESCE(
                popularity_confidence,
                CASE WHEN popularity IS NOT NULL THEN 0.2 ELSE 0.0 END
            )
        WHERE popularity IS NOT NULL
    """)

    op.execute("""
        UPDATE library_artists
        SET popularity = COALESCE(
                popularity,
                spotify_popularity,
                CASE
                    WHEN listeners IS NOT NULL AND listeners > 0 THEN LEAST(
                        100,
                        GREATEST(
                            1,
                            (
                                LN(listeners::double precision + 1)
                                / NULLIF(
                                    (
                                        SELECT LN(MAX(listeners)::double precision + 1)
                                        FROM library_artists
                                        WHERE listeners IS NOT NULL AND listeners > 0
                                    ),
                                    0
                                )
                                * 100
                            )::int
                        )
                    )
                    ELSE NULL
                END
            )
        WHERE spotify_popularity IS NOT NULL OR listeners IS NOT NULL
    """)
    op.execute("""
        UPDATE library_artists
        SET popularity_score = COALESCE(popularity_score, popularity / 100.0),
            popularity_confidence = COALESCE(
                popularity_confidence,
                CASE
                    WHEN spotify_popularity IS NOT NULL THEN 0.2
                    WHEN listeners IS NOT NULL THEN 0.12
                    ELSE 0.0
                END
            )
        WHERE popularity IS NOT NULL
    """)

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lib_albums_popularity_score "
        "ON library_albums(popularity_score DESC NULLS LAST)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lib_artists_popularity_score "
        "ON library_artists(popularity_score DESC NULLS LAST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_lib_artists_popularity_score")
    op.execute("DROP INDEX IF EXISTS idx_lib_albums_popularity_score")
    for col in [
        "popularity_confidence",
        "popularity_score",
        "popularity",
    ]:
        op.execute(f"ALTER TABLE library_artists DROP COLUMN IF EXISTS {col}")
    for col in [
        "popularity_confidence",
        "popularity_score",
    ]:
        op.execute(f"ALTER TABLE library_albums DROP COLUMN IF EXISTS {col}")
