"""Generation and smart-rule helpers for playlists."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope


_FIELD_COLUMNS: dict[str, str] = {
    "genre": "t.genre",
    "artist": "t.artist",
    "album": "a.name",
    "title": "t.title",
    "year": "t.year",
    "format": "t.format",
    "audio_key": "t.audio_key",
    "bpm": "t.bpm",
    "energy": "t.energy",
    "danceability": "t.danceability",
    "valence": "t.valence",
    "acousticness": "t.acousticness",
    "instrumentalness": "t.instrumentalness",
    "loudness": "t.loudness",
    "dynamic_range": "t.dynamic_range",
    "rating": "t.rating",
    "bit_depth": "t.bit_depth",
    "sample_rate": "t.sample_rate",
    "duration": "t.duration",
    "popularity": "t.popularity",
}

_TEXT_FIELDS = {"genre", "artist", "album", "title", "format", "audio_key"}

_SORT_MAP: dict[str, str] = {
    "random": "RANDOM()",
    "popularity": (
        "CASE WHEN t.popularity_score IS NULL AND t.lastfm_playcount IS NULL "
        "AND t.lastfm_listeners IS NULL AND t.popularity IS NULL "
        "THEN 1 ELSE 0 END ASC, "
        "COALESCE(t.popularity_score, -1) DESC, "
        "COALESCE(t.lastfm_playcount, 0) DESC, "
        "COALESCE(t.lastfm_listeners, 0) DESC, "
        "COALESCE(t.lastfm_top_rank, 999999) ASC, "
        "COALESCE(t.popularity, 0) DESC, "
        "RANDOM()"
    ),
    "bpm": "t.bpm ASC NULLS LAST",
    "energy": "t.energy DESC NULLS LAST",
    "title": "t.title ASC",
}


def _combine_sql_extrema(expressions: list[str], mode: str = "greatest") -> str:
    if not expressions:
        return "0.0"
    if len(expressions) == 1:
        return expressions[0]
    fn = "LEAST" if mode == "least" else "GREATEST"
    return f"{fn}({', '.join(expressions)})"


def _build_genre_relevance_expression(values: list[str], params: dict, next_param) -> str:
    per_value_scores: list[str] = []

    for raw_value in values:
        value = raw_value.strip()
        if not value:
            continue

        p_track = next_param("g")
        p_album = next_param("g")
        p_artist = next_param("g")
        pattern = f"%{value}%"
        params[p_track] = pattern
        params[p_album] = pattern
        params[p_artist] = pattern

        per_value_scores.append(
            f"""GREATEST(
                CASE WHEN t.genre ILIKE :{p_track} THEN 1.0 ELSE 0.0 END,
                COALESCE((
                    SELECT MAX(ag.weight)
                    FROM album_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.album_id = a.id
                      AND (g.name ILIKE :{p_album} OR g.slug ILIKE :{p_album})
                ), 0.0),
                COALESCE((
                    SELECT MAX(arg.weight)
                    FROM artist_genres arg
                    JOIN genres g ON g.id = arg.genre_id
                    WHERE arg.artist_name = t.artist
                      AND (g.name ILIKE :{p_artist} OR g.slug ILIKE :{p_artist})
                ), 0.0)
            )"""
        )

    return _combine_sql_extrema(per_value_scores, mode="greatest")


def execute_smart_rules(rules: dict, *, count_only: bool = False) -> list[dict] | int:
    match_mode = rules.get("match", "all")
    rule_list = rules.get("rules", [])
    limit = rules.get("limit", 50)
    sort = rules.get("sort", "random")
    deduplicate_artist = rules.get("deduplicate_artist", False)
    max_per_artist = rules.get("max_per_artist", 3)

    conditions: list[str] = []
    genre_score_exprs: list[str] = []
    params: dict = {}
    param_idx = 0

    def _next(prefix: str = "p") -> str:
        nonlocal param_idx
        param_idx += 1
        return f"{prefix}_{param_idx}"

    def _split_pipe(value: str) -> list[str]:
        return [item.strip() for item in value.split("|") if item.strip()]

    for rule in rule_list:
        field = rule.get("field", "")
        op = rule.get("op", "")
        value = rule.get("value")
        col = _FIELD_COLUMNS.get(field)
        if not col:
            continue

        if field == "genre" and op == "contains":
            values = _split_pipe(value) if isinstance(value, str) and "|" in value else [str(value)]
            score_expr = _build_genre_relevance_expression(values, params, _next)
            conditions.append(f"({score_expr}) > 0")
            genre_score_exprs.append(score_expr)
            continue

        if isinstance(value, str) and "|" in value and op in {"eq", "contains"}:
            values = _split_pipe(value)
            placeholders: list[str] = []
            for item in values:
                param = _next("v")
                params[param] = item
                placeholders.append(f":{param}")
            conditions.append(f"{col} IN ({','.join(placeholders)})")
            continue

        if op == "eq":
            param = _next("v")
            if field in _TEXT_FIELDS:
                conditions.append(f"{col} ILIKE :{param}")
                params[param] = str(value)
            else:
                conditions.append(f"{col} = :{param}")
                params[param] = value
        elif op == "neq":
            param = _next("v")
            conditions.append(f"{col} != :{param}")
            params[param] = value
        elif op == "contains":
            param = _next("v")
            conditions.append(f"{col} ILIKE :{param}")
            params[param] = f"%{value}%"
        elif op == "not_contains":
            param = _next("v")
            conditions.append(f"{col} NOT ILIKE :{param}")
            params[param] = f"%{value}%"
        elif op == "gte":
            param = _next("v")
            conditions.append(f"{col} >= :{param}")
            params[param] = value
        elif op == "lte":
            param = _next("v")
            conditions.append(f"{col} <= :{param}")
            params[param] = value
        elif op == "between" and isinstance(value, list) and len(value) >= 2:
            p_lo, p_hi = _next("lo"), _next("hi")
            conditions.append(f"{col} BETWEEN :{p_lo} AND :{p_hi}")
            params[p_lo] = value[0]
            params[p_hi] = value[1]
        elif op == "in" and isinstance(value, list):
            placeholders: list[str] = []
            for item in value:
                param = _next("v")
                params[param] = item
                placeholders.append(f":{param}")
            if placeholders:
                conditions.append(f"{col} IN ({','.join(placeholders)})")

    joiner = " AND " if match_mode == "all" else " OR "
    where = joiner.join(conditions) if conditions else "1=1"

    with read_scope() as s:
        if count_only:
            row = s.execute(
                text(
                    f"""
                    SELECT COUNT(*) AS cnt
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON t.album_id = a.id
                    LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
                    WHERE {where}
                    """
                ),
                params,
            ).mappings().first()
            return row["cnt"] if row else 0

        sort_clause = _SORT_MAP.get(sort, "RANDOM()")
        if genre_score_exprs:
            genre_relevance = _combine_sql_extrema(
                genre_score_exprs,
                mode="least" if match_mode == "all" else "greatest",
            )
            sort_clause = f"{genre_relevance} DESC, {sort_clause}"
        fetch_limit = limit * 3 if deduplicate_artist else limit
        query_params = {**params, "lim": fetch_limit}
        rows = s.execute(
            text(
                f"""
                SELECT t.id, t.storage_id::text, t.path, t.title, t.artist, a.name AS album,
                       t.duration, t.format, t.bpm, t.energy, t.genre, t.year,
                       a.id AS album_id, a.slug AS album_slug,
                       a_artist.id AS artist_id, a_artist.slug AS artist_slug
                FROM library_tracks t
                LEFT JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
                WHERE {where}
                ORDER BY {sort_clause}
                LIMIT :lim
                """
            ),
            query_params,
        ).mappings().all()

    results = [dict(row) for row in rows]
    if deduplicate_artist and max_per_artist > 0:
        artist_counts: dict[str, int] = {}
        deduped: list[dict] = []
        for track in results:
            artist = track.get("artist", "")
            count = artist_counts.get(artist, 0)
            if count < max_per_artist:
                deduped.append(track)
                artist_counts[artist] = count + 1
                if len(deduped) >= limit:
                    break
        return deduped
    return results[:limit]


def generate_by_genre(genre: str, limit: int = 50) -> list[int]:
    params = {"genre": f"%{genre.strip()}%", "lim": limit}
    genre_relevance = """GREATEST(
        CASE WHEN g.name ILIKE :genre OR g.slug ILIKE :genre THEN COALESCE(ag.weight, 0.0) ELSE 0.0 END,
        COALESCE((
            SELECT MAX(arg.weight)
            FROM artist_genres arg
            JOIN genres g2 ON g2.id = arg.genre_id
            WHERE arg.artist_name = t.artist
              AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
        ), 0.0),
        CASE WHEN t.genre ILIKE :genre THEN 1.0 ELSE 0.0 END
    )"""
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT
                    t.id,
                    MAX("""
                + genre_relevance
                + """) AS genre_relevance,
                    MAX(COALESCE(t.popularity_score, -1)) AS popularity_score
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN album_genres ag ON ag.album_id = a.id
                LEFT JOIN genres g ON g.id = ag.genre_id
                WHERE (
                    (g.name ILIKE :genre OR g.slug ILIKE :genre)
                    OR t.genre ILIKE :genre
                    OR EXISTS (
                        SELECT 1
                        FROM artist_genres arg
                        JOIN genres g2 ON g2.id = arg.genre_id
                        WHERE arg.artist_name = t.artist
                          AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
                    )
                )
                GROUP BY t.id
                ORDER BY genre_relevance DESC,
                         popularity_score DESC,
                         RANDOM()
                LIMIT :lim
                """
            ),
            params,
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_by_decade(decade: int, limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.year >= :year_start AND a.year <= :year_end
                ORDER BY RANDOM()
                LIMIT :lim
                """
            ),
            {"year_start": str(decade), "year_end": str(decade + 9), "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_by_artist(artist_name: str, limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                WHERE t.artist = :artist
                ORDER BY t.album_id, t.track_number
                LIMIT :lim
                """
            ),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_similar_artists(similar_names: list[str], limit: int = 50) -> list[int]:
    if not similar_names:
        return []
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                WHERE t.artist = ANY(:names)
                ORDER BY RANDOM()
                LIMIT :lim
                """
            ),
            {"names": similar_names, "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_random(limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text("SELECT id FROM library_tracks ORDER BY RANDOM() LIMIT :lim"),
            {"lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def log_generation_start(playlist_id: int, rules: dict | None, triggered_by: str = "manual") -> int:
    with optional_scope(None) as s:
        row = s.execute(
            text(
                """
                INSERT INTO playlist_generation_log (playlist_id, started_at, status, rule_snapshot_json, triggered_by)
                VALUES (:playlist_id, :started_at, 'running', :rule_snapshot_json, :triggered_by)
                RETURNING id
                """
            ),
            {
                "playlist_id": playlist_id,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "rule_snapshot_json": json.dumps(rules, default=str) if rules else None,
                "triggered_by": triggered_by,
            },
        ).mappings().first()
        return row["id"] if row else 0


def log_generation_complete(log_id: int, track_count: int, duration_sec: int) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'completed', completed_at = :completed_at, track_count = :track_count, duration_sec = :duration_sec
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "track_count": track_count,
                "duration_sec": duration_sec,
            },
        )


def log_generation_failed(log_id: int, error: str) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'failed', completed_at = :completed_at, error = :error
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error": error[:500],
            },
        )


def set_generation_status(playlist_id: int, status: str, error: str | None = None) -> None:
    updates = ["generation_status = :status", "updated_at = :now"]
    params: dict[str, object] = {
        "playlist_id": playlist_id,
        "status": status,
        "now": datetime.now(timezone.utc).isoformat(),
    }
    if status == "idle":
        updates.append("last_generated_at = :now")
        updates.append("generation_error = NULL")
    elif status == "failed" and error:
        updates.append("generation_error = :error")
        params["error"] = error[:500]

    with optional_scope(None) as s:
        s.execute(
            text(f"UPDATE playlists SET {', '.join(updates)} WHERE id = :playlist_id"),
            params,
        )


__all__ = [
    "execute_smart_rules",
    "generate_by_artist",
    "generate_by_decade",
    "generate_by_genre",
    "generate_random",
    "generate_similar_artists",
    "log_generation_complete",
    "log_generation_failed",
    "log_generation_start",
    "set_generation_status",
]
