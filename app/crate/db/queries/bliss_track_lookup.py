from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.bliss_shared import bliss_session_scope


def get_track_with_artist(session=None, track_path: str = "") -> dict | None:
    if not track_path:
        return None
    with bliss_session_scope(session) as active_session:
        row = active_session.execute(
            text(
                """
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                       t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy,
                       t.danceability, t.valence, t.rating,
                       ar.id AS artist_id
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
                WHERE t.path = :track_path
                """
            ),
            {"track_path": track_path},
        ).mappings().first()
        return dict(row) if row else None


def get_same_artist_tracks(
    session=None,
    *,
    artist_id: int | None,
    artist_name: str,
    exclude_path: str,
    limit: int,
) -> list[dict]:
    with bliss_session_scope(session) as active_session:
        if artist_id is not None:
            result = active_session.execute(
                text(
                    """
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
                        t.valence
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
                    WHERE ar.id = :artist_id AND t.path != :exclude_path
                    ORDER BY COALESCE(t.lastfm_playcount, 0) DESC, t.id
                    LIMIT :limit
                    """
                ),
                {"artist_id": artist_id, "exclude_path": exclude_path, "limit": limit},
            ).mappings().all()
        else:
            result = active_session.execute(
                text(
                    """
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
                        t.valence
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    WHERE LOWER(a.artist) = LOWER(:artist_name) AND t.path != :exclude_path
                    ORDER BY COALESCE(t.lastfm_playcount, 0) DESC, t.id
                    LIMIT :limit
                    """
                ),
                {"artist_name": artist_name, "exclude_path": exclude_path, "limit": limit},
            ).mappings().all()
        return [dict(r) for r in result]


def get_seed_tracks_by_paths(session=None, seed_paths: list[str] | None = None) -> list[dict]:
    if not seed_paths:
        return []
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
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
                    t.rating
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.path = ANY(:seed_paths)
                """
            ),
            {"seed_paths": seed_paths},
        ).mappings().all()
        return [dict(row) for row in result]


__all__ = [
    "get_same_artist_tracks",
    "get_seed_tracks_by_paths",
    "get_track_with_artist",
]
