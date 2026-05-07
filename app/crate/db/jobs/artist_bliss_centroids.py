from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


_CENTROID_SQL = """
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
      {artist_filter}
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
RETURNING artist_id
"""


def refresh_artist_bliss_centroids_for_track_ids(session, track_ids: list[int]) -> int:
    track_ids = [int(track_id) for track_id in dict.fromkeys(track_ids or []) if track_id]
    if not track_ids:
        return 0

    rows = session.execute(
        text(
            _CENTROID_SQL.format(
                artist_filter="""
                  AND ar.id IN (
                      SELECT DISTINCT ar2.id
                      FROM library_tracks t2
                      JOIN library_albums a2 ON a2.id = t2.album_id
                      JOIN library_artists ar2 ON LOWER(ar2.name) = LOWER(a2.artist)
                      WHERE t2.id = ANY(:track_ids)
                  )
                """
            )
        ),
        {"track_ids": track_ids},
    ).mappings().all()
    return len(rows)


def refresh_all_artist_bliss_centroids(*, session=None) -> int:
    if session is None:
        with transaction_scope() as owned_session:
            return refresh_all_artist_bliss_centroids(session=owned_session)

    rows = session.execute(
        text(_CENTROID_SQL.format(artist_filter="")),
    ).mappings().all()
    return len(rows)


__all__ = [
    "refresh_all_artist_bliss_centroids",
    "refresh_artist_bliss_centroids_for_track_ids",
]
