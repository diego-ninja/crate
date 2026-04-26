from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import get_genre_summary_by_slug
from crate.db.tx import read_scope


def get_genre_detail(slug: str) -> dict | None:
    with read_scope() as session:
        genre = get_genre_summary_by_slug(session, slug)
        if not genre:
            return None
        if not genre.get("description") and not genre.get("mapped"):
            genre["description"] = "raw library tag detected in your collection but not yet linked into the curated taxonomy."

        rows = session.execute(
            text(
                """
                SELECT
                    ag.artist_name,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    ag.weight,
                    ag.source,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    la.spotify_popularity,
                    la.listeners
                FROM artist_genres ag
                JOIN library_artists la ON ag.artist_name = la.name
                WHERE ag.genre_id = :genre_id
                ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
                """
            ),
            {"genre_id": genre["id"]},
        ).mappings().all()
        genre["artists"] = [dict(r) for r in rows]

        rows = session.execute(
            text(
                """
                SELECT DISTINCT ON (a.id)
                    a.id AS album_id,
                    a.slug AS album_slug,
                    a.artist,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    a.name,
                    a.year,
                    a.track_count,
                    a.has_cover,
                    COALESCE(alg.weight, ag.weight, 0.5) AS weight
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = :genre_id
                LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = :genre_id
                WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
                ORDER BY a.id, a.year DESC NULLS LAST
                """
            ),
            {"genre_id": genre["id"]},
        ).mappings().all()
        genre["albums"] = [dict(r) for r in rows]

        return genre


def get_artists_with_tags() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(text("SELECT name, tags_json FROM library_artists WHERE tags_json IS NOT NULL")).mappings().all()
    return [dict(r) for r in rows]


def get_albums_with_genres() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.id, a.artist, a.name, a.genre,
                       array_agg(DISTINCT t.genre) FILTER (WHERE t.genre IS NOT NULL AND t.genre != '') AS track_genres
                FROM library_albums a
                LEFT JOIN library_tracks t ON t.album_id = a.id
                GROUP BY a.id, a.artist, a.name, a.genre
                """
            )
        ).mappings().all()
    return [dict(r) for r in rows]


def get_artists_missing_genre_mapping() -> list[str]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT a.artist AS name
                FROM library_albums a
                JOIN album_genres ag ON ag.album_id = a.id
                WHERE a.artist NOT IN (SELECT artist_name FROM artist_genres)
                """
            )
        ).mappings().all()
    return [r["name"] for r in rows]


def get_artist_album_genres(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, COALESCE(SUM(ag.weight), 0)::FLOAT AS score
                FROM album_genres ag
                JOIN genres g ON ag.genre_id = g.id
                JOIN library_albums a ON ag.album_id = a.id
                WHERE a.artist = :artist
                GROUP BY g.name
                ORDER BY score DESC, g.name ASC
                """
            ),
            {"artist": artist_name},
        ).mappings().all()
    return [dict(r) for r in rows]


__all__ = [
    "get_albums_with_genres",
    "get_artist_album_genres",
    "get_artists_missing_genre_mapping",
    "get_artists_with_tags",
    "get_genre_detail",
]
