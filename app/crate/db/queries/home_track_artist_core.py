from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


_ARTIST_CORE_SELECT = """
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
    COALESCE(t.lastfm_playcount, 0) AS popularity,
    COALESCE(alb.year, '') AS album_year,
    COALESCE(t.track_number, 9999) AS track_number
"""


def get_artist_core_track_rows(*, artist_id: int, artist_name: str, limit: int) -> list[dict]:
    return _fetch_rows(
        f"""
        SELECT
            {_ARTIST_CORE_SELECT}
        FROM library_tracks t
        LEFT JOIN library_albums alb ON alb.id = t.album_id
        LEFT JOIN library_artists art ON art.name = t.artist
        WHERE art.id = :artist_id OR (art.id IS NULL AND t.artist = :artist_name)
        ORDER BY
            COALESCE(t.lastfm_playcount, 0) DESC,
            COALESCE(alb.year, '') DESC,
            COALESCE(t.track_number, 9999) ASC,
            t.title ASC
        LIMIT :lim
        """,
        {"artist_id": artist_id, "artist_name": artist_name, "lim": max(limit * 5, 80)},
    )


def get_artists_core_track_rows(*, artist_ids: list[int], per_artist_limit: int) -> list[dict]:
    cleaned_ids = [int(artist_id) for artist_id in artist_ids if artist_id is not None]
    if not cleaned_ids:
        return []
    return _fetch_rows(
        f"""
        WITH ranked AS (
            SELECT
                {_ARTIST_CORE_SELECT},
                ROW_NUMBER() OVER (
                    PARTITION BY art.id
                    ORDER BY
                        COALESCE(t.lastfm_playcount, 0) DESC,
                        COALESCE(alb.year, '') DESC,
                        COALESCE(t.track_number, 9999) ASC,
                        t.title ASC
                ) AS artist_rank
            FROM library_tracks t
            LEFT JOIN library_albums alb ON alb.id = t.album_id
            JOIN library_artists art ON art.name = t.artist
            WHERE art.id = ANY(:artist_ids)
        )
        SELECT *
        FROM ranked
        WHERE artist_rank <= :lim
        ORDER BY artist_id, artist_rank
        """,
        {"artist_ids": cleaned_ids, "lim": max(per_artist_limit * 4, per_artist_limit)},
    )


__all__ = ["get_artist_core_track_rows", "get_artists_core_track_rows"]
