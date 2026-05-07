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
                        t.danceability,
                        t.valence,
                        t.rating,
                        LOWER(a.artist) AS similar_name_key,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(a.artist)
                            ORDER BY COALESCE(t.lastfm_playcount, 0) DESC, t.id
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
                       t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.danceability, t.valence, t.rating
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
                    lt.bpm,
                    lt.audio_key,
                    lt.audio_scale,
                    lt.energy,
                    lt.danceability,
                    lt.valence,
                    lt.rating
                FROM (
                    SELECT
                        pt.*,
                        COALESCE(lt_id.id, lt_entity.id, lt_storage.id, lt_path.id) AS resolved_track_id
                    FROM playlist_tracks pt
                    LEFT JOIN library_tracks lt_id
                      ON lt_id.id = pt.track_id
                    LEFT JOIN library_tracks lt_entity
                      ON lt_id.id IS NULL
                     AND pt.track_entity_uid IS NOT NULL
                     AND lt_entity.entity_uid = pt.track_entity_uid
                    LEFT JOIN library_tracks lt_storage
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND pt.track_storage_id IS NOT NULL
                     AND lt_storage.storage_id = pt.track_storage_id
                    LEFT JOIN library_tracks lt_path
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND lt_storage.id IS NULL
                     AND pt.track_path IS NOT NULL
                     AND lt_path.path = pt.track_path
                    WHERE pt.playlist_id = :playlist_id
                ) pt
                JOIN library_tracks lt
                  ON lt.id = pt.resolved_track_id
                 AND (lt.entity_uid IS NOT NULL OR lt.storage_id IS NOT NULL)
                LEFT JOIN library_albums la ON la.id = lt.album_id
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
