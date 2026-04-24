from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.queries.bliss_shared import bliss_session_scope, normalize_similarity_score
from crate.db.tx import transaction_scope


def get_similar_artist_rows(
    session=None,
    *,
    artist_id: int | None = None,
    artist_name: str | None = None,
) -> list[dict]:
    """Return similar artists using current schema, falling back to similar_json if needed."""
    with bliss_session_scope(session) as active_session:
        rows: list[dict] = []

        if artist_id is not None:
            result = active_session.execute(
                text(
                    """
                    SELECT s.similar_name, s.score, COALESCE(s.in_library, FALSE) AS in_library
                    FROM artist_similarities s
                    JOIN library_artists ar ON LOWER(s.artist_name) = LOWER(ar.name)
                    WHERE ar.id = :artist_id
                    ORDER BY s.score DESC NULLS LAST, s.similar_name ASC
                    """
                ),
                {"artist_id": artist_id},
            ).mappings().all()
            rows = [dict(row) for row in result]
        elif artist_name:
            result = active_session.execute(
                text(
                    """
                    SELECT similar_name, score, COALESCE(in_library, FALSE) AS in_library
                    FROM artist_similarities
                    WHERE LOWER(artist_name) = LOWER(:artist_name)
                    ORDER BY score DESC NULLS LAST, similar_name ASC
                    """
                ),
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
                    "score": normalize_similarity_score(score),
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


def get_artist_genre_ids(session=None, artist_name: str = "") -> set[str]:
    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                SELECT g.name FROM genres g
                JOIN artist_genres ag ON ag.genre_id = g.id
                WHERE ag.artist_name = :artist_name
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return {r["name"] for r in result}


def get_artist_genre_map(session=None, artist_names: set[str] | None = None) -> dict[str, set[str]]:
    if not artist_names:
        return {}

    with bliss_session_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                SELECT ag.artist_name, g.name
                FROM artist_genres ag
                JOIN genres g ON ag.genre_id = g.id
                WHERE ag.artist_name = ANY(:artist_names)
                """
            ),
            {"artist_names": list(artist_names)},
        ).mappings().all()
        genre_map: dict[str, set[str]] = {name: set() for name in artist_names}
        for row in result:
            genre_map.setdefault(row["artist_name"], set()).add(row["name"])
        return genre_map


def build_user_radio_profile(
    user_id: int | None,
    track_ids: list[int],
    artist_names: list[str],
    artist_name_keys: list[str],
    album_pairs: list[tuple[str, str]],
) -> dict:
    if not user_id:
        return {}

    recency_cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

    with transaction_scope() as session:
        liked_track_ids: set[int] = set()
        if track_ids:
            result = session.execute(
                text(
                    """
                    SELECT track_id
                    FROM user_liked_tracks
                    WHERE user_id = :user_id AND track_id = ANY(:track_ids)
                    """
                ),
                {"user_id": user_id, "track_ids": track_ids},
            ).mappings().all()
            liked_track_ids = {row["track_id"] for row in result}

        recent_track_events: dict[int, dict] = {}
        if track_ids:
            result = session.execute(
                text(
                    """
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
                    """
                ),
                {"user_id": user_id, "track_ids": track_ids, "recency_cutoff": recency_cutoff},
            ).mappings().all()
            recent_track_events = {row["track_id"]: dict(row) for row in result}

        artist_stats: dict[str, dict] = {}
        if artist_names:
            result = session.execute(
                text(
                    """
                    SELECT
                        artist_name,
                        play_count,
                        complete_play_count,
                        last_played_at
                    FROM user_artist_stats
                    WHERE user_id = :user_id
                      AND stat_window = '30d'
                      AND LOWER(artist_name) = ANY(:artist_name_keys)
                    """
                ),
                {"user_id": user_id, "artist_name_keys": artist_name_keys},
            ).mappings().all()
            artist_stats = {row["artist_name"].lower(): dict(row) for row in result}

        album_stats: dict[tuple[str, str], dict] = {}
        if album_pairs:
            artist_list = [artist.lower() for artist, _ in album_pairs]
            album_list = [album.lower() for _, album in album_pairs]
            result = session.execute(
                text(
                    """
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
                    """
                ),
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


def get_artist_by_id(session=None, artist_id: int | None = None) -> dict | None:
    if artist_id is None:
        return None
    with bliss_session_scope(session) as active_session:
        row = active_session.execute(
            text("SELECT id, name FROM library_artists WHERE id = :artist_id"),
            {"artist_id": artist_id},
        ).mappings().first()
        return dict(row) if row else None


def get_artist_tracks(session=None, artist_id: int | None = None) -> list[dict]:
    if artist_id is None:
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
                JOIN library_artists ar ON LOWER(a.artist) = LOWER(ar.name)
                WHERE ar.id = :artist_id
                ORDER BY RANDOM()
                """
            ),
            {"artist_id": artist_id},
        ).mappings().all()
        return [dict(row) for row in result]


__all__ = [
    "build_user_radio_profile",
    "get_artist_by_id",
    "get_artist_genre_ids",
    "get_artist_genre_map",
    "get_artist_tracks",
    "get_similar_artist_rows",
]
