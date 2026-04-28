from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.bliss_shared import bliss_session_scope


def get_similar_artist_tracks_for_radio(
    session=None,
    similar_artist_keys: list[str] | None = None,
    limit: int = 0,
) -> list[dict]:
    if not similar_artist_keys or limit <= 0:
        return []
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                WITH ranked AS (
                    SELECT
                        t.id AS track_id,
                        t.path,
                        t.title,
                        t.artist,
                        a.artist AS album_artist,
                        a.name AS album,
                        a.year,
                        t.duration,
                        t.bliss_vector,
                        t.bpm,
                        t.audio_key,
                        t.audio_scale,
                        t.energy,
                        t.rating,
                        LOWER(a.artist) AS similar_name_key,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(a.artist)
                            ORDER BY RANDOM()
                        ) AS artist_pick
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    WHERE t.bliss_vector IS NOT NULL
                      AND LOWER(a.artist) = ANY(:similar_artist_keys)
                )
                SELECT *
                FROM ranked
                WHERE artist_pick <= 8
                LIMIT :limit
                """
            ),
            {"similar_artist_keys": similar_artist_keys[:16], "limit": limit},
        ).mappings().all()
        return [dict(row) for row in result]


def get_album_tracks_for_radio(session=None, album_id: int | None = None) -> list[dict]:
    if album_id is None:
        return []
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                       t.bliss_vector, t.rating
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.id = :album_id
                ORDER BY t.disc_number, t.track_number
                """
            ),
            {"album_id": album_id},
        ).mappings().all()
        return [dict(row) for row in result]


def get_playlist_tracks_for_radio(session=None, playlist_id: int | None = None) -> list[dict]:
    if playlist_id is None:
        return []
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                SELECT
                    lt.id AS track_id,
                    lt.path,
                    COALESCE(pt.title, lt.title) AS title,
                    COALESCE(pt.artist, lt.artist) AS artist,
                    COALESCE(la.artist, lt.artist, pt.artist) AS album_artist,
                    COALESCE(pt.album, lt.album) AS album,
                    la.year,
                    COALESCE(pt.duration, lt.duration, 0) AS duration,
                    lt.bliss_vector,
                    lt.rating
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT lt.id, lt.path, lt.title, lt.artist, lt.album, lt.duration, lt.bliss_vector, lt.album_id
                    FROM library_tracks lt
                    WHERE lt.path = pt.track_path
                       OR lt.path LIKE ('%/' || pt.track_path)
                    ORDER BY CASE WHEN lt.path = pt.track_path THEN 0 ELSE 1 END
                    LIMIT 1
                ) lt ON TRUE
                LEFT JOIN library_albums la ON la.id = lt.album_id
                WHERE pt.playlist_id = :playlist_id
                ORDER BY pt.position
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().all()
        return [dict(row) for row in result]


__all__ = [
    "get_album_tracks_for_radio",
    "get_playlist_tracks_for_radio",
    "get_similar_artist_tracks_for_radio",
]
