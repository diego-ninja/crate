from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_album_genre_ids(album_id: int) -> list[int]:
    with transaction_scope() as session:
        rows = session.execute(text("SELECT genre_id FROM album_genres WHERE album_id = :album_id"), {"album_id": album_id}).mappings().all()
        return [row["genre_id"] for row in rows]


def get_related_albums(album_id: int, artist: str, year: str | None, genre_ids: list[int]) -> dict:
    """Return related albums grouped by reason: same_artist, genre_decade, audio_similar."""
    results = {"same_artist": [], "genre_decade": [], "audio_similar": []}

    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, "
                 "a.year, a.track_count, a.has_cover "
                 "FROM library_albums a LEFT JOIN library_artists ar ON ar.name = a.artist "
                 "WHERE a.artist = :artist AND a.id != :album_id ORDER BY a.year"),
            {"artist": artist, "album_id": album_id},
        ).mappings().all()
        results["same_artist"] = [dict(row) for row in rows]

        if genre_ids and year:
            year_int = int(year)
            rows = session.execute(
                text("""
                SELECT DISTINCT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                JOIN album_genres ag ON a.id = ag.album_id
                WHERE ag.genre_id = ANY(:genre_ids)
                AND a.artist != :artist
                AND a.year IS NOT NULL AND length(a.year) >= 4
                AND CAST(substring(a.year, 1, 4) AS INTEGER) BETWEEN :year_min AND :year_max
                ORDER BY RANDOM() LIMIT 10
                """),
                {"genre_ids": genre_ids, "artist": artist, "year_min": year_int - 5, "year_max": year_int + 5},
            ).mappings().all()
            results["genre_decade"] = [dict(row) for row in rows]

        audio = session.execute(
            text("""
            SELECT AVG(energy) AS e, AVG(danceability) AS d, AVG(valence) AS v
            FROM library_tracks WHERE album_id = :album_id AND energy IS NOT NULL
            """),
            {"album_id": album_id},
        ).mappings().first()
        if audio and audio["e"] is not None:
            rows = session.execute(
                text("""
                SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover,
                    ABS(AVG(t.energy) - :e) + ABS(AVG(t.danceability) - :d) + ABS(AVG(t.valence) - :v) AS dist
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                JOIN library_tracks t ON t.album_id = a.id
                WHERE t.energy IS NOT NULL AND a.id != :album_id AND a.artist != :artist
                GROUP BY a.id, a.slug, a.name, a.artist, ar.id, ar.slug, a.year, a.track_count, a.has_cover
                ORDER BY dist ASC LIMIT 8
                """),
                {"e": audio["e"], "d": audio["d"], "v": audio["v"], "album_id": album_id, "artist": artist},
            ).mappings().all()
            results["audio_similar"] = [dict(row) for row in rows]

    return results


def get_album_genres_list(album_id: int) -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT g.name FROM album_genres ag JOIN genres g ON ag.genre_id = g.id "
                 "WHERE ag.album_id = :album_id ORDER BY ag.weight DESC"),
            {"album_id": album_id},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_album_genre_profile(album_id: int, limit: int = 8) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
                SELECT g.name, g.slug, ag.weight, ag.source
                FROM album_genres ag
                JOIN genres g ON ag.genre_id = g.id
                WHERE ag.album_id = :album_id
                ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                LIMIT :limit
            """),
            {"album_id": album_id, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


import re as _re

_YEAR_PREFIX_RE = _re.compile(r"^\d{4}\s*[-–]\s*")


def _display_name(folder_name: str) -> str:
    return _YEAR_PREFIX_RE.sub("", folder_name)


def find_album_row(artist: str, album: str) -> dict | None:
    """Find album in DB, handling year-prefixed names, clean names, and case differences."""

    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(:artist) AND LOWER(name) = LOWER(:album) LIMIT 1"),
            {"artist": artist, "album": album},
        ).mappings().first()
        if row:
            return dict(row)

        row = session.execute(
            text("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(:artist) AND name ILIKE :album_pattern LIMIT 1"),
            {"artist": artist, "album_pattern": f"% - {album}"},
        ).mappings().first()
        if row:
            return dict(row)

        rows = session.execute(
            text("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(:artist)"),
            {"artist": artist},
        ).mappings().all()
        for row in rows:
            if _display_name(row["name"]) == album:
                return dict(row)
    return None
