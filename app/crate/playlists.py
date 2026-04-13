"""Smart playlist generators using the local library database."""

import logging

from crate.db.core import get_db_ctx
from crate.lastfm import get_artist_info

log = logging.getLogger(__name__)


def generate_by_genre(genre: str, limit: int = 50) -> list[int]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            JOIN album_genres ag ON ag.album_id = a.id
            JOIN genres g ON g.id = ag.genre_id
            WHERE g.name ILIKE %s
            ORDER BY RANDOM()
            LIMIT %s
        """, (genre, limit))
        return [r["id"] for r in cur.fetchall()]


def generate_by_decade(decade: int, limit: int = 50) -> list[int]:
    year_start = str(decade)
    year_end = str(decade + 9)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            WHERE a.year >= %s AND a.year <= %s
            ORDER BY RANDOM()
            LIMIT %s
        """, (year_start, year_end, limit))
        return [r["id"] for r in cur.fetchall()]


def generate_by_artist(artist_name: str, limit: int = 50) -> list[int]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id FROM library_tracks t
            WHERE t.artist = %s
            ORDER BY t.album_id, t.track_number
            LIMIT %s
        """, (artist_name, limit))
        return [r["id"] for r in cur.fetchall()]


def generate_similar_artists(artist_name: str, limit: int = 50) -> list[int]:
    info = get_artist_info(artist_name)
    if not info or not info.get("similar"):
        return []
    similar_names = [s.get("name", "") for s in info["similar"] if s.get("name")]
    if not similar_names:
        return []
    with get_db_ctx() as cur:
        placeholders = ",".join(["%s"] * len(similar_names))
        cur.execute(f"""
            SELECT t.id FROM library_tracks t
            WHERE t.artist IN ({placeholders})
            ORDER BY RANDOM()
            LIMIT %s
        """, similar_names + [limit])
        return [r["id"] for r in cur.fetchall()]


def generate_random(limit: int = 50) -> list[int]:
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_tracks ORDER BY RANDOM() LIMIT %s", (limit,))
        return [r["id"] for r in cur.fetchall()]
