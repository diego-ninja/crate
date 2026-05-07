"""Align bliss ANN indexes with cosine scoring and cache artist centroids.

Revision ID: 027
Revises: 026
"""

from typing import Sequence, Union

from alembic import op


revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _run_concurrently(statement: str) -> None:
    with op.get_context().autocommit_block():
        op.execute(statement)


def _backfill_artist_centroids() -> None:
    op.execute(
        """
        WITH track_vectors AS (
            SELECT
                ar.id AS artist_id,
                ar.name AS artist_name,
                t.id AS track_id,
                t.bliss_vector
            FROM library_artists ar
            JOIN library_albums a ON LOWER(a.artist) = LOWER(ar.name)
            JOIN library_tracks t ON t.album_id = a.id
            WHERE t.bliss_vector IS NOT NULL
              AND array_length(t.bliss_vector, 1) = 20
        ),
        track_counts AS (
            SELECT artist_id, COUNT(DISTINCT track_id)::INTEGER AS track_count
            FROM track_vectors
            GROUP BY artist_id
        ),
        averaged AS (
            SELECT
                tv.artist_id,
                tv.artist_name,
                u.idx,
                AVG(u.val::DOUBLE PRECISION) AS avg_val
            FROM track_vectors tv
            CROSS JOIN UNNEST(tv.bliss_vector) WITH ORDINALITY AS u(val, idx)
            GROUP BY tv.artist_id, tv.artist_name, u.idx
        ),
        centroids AS (
            SELECT
                averaged.artist_id,
                averaged.artist_name,
                track_counts.track_count,
                ARRAY_AGG(averaged.avg_val ORDER BY averaged.idx)::DOUBLE PRECISION[] AS bliss_vector
            FROM averaged
            JOIN track_counts ON track_counts.artist_id = averaged.artist_id
            GROUP BY averaged.artist_id, averaged.artist_name, track_counts.track_count
            HAVING COUNT(*) = 20
        )
        INSERT INTO artist_bliss_centroids (
            artist_id,
            artist_name,
            track_count,
            bliss_vector,
            updated_at
        )
        SELECT
            artist_id,
            artist_name,
            track_count,
            bliss_vector,
            NOW()
        FROM centroids
        ON CONFLICT (artist_id) DO UPDATE SET
            artist_name = EXCLUDED.artist_name,
            track_count = EXCLUDED.track_count,
            bliss_vector = EXCLUDED.bliss_vector,
            updated_at = EXCLUDED.updated_at
        """
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS artist_bliss_centroids (
            artist_id BIGINT PRIMARY KEY REFERENCES library_artists(id) ON DELETE CASCADE,
            artist_name TEXT NOT NULL,
            track_count INTEGER NOT NULL DEFAULT 0,
            bliss_vector DOUBLE PRECISION[] NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_artist_bliss_centroids_name
        ON artist_bliss_centroids (LOWER(artist_name))
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_artist_bliss_centroids_updated
        ON artist_bliss_centroids (updated_at DESC)
        """
    )
    _backfill_artist_centroids()

    _run_concurrently(
        """
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_tracks_bliss_embedding_cosine_hnsw
        ON library_tracks USING hnsw (bliss_embedding vector_cosine_ops)
        WHERE bliss_embedding IS NOT NULL
        """
    )
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_library_tracks_bliss_embedding_hnsw")


def downgrade() -> None:
    _run_concurrently(
        """
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_tracks_bliss_embedding_hnsw
        ON library_tracks USING hnsw (bliss_embedding vector_l2_ops)
        WHERE bliss_embedding IS NOT NULL
        """
    )
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_library_tracks_bliss_embedding_cosine_hnsw")
    op.execute("DROP TABLE IF EXISTS artist_bliss_centroids")
