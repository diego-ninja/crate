import re
import json
from datetime import datetime, timezone
from crate.db.core import get_db_ctx

# ── Genres ────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    return slug


def get_or_create_genre(name: str) -> int:
    name = name.strip().lower()
    slug = _slugify(name)
    if not slug:
        return -1
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM genres WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if row:
            return row["id"]
        cur.execute(
            "INSERT INTO genres (name, slug) VALUES (%s, %s) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",
            (name, slug),
        )
        return cur.fetchone()["id"]


def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]]):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM artist_genres WHERE artist_name = %s", (artist_name,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (artist_name, genre_id, weight, source),
            )


def set_album_genres(album_id: int, genres: list[tuple[str, float, str]]):
    """Set genres for an album. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM album_genres WHERE album_id = %s", (album_id,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (album_id, genre_id, weight, source),
            )


def get_all_genres() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT g.id, g.name, g.slug,
                   COUNT(DISTINCT ag.artist_name) AS artist_count,
                   COUNT(DISTINCT alg.album_id) AS album_count
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            GROUP BY g.id, g.name, g.slug
            HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC
        """)
        return [dict(r) for r in cur.fetchall()]


def get_genre_detail(slug: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM genres WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if not row:
            return None
        genre = dict(row)

        # Top artists by weight
        cur.execute("""
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
            WHERE ag.genre_id = %s
            ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
        """, (genre["id"],))
        genre["artists"] = [dict(r) for r in cur.fetchall()]

        # Albums in this genre: from album_genres OR from artists in this genre
        cur.execute("""
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
            LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = %s
            LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = %s
            WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
            ORDER BY a.id, a.year DESC NULLS LAST
        """, (genre["id"], genre["id"]))
        genre["albums"] = [dict(r) for r in cur.fetchall()]

        return genre

