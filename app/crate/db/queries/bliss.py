"""Database queries for bliss similarity/radio features.

Encapsulates all SQL used by crate.bliss — complex similarity queries
with float8[] vectors, composite scoring, and multi-seed aggregation.
"""

import json
from datetime import datetime, timedelta, timezone

from crate.db.core import get_db_ctx


# ── Vector storage ──────────────────────────────────────────────

def store_bliss_vectors(vectors: dict[str, list[float]]):
    """Store bliss feature vectors in the database (only for tracks missing them)."""
    with get_db_ctx() as cur:
        for path, features in vectors.items():
            cur.execute(
                "UPDATE library_tracks SET bliss_vector = %s WHERE path = %s AND bliss_vector IS NULL",
                (features, path),
            )


# ── Similar artist helpers ──────────────────────────────────────

def get_similar_artist_rows(
    cur,
    *,
    artist_id: int | None = None,
    artist_name: str | None = None,
) -> list[dict]:
    """Return similar artists using current schema, falling back to similar_json if needed.

    NOTE: This function takes a cursor (not get_db_ctx) because it is called
    within existing transaction blocks in bliss.py.
    """
    rows: list[dict] = []

    if artist_id is not None:
        cur.execute(
            """
            SELECT s.similar_name, s.score, COALESCE(s.in_library, FALSE) AS in_library
            FROM artist_similarities s
            JOIN library_artists ar ON LOWER(s.artist_name) = LOWER(ar.name)
            WHERE ar.id = %s
            ORDER BY s.score DESC NULLS LAST, s.similar_name ASC
            """,
            (artist_id,),
        )
        rows = [dict(row) for row in cur.fetchall()]
    elif artist_name:
        cur.execute(
            """
            SELECT similar_name, score, COALESCE(in_library, FALSE) AS in_library
            FROM artist_similarities
            WHERE LOWER(artist_name) = LOWER(%s)
            ORDER BY score DESC NULLS LAST, similar_name ASC
            """,
            (artist_name,),
        )
        rows = [dict(row) for row in cur.fetchall()]

    if rows:
        return rows

    if artist_id is not None:
        cur.execute("SELECT name, similar_json FROM library_artists WHERE id = %s", (artist_id,))
    else:
        cur.execute(
            "SELECT name, similar_json FROM library_artists WHERE LOWER(name) = LOWER(%s) LIMIT 1",
            (artist_name,),
        )
    artist_row = cur.fetchone()
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

    cur.execute(
        "SELECT LOWER(name) AS artist_key FROM library_artists WHERE LOWER(name) = ANY(%s)",
        ([name.lower() for name in names],),
    )
    in_library = {row["artist_key"] for row in cur.fetchall()}
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


# ── Genre helpers (cursor-based) ────────────────────────────────

def get_artist_genre_ids(cur, artist_name: str) -> set[str]:
    """Return genre names for an artist via artist_genres table."""
    cur.execute("""
        SELECT g.name FROM genres g
        JOIN artist_genres ag ON ag.genre_id = g.id
        WHERE ag.artist_name = %s
    """, (artist_name,))
    return {r["name"] for r in cur.fetchall()}


def get_artist_genre_map(cur, artist_names: set[str]) -> dict[str, set[str]]:
    if not artist_names:
        return {}

    cur.execute(
        """
        SELECT ag.artist_name, g.name
        FROM artist_genres ag
        JOIN genres g ON ag.genre_id = g.id
        WHERE ag.artist_name = ANY(%s)
        """,
        (list(artist_names),),
    )
    genre_map: dict[str, set[str]] = {name: set() for name in artist_names}
    for row in cur.fetchall():
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

    with get_db_ctx() as cur:
        liked_track_ids: set[int] = set()
        if track_ids:
            cur.execute(
                """
                SELECT track_id
                FROM user_liked_tracks
                WHERE user_id = %s AND track_id = ANY(%s)
                """,
                (user_id, track_ids),
            )
            liked_track_ids = {row["track_id"] for row in cur.fetchall()}

        recent_track_events: dict[int, dict] = {}
        if track_ids:
            cur.execute(
                """
                SELECT
                    track_id,
                    COUNT(*)::INTEGER AS play_count,
                    SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
                    MAX(ended_at) AS last_played_at
                FROM user_play_events
                WHERE user_id = %s
                  AND track_id = ANY(%s)
                  AND ended_at >= %s
                GROUP BY track_id
                """,
                (user_id, track_ids, recency_cutoff),
            )
            recent_track_events = {row["track_id"]: dict(row) for row in cur.fetchall()}

        artist_stats: dict[str, dict] = {}
        if artist_names:
            cur.execute(
                """
                SELECT
                    artist_name,
                    play_count,
                    complete_play_count,
                    last_played_at
                FROM user_artist_stats
                WHERE user_id = %s
                  AND stat_window = '30d'
                  AND LOWER(artist_name) = ANY(%s)
                """,
                (user_id, artist_name_keys),
            )
            artist_stats = {row["artist_name"].lower(): dict(row) for row in cur.fetchall()}

        album_stats: dict[tuple[str, str], dict] = {}
        if album_pairs:
            artist_list = [artist.lower() for artist, _ in album_pairs]
            album_list = [album.lower() for _, album in album_pairs]
            cur.execute(
                """
                WITH pairs(artist_key, album_key) AS (
                    SELECT UNNEST(%s::text[]), UNNEST(%s::text[])
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
                WHERE s.user_id = %s
                  AND s.stat_window = '30d'
                """,
                (artist_list, album_list, user_id),
            )
            album_stats = {
                ((row["artist"] or "").lower(), (row["album"] or "").lower()): dict(row)
                for row in cur.fetchall()
            }

    return {
        "liked_track_ids": liked_track_ids,
        "recent_track_events": recent_track_events,
        "artist_stats": artist_stats,
        "album_stats": album_stats,
    }


# ── Track queries for radio ─────────────────────────────────────

def get_artist_by_id(cur, artist_id: int) -> dict | None:
    cur.execute("SELECT id, name FROM library_artists WHERE id = %s", (artist_id,))
    return cur.fetchone()


def get_artist_tracks(cur, artist_id: int) -> list[dict]:
    cur.execute(
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
        JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
        WHERE ar.id = %s
        ORDER BY RANDOM()
        """,
        (artist_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def get_track_with_artist(cur, track_path: str) -> dict | None:
    cur.execute("""
        SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
               t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
               ar.id AS artist_id
        FROM library_tracks t
        JOIN library_albums a ON t.album_id = a.id
        LEFT JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
        WHERE t.path = %s
    """, (track_path,))
    row = cur.fetchone()
    return dict(row) if row else None


def get_bliss_candidates(cur, bliss_vector: list[float], exclude_path: str, limit: int = 200) -> list[dict]:
    cur.execute("""
        SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
               t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy, t.rating,
               SQRT(
                   (SELECT SUM(POW(x - y, 2))
                    FROM UNNEST(t.bliss_vector, %s::float8[]) AS v(x, y))
               ) AS bliss_dist
        FROM library_tracks t
        JOIN library_albums a ON t.album_id = a.id
        WHERE t.bliss_vector IS NOT NULL AND t.path != %s
        ORDER BY bliss_dist ASC
        LIMIT 200
    """, (bliss_vector, exclude_path))
    return [dict(r) for r in cur.fetchall()]


def get_same_artist_tracks(cur, *, artist_id: int | None, artist_name: str, exclude_path: str, limit: int) -> list[dict]:
    if artist_id is not None:
        cur.execute(
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
            WHERE ar.id = %s AND t.path != %s
            ORDER BY RANDOM()
            LIMIT %s
            """,
            (artist_id, exclude_path, limit),
        )
    else:
        cur.execute(
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
            WHERE LOWER(a.artist) = LOWER(%s) AND t.path != %s
            ORDER BY RANDOM()
            LIMIT %s
            """,
            (artist_name, exclude_path, limit),
        )
    return [dict(r) for r in cur.fetchall()]


def get_similar_artist_tracks_for_radio(cur, similar_artist_keys: list[str], limit: int) -> list[dict]:
    cur.execute(
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
              AND LOWER(a.artist) = ANY(%s)
        )
        SELECT *
        FROM ranked
        WHERE artist_pick <= 8
        LIMIT %s
        """,
        (similar_artist_keys[:16], limit),
    )
    return [dict(row) for row in cur.fetchall()]


def get_recommend_without_bliss_candidates(
    cur,
    seed_paths: list[str],
    similar_artist_names: list[str],
    artist_pick_limit: int,
    row_limit: int,
) -> list[dict]:
    cur.execute(
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
            WHERE t.path <> ALL(%s)
              AND (
                LOWER(a.artist) = ANY(%s)
                OR t.bpm IS NOT NULL
                OR t.energy IS NOT NULL
                OR t.audio_key IS NOT NULL
                OR t.rating > 0
              )
        )
        SELECT *
        FROM ranked
        WHERE artist_pick <= %s
        LIMIT %s
        """,
        (
            seed_paths,
            similar_artist_names or ["__no_similar__"],
            artist_pick_limit,
            row_limit,
        ),
    )
    return [dict(row) for row in cur.fetchall()]


def get_seed_tracks_by_paths(cur, seed_paths: list[str]) -> list[dict]:
    cur.execute(
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
        WHERE t.path = ANY(%s)
        """,
        (seed_paths,),
    )
    return [dict(row) for row in cur.fetchall()]


def get_multi_seed_bliss_candidates(cur, bliss_seed_paths: list[str], all_seed_paths: list[str], per_seed_limit: int) -> list[dict]:
    cur.execute(
        """
        WITH seeds AS (
            SELECT
                t.path AS seed_path,
                t.bliss_vector AS seed_bliss_vector
            FROM library_tracks t
            WHERE t.path = ANY(%s) AND t.bliss_vector IS NOT NULL
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
                    ORDER BY SQRT(
                        (
                            SELECT SUM(POW(x - y, 2))
                            FROM UNNEST(t.bliss_vector, s.seed_bliss_vector) AS v(x, y)
                        )
                    ) ASC
                ) AS seed_rank
            FROM seeds s
            JOIN library_tracks t
              ON t.bliss_vector IS NOT NULL
             AND t.path <> s.seed_path
             AND t.path <> ALL(%s)
            JOIN library_albums a ON t.album_id = a.id
        )
        SELECT *
        FROM ranked
        WHERE seed_rank <= %s
        """,
        (bliss_seed_paths, all_seed_paths, per_seed_limit),
    )
    return [dict(row) for row in cur.fetchall()]


def get_album_tracks_for_radio(cur, album_id: int) -> list[dict]:
    cur.execute("""
        SELECT t.id AS track_id, t.path, t.title, t.artist, a.artist AS album_artist, a.name AS album, a.year, t.duration,
               t.bliss_vector, t.rating
        FROM library_tracks t
        JOIN library_albums a ON t.album_id = a.id
        WHERE a.id = %s
        ORDER BY t.disc_number, t.track_number
    """, (album_id,))
    return [dict(row) for row in cur.fetchall()]


def get_playlist_tracks_for_radio(cur, playlist_id: int) -> list[dict]:
    cur.execute("""
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
               OR lt.path LIKE ('%%/' || pt.track_path)
            ORDER BY CASE WHEN lt.path = pt.track_path THEN 0 ELSE 1 END
            LIMIT 1
        ) lt ON TRUE
        LEFT JOIN library_albums la ON la.id = lt.album_id
        WHERE pt.playlist_id = %s
        ORDER BY pt.position
    """, (playlist_id,))
    return [dict(row) for row in cur.fetchall()]
