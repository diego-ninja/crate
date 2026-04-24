from __future__ import annotations

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.queries.bliss_shared import bliss_session_scope


def get_track_with_artist(session=None, track_path: str = "") -> dict | None:
    if not track_path:
        return None
    with bliss_session_scope(session) as active_session:
        row = active_session.execute(
            text(
                """
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                       t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
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


def get_bliss_candidates(
    session=None,
    bliss_vector: list[float] | None = None,
    exclude_path: str = "",
    limit: int = 200,
) -> list[dict]:
    if not bliss_vector:
        return []
    probe_vector = to_pgvector_literal(bliss_vector)
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                       t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
                       (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS bliss_dist
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.bliss_embedding IS NOT NULL AND t.path != :exclude_path
                ORDER BY bliss_dist ASC
                LIMIT :limit
                """
            ),
            {"probe_vector": probe_vector, "exclude_path": exclude_path, "limit": limit},
        ).mappings().all()
        return [dict(r) for r in result]


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
                        t.duration
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
                    WHERE ar.id = :artist_id AND t.path != :exclude_path
                    ORDER BY RANDOM()
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
                        t.duration
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    WHERE LOWER(a.artist) = LOWER(:artist_name) AND t.path != :exclude_path
                    ORDER BY RANDOM()
                    LIMIT :limit
                    """
                ),
                {"artist_name": artist_name, "exclude_path": exclude_path, "limit": limit},
            ).mappings().all()
        return [dict(r) for r in result]


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


def get_recommend_without_bliss_candidates(
    session=None,
    seed_paths: list[str] | None = None,
    similar_artist_names: list[str] | None = None,
    artist_pick_limit: int = 0,
    row_limit: int = 0,
) -> list[dict]:
    if not seed_paths or artist_pick_limit <= 0 or row_limit <= 0:
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
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(a.artist)
                            ORDER BY RANDOM()
                        ) AS artist_pick
                    FROM library_tracks t
                    JOIN library_albums a ON t.album_id = a.id
                    WHERE t.path <> ALL(:seed_paths)
                      AND (
                        LOWER(a.artist) = ANY(:similar_artist_names)
                        OR t.bpm IS NOT NULL
                        OR t.energy IS NOT NULL
                        OR t.audio_key IS NOT NULL
                        OR t.rating > 0
                      )
                )
                SELECT *
                FROM ranked
                WHERE artist_pick <= :artist_pick_limit
                LIMIT :row_limit
                """
            ),
            {
                "seed_paths": seed_paths,
                "similar_artist_names": similar_artist_names or ["__no_similar__"],
                "artist_pick_limit": artist_pick_limit,
                "row_limit": row_limit,
            },
        ).mappings().all()
        return [dict(row) for row in result]


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
                    t.rating
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.path = ANY(:seed_paths)
                """
            ),
            {"seed_paths": seed_paths},
        ).mappings().all()
        return [dict(row) for row in result]


def get_multi_seed_bliss_candidates(
    session=None,
    bliss_seed_paths: list[str] | None = None,
    all_seed_paths: list[str] | None = None,
    per_seed_limit: int = 0,
) -> list[dict]:
    if not bliss_seed_paths or not all_seed_paths or per_seed_limit <= 0:
        return []
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                WITH seeds AS (
                    SELECT
                        t.path AS seed_path,
                        t.bliss_embedding AS seed_bliss_embedding
                    FROM library_tracks t
                    WHERE t.path = ANY(:bliss_seed_paths) AND t.bliss_embedding IS NOT NULL
                ),
                ranked AS (
                    SELECT
                        s.seed_path,
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
                        ROW_NUMBER() OVER (
                            PARTITION BY s.seed_path
                            ORDER BY t.bliss_embedding <-> s.seed_bliss_embedding ASC
                        ) AS seed_rank
                    FROM seeds s
                    JOIN library_tracks t
                      ON t.bliss_embedding IS NOT NULL
                     AND t.path <> s.seed_path
                     AND t.path <> ALL(:all_seed_paths)
                    JOIN library_albums a ON t.album_id = a.id
                )
                SELECT *
                FROM ranked
                WHERE seed_rank <= :per_seed_limit
                """
            ),
            {"bliss_seed_paths": bliss_seed_paths, "all_seed_paths": all_seed_paths, "per_seed_limit": per_seed_limit},
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
    "get_bliss_candidates",
    "get_multi_seed_bliss_candidates",
    "get_playlist_tracks_for_radio",
    "get_recommend_without_bliss_candidates",
    "get_same_artist_tracks",
    "get_seed_tracks_by_paths",
    "get_similar_artist_tracks_for_radio",
    "get_track_with_artist",
]
