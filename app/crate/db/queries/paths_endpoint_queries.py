"""Endpoint and label queries for music paths."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def fetch_bliss_vectors_for_endpoint(endpoint_type: str, value: str) -> list[list[float]]:
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
                {"id": int(value)},
            ).mappings().first()
            return [list(row["bliss_vector"])] if row else []

        if endpoint_type == "album":
            rows = session.execute(
                text(
                    """
                    SELECT bliss_vector FROM library_tracks
                    WHERE album_id = :id AND bliss_vector IS NOT NULL
                    """
                ),
                {"id": int(value)},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

        if endpoint_type == "artist":
            rows = session.execute(
                text(
                    """
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE a.artist = (
                        SELECT name FROM library_artists WHERE id = :id
                    )
                    AND t.bliss_vector IS NOT NULL
                    LIMIT 20
                    """
                ),
                {"id": int(value)},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

        if endpoint_type == "genre":
            rows = session.execute(
                text(
                    """
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    JOIN artist_genres ag ON ag.artist_name = a.artist
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug AND t.bliss_vector IS NOT NULL
                    ORDER BY ag.weight DESC
                    LIMIT 30
                    """
                ),
                {"slug": value},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

    return []


def resolve_endpoint_label(endpoint_type: str, value: str) -> str:
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT title, artist FROM library_tracks WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['title']} — {row['artist']}" if row else value

        if endpoint_type == "album":
            row = session.execute(
                text("SELECT name, artist FROM library_albums WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['name']} — {row['artist']}" if row else value

        if endpoint_type == "artist":
            row = session.execute(
                text("SELECT name FROM library_artists WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return row["name"] if row else value

        if endpoint_type == "genre":
            row = session.execute(
                text("SELECT name FROM genres WHERE slug = :slug"),
                {"slug": value},
            ).mappings().first()
            return row["name"] if row else value

    return value


__all__ = ["fetch_bliss_vectors_for_endpoint", "resolve_endpoint_label"]
