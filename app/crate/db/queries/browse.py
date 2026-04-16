from crate.db.core import get_db_ctx


def get_album_genre_ids(album_id: int) -> list[int]:
    with get_db_ctx() as cur:
        cur.execute("SELECT genre_id FROM album_genres WHERE album_id = %s", (album_id,))
        return [row["genre_id"] for row in cur.fetchall()]


def get_related_albums(album_id: int, artist: str, year: str | None, genre_ids: list[int]) -> dict:
    """Return related albums grouped by reason: same_artist, genre_decade, audio_similar."""
    results = {"same_artist": [], "genre_decade": [], "audio_similar": []}

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, "
            "a.year, a.track_count, a.has_cover "
            "FROM library_albums a LEFT JOIN library_artists ar ON ar.name = a.artist "
            "WHERE a.artist = %s AND a.id != %s ORDER BY a.year",
            (artist, album_id),
        )
        results["same_artist"] = [dict(row) for row in cur.fetchall()]

        if genre_ids and year:
            year_int = int(year)
            placeholders = ",".join(["%s"] * len(genre_ids))
            cur.execute(
                f"""
                SELECT DISTINCT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                JOIN album_genres ag ON a.id = ag.album_id
                WHERE ag.genre_id IN ({placeholders})
                AND a.artist != %s
                AND a.year IS NOT NULL AND length(a.year) >= 4
                AND CAST(substring(a.year, 1, 4) AS INTEGER) BETWEEN %s AND %s
                ORDER BY RANDOM() LIMIT 10
                """,
                (*genre_ids, artist, year_int - 5, year_int + 5),
            )
            results["genre_decade"] = [dict(row) for row in cur.fetchall()]

        cur.execute(
            """
            SELECT AVG(energy) AS e, AVG(danceability) AS d, AVG(valence) AS v
            FROM library_tracks WHERE album_id = %s AND energy IS NOT NULL
            """,
            (album_id,),
        )
        audio = cur.fetchone()
        if audio and audio["e"] is not None:
            cur.execute(
                """
                SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover,
                    ABS(AVG(t.energy) - %s) + ABS(AVG(t.danceability) - %s) + ABS(AVG(t.valence) - %s) AS dist
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                JOIN library_tracks t ON t.album_id = a.id
                WHERE t.energy IS NOT NULL AND a.id != %s AND a.artist != %s
                GROUP BY a.id, a.slug, a.name, a.artist, ar.id, ar.slug, a.year, a.track_count, a.has_cover
                ORDER BY dist ASC LIMIT 8
                """,
                (audio["e"], audio["d"], audio["v"], album_id, artist),
            )
            results["audio_similar"] = [dict(row) for row in cur.fetchall()]

    return results


def get_album_genres_list(album_id: int) -> list[str]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM album_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.album_id = %s ORDER BY ag.weight DESC",
            (album_id,),
        )
        return [row["name"] for row in cur.fetchall()]


import re as _re

_YEAR_PREFIX_RE = _re.compile(r"^\d{4}\s*[-–]\s*")


def _display_name(folder_name: str) -> str:
    return _YEAR_PREFIX_RE.sub("", folder_name)


def find_album_row(artist: str, album: str) -> dict | None:
    """Find album in DB, handling year-prefixed names, clean names, and case differences."""

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND LOWER(name) = LOWER(%s) LIMIT 1",
            (artist, album),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND name ILIKE %s LIMIT 1",
            (artist, f"% - {album}"),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        cur.execute("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s)", (artist,))
        for row in cur.fetchall():
            if _display_name(row["name"]) == album:
                return dict(row)
    return None
