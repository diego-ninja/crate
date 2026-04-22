"""Database queries for bliss similarity/radio features."""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.tx import transaction_scope
from sqlalchemy import text


# ── Vector storage ──────────────────────────────────────────────

def store_bliss_vectors(vectors: dict[str, list[float]]):
    """Store bliss feature vectors in the database (only for tracks missing them)."""
    with transaction_scope() as session:
        for path, features in vectors.items():
            session.execute(
                text(
                    "UPDATE library_tracks "
                    "SET bliss_vector = :features, "
                    "    bliss_embedding = CAST(:vector_literal AS vector(20)) "
                    "WHERE path = :path AND bliss_vector IS NULL"
                ),
                {"features": features, "vector_literal": to_pgvector_literal(features), "path": path},
            )


from crate.db.tx import optional_scope as _bliss_session_scope  # alias for compat


# ── Similar artist helpers ──────────────────────────────────────

def get_similar_artist_rows(
    session=None,
    *,
    artist_id: int | None = None,
    artist_name: str | None = None,
) -> list[dict]:
    """Return similar artists using current schema, falling back to similar_json if needed."""
    with _bliss_session_scope(session) as active_session:
        rows: list[dict] = []

        if artist_id is not None:
            result = active_session.execute(
                text("""
                SELECT s.similar_name, s.score, COALESCE(s.in_library, FALSE) AS in_library
                FROM artist_similarities s
                JOIN library_artists ar ON LOWER(s.artist_name) = LOWER(ar.name)
                WHERE ar.id = :artist_id
                ORDER BY s.score DESC NULLS LAST, s.similar_name ASC
                """),
                {"artist_id": artist_id},
            ).mappings().all()
            rows = [dict(row) for row in result]
        elif artist_name:
            result = active_session.execute(
                text("""
                SELECT similar_name, score, COALESCE(in_library, FALSE) AS in_library
                FROM artist_similarities
                WHERE LOWER(artist_name) = LOWER(:artist_name)
                ORDER BY score DESC NULLS LAST, similar_name ASC
                """),
                {"artist_name": artist_name},
            ).mappings().all()
            rows = [dict(row) for row in result]

        if rows:
            return rows

        if artist_id is not None:
            artist_row = active_session.execute(
                text("SELECT name, similar_json FROM library_artists WHERE id = :artist_id"),
                {"artist_id": artist_id},
            ).mappings().first()
        else:
            artist_row = active_session.execute(
                text("SELECT name, similar_json FROM library_artists WHERE LOWER(name) = LOWER(:artist_name) LIMIT 1"),
                {"artist_name": artist_name},
            ).mappings().first()
        if not artist_row or not artist_row.get("similar_json"):
            return []

        similar = artist_row["similar_json"]
        if isinstance(similar, str):
            similar = json.loads(similar)
        if not isinstance(similar, list):
            return []

        parsed_rows: list[dict] = []
        names: list[str] = []
        for item in similar:
            if isinstance(item, dict):
                name = (item.get("name") or "").strip()
                score = item.get("score", item.get("match"))
            else:
                name = str(item).strip()
                score = None
            if not name:
                continue
            names.append(name)
            parsed_rows.append(
                {
                    "similar_name": name,
                    "score": _normalize_similarity_score(score),
                    "in_library": False,
                }
            )

        if not parsed_rows:
            return []

        result = active_session.execute(
            text("SELECT LOWER(name) AS artist_key FROM library_artists WHERE LOWER(name) = ANY(:names)"),
            {"names": [name.lower() for name in names]},
        ).mappings().all()
        in_library = {row["artist_key"] for row in result}
        for row in parsed_rows:
            row["in_library"] = row["similar_name"].lower() in in_library
        return parsed_rows


def _normalize_similarity_score(score: float | int | str | None) -> float:
    try:
        value = float(score or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if value <= 0.0:
        return 0.0
    if value <= 1.0:
        return value
    if value <= 100.0:
        return value / 100.0
    return 1.0


# ── Genre helpers (session-based) ────────────────────────────────

def get_artist_genre_ids(session=None, artist_name: str = "") -> set[str]:
    """Return genre names for an artist via artist_genres table."""
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(text("""
            SELECT g.name FROM genres g
            JOIN artist_genres ag ON ag.genre_id = g.id
            WHERE ag.artist_name = :artist_name
        """), {"artist_name": artist_name}).mappings().all()
        return {r["name"] for r in result}


def get_artist_genre_map(session=None, artist_names: set[str] | None = None) -> dict[str, set[str]]:
    if not artist_names:
        return {}

    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
            SELECT ag.artist_name, g.name
            FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            WHERE ag.artist_name = ANY(:artist_names)
            """),
            {"artist_names": list(artist_names)},
        ).mappings().all()
        genre_map: dict[str, set[str]] = {name: set() for name in artist_names}
        for row in result:
            genre_map.setdefault(row["artist_name"], set()).add(row["name"])
        return genre_map


# ── User radio profile ──────────────────────────────────────────

def build_user_radio_profile(
    user_id: int | None,
    track_ids: list[int],
    artist_names: list[str],
    artist_name_keys: list[str],
    album_pairs: list[tuple[str, str]],
) -> dict:
    """Fetch user listening data for radio scoring.

    Returns dict with liked_track_ids, recent_track_events, artist_stats, album_stats.
    """
    if not user_id:
        return {}

    recency_cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

    with transaction_scope() as session:
        liked_track_ids: set[int] = set()
        if track_ids:
            result = session.execute(
                text("""
                SELECT track_id
                FROM user_liked_tracks
                WHERE user_id = :user_id AND track_id = ANY(:track_ids)
                """),
                {"user_id": user_id, "track_ids": track_ids},
            ).mappings().all()
            liked_track_ids = {row["track_id"] for row in result}

        recent_track_events: dict[int, dict] = {}
        if track_ids:
            result = session.execute(
                text("""
                SELECT
                    track_id,
                    COUNT(*)::INTEGER AS play_count,
                    SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
                    MAX(ended_at) AS last_played_at
                FROM user_play_events
                WHERE user_id = :user_id
                  AND track_id = ANY(:track_ids)
                  AND ended_at >= :recency_cutoff
                GROUP BY track_id
                """),
                {"user_id": user_id, "track_ids": track_ids, "recency_cutoff": recency_cutoff},
            ).mappings().all()
            recent_track_events = {row["track_id"]: dict(row) for row in result}

        artist_stats: dict[str, dict] = {}
        if artist_names:
            result = session.execute(
                text("""
                SELECT
                    artist_name,
                    play_count,
                    complete_play_count,
                    last_played_at
                FROM user_artist_stats
                WHERE user_id = :user_id
                  AND stat_window = '30d'
                  AND LOWER(artist_name) = ANY(:artist_name_keys)
                """),
                {"user_id": user_id, "artist_name_keys": artist_name_keys},
            ).mappings().all()
            artist_stats = {row["artist_name"].lower(): dict(row) for row in result}

        album_stats: dict[tuple[str, str], dict] = {}
        if album_pairs:
            artist_list = [artist.lower() for artist, _ in album_pairs]
            album_list = [album.lower() for _, album in album_pairs]
            result = session.execute(
                text("""
                WITH pairs(artist_key, album_key) AS (
                    SELECT *
                    FROM UNNEST(
                        CAST(:artist_list AS text[]),
                        CAST(:album_list AS text[])
                    )
                )
                SELECT
                    s.artist,
                    s.album,
                    s.play_count,
                    s.complete_play_count,
                    s.last_played_at
                FROM user_album_stats s
                JOIN pairs p
                  ON LOWER(s.artist) = p.artist_key
                 AND LOWER(s.album) = p.album_key
                WHERE s.user_id = :user_id
                  AND s.stat_window = '30d'
                """),
                {"artist_list": artist_list, "album_list": album_list, "user_id": user_id},
            ).mappings().all()
            album_stats = {
                ((row["artist"] or "").lower(), (row["album"] or "").lower()): dict(row)
                for row in result
            }

    return {
        "liked_track_ids": liked_track_ids,
        "recent_track_events": recent_track_events,
        "artist_stats": artist_stats,
        "album_stats": album_stats,
    }


# ── Track queries for radio ─────────────────────────────────────

def get_artist_by_id(session=None, artist_id: int | None = None) -> dict | None:
    if artist_id is None:
        return None
    with _bliss_session_scope(session) as active_session:
        row = active_session.execute(
            text("SELECT id, name FROM library_artists WHERE id = :artist_id"),
            {"artist_id": artist_id},
        ).mappings().first()
        return dict(row) if row else None


def get_artist_tracks(session=None, artist_id: int | None = None) -> list[dict]:
    if artist_id is None:
        return []
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
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
            JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
            WHERE ar.id = :artist_id
            ORDER BY RANDOM()
            """),
            {"artist_id": artist_id},
        ).mappings().all()
        return [dict(row) for row in result]


def get_track_with_artist(session=None, track_path: str = "") -> dict | None:
    if not track_path:
        return None
    with _bliss_session_scope(session) as active_session:
        row = active_session.execute(text("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                   t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
                   ar.id AS artist_id
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
            WHERE t.path = :track_path
        """), {"track_path": track_path}).mappings().first()
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
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(text("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                   t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
                   (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS bliss_dist
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE t.bliss_embedding IS NOT NULL AND t.path != :exclude_path
            ORDER BY bliss_dist ASC
            LIMIT :limit
        """), {"probe_vector": probe_vector, "exclude_path": exclude_path, "limit": limit}).mappings().all()
        return [dict(r) for r in result]


def get_same_artist_tracks(
    session=None,
    *,
    artist_id: int | None,
    artist_name: str,
    exclude_path: str,
    limit: int,
) -> list[dict]:
    with _bliss_session_scope(session) as active_session:
        if artist_id is not None:
            result = active_session.execute(
                text("""
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
                """),
                {"artist_id": artist_id, "exclude_path": exclude_path, "limit": limit},
            ).mappings().all()
        else:
            result = active_session.execute(
                text("""
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
                """),
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
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
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
            """),
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
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
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
            """),
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
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
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
            """),
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
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text("""
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
            """),
            {"bliss_seed_paths": bliss_seed_paths, "all_seed_paths": all_seed_paths, "per_seed_limit": per_seed_limit},
        ).mappings().all()
        return [dict(row) for row in result]


def get_album_tracks_for_radio(session=None, album_id: int | None = None) -> list[dict]:
    if album_id is None:
        return []
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(text("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
                   t.bliss_vector, t.rating
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.id = :album_id
            ORDER BY t.disc_number, t.track_number
        """), {"album_id": album_id}).mappings().all()
        return [dict(row) for row in result]


def get_playlist_tracks_for_radio(session=None, playlist_id: int | None = None) -> list[dict]:
    if playlist_id is None:
        return []
    with _bliss_session_scope(session) as active_session:
        result = active_session.execute(text("""
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
        """), {"playlist_id": playlist_id}).mappings().all()
        return [dict(row) for row in result]
