from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.queries.bliss_shared import bliss_session_scope, normalize_similarity_score


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
                    t.danceability,
                    t.valence,
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
    "get_artist_by_id",
    "get_artist_genre_ids",
    "get_artist_genre_map",
    "get_artist_tracks",
    "get_similar_artist_rows",
]
