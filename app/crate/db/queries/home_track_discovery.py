from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.home_track_rows import _fetch_rows
from crate.db.tx import read_scope


def get_discovery_track_rows(*, genres: list[str], excluded_artist_names: list[str], limit: int = 240) -> list[dict]:
    if not genres:
        return []
    capped_genres = genres[:20]
    capped_excluded = excluded_artist_names[:50]
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        artist_rows = session.execute(
            text(
                """
                SELECT DISTINCT ag.artist_name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE LOWER(g.name) = ANY(:genres)
                  AND NOT (LOWER(ag.artist_name) = ANY(:excluded))
                LIMIT 200
                """
            ),
            {"genres": capped_genres, "excluded": capped_excluded},
        ).mappings().all()
    matching_artists = [row["artist_name"] for row in artist_rows]
    if not matching_artists:
        return []

    return _fetch_rows(
        """
        SELECT
            t.id AS track_id,
            t.entity_uid::text AS track_entity_uid,
            t.path AS track_path,
            t.title,
            t.artist,
            art.id AS artist_id,
            art.entity_uid::text AS artist_entity_uid,
            art.slug AS artist_slug,
            t.album,
            alb.id AS album_id,
            alb.entity_uid::text AS album_entity_uid,
            alb.slug AS album_slug,
            t.duration,
            t.format,
            t.bitrate,
            t.sample_rate,
            t.bit_depth,
            t.bpm,
            t.audio_key,
            t.audio_scale,
            t.energy,
            t.danceability,
            t.valence,
            t.bliss_vector,
            COALESCE(t.lastfm_playcount, 0) AS popularity
        FROM library_tracks t
        JOIN library_albums alb ON alb.id = t.album_id
        LEFT JOIN library_artists art ON art.name = t.artist
        WHERE t.artist = ANY(:artists)
        ORDER BY
            COALESCE(t.lastfm_playcount, 0) DESC,
            t.title ASC
        LIMIT :lim
        """,
        {"artists": matching_artists[:100], "lim": limit},
    )


__all__ = ["get_discovery_track_rows"]
