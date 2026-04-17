"""Database queries for the Subsonic API endpoints."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_user_by_username(username: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM users WHERE username = :username"), {"username": username}).mappings().first()
        return dict(row) if row else None


def get_all_artists_sorted() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT id, name, album_count, COALESCE(listeners, 0) as listeners
            FROM library_artists
            ORDER BY name
        """)).mappings().all()
        return [dict(r) for r in rows]


def get_artist_by_id(artist_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id, name FROM library_artists WHERE id = :artist_id"), {"artist_id": artist_id}).mappings().first()
        return dict(row) if row else None


def get_albums_by_artist_name(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT id, name, year, track_count, has_cover,
                   COALESCE(total_duration, 0) as duration
            FROM library_albums
            WHERE artist = :artist_name
            ORDER BY year DESC NULLS LAST, name
        """), {"artist_name": artist_name}).mappings().all()
        return [dict(r) for r in rows]


def get_album_with_artist(album_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                   COALESCE(a.total_duration, 0) as duration,
                   ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.id = :album_id
        """), {"album_id": album_id}).mappings().first()
        return dict(row) if row else None


def get_tracks_by_album_id(album_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT id, title, artist, album, path, duration,
                   COALESCE(track_number, 0) as track,
                   COALESCE(disc_number, 1) as disc,
                   format, bitrate, sample_rate
            FROM library_tracks
            WHERE album_id = :album_id
            ORDER BY disc_number, track_number
        """), {"album_id": album_id}).mappings().all()
        return [dict(r) for r in rows]


def get_track_full(track_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT t.id, t.title, t.artist, t.album, t.path, t.duration,
                   t.track_number, t.disc_number, t.format, t.bitrate,
                   a.id as album_id, a.has_cover, a.year,
                   ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.id = :track_id
        """), {"track_id": track_id}).mappings().first()
        return dict(row) if row else None


def get_album_list(order: str, size: int, offset: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text(f"""
            SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                   COALESCE(a.total_duration, 0) as duration,
                   ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            ORDER BY {order}
            LIMIT :size OFFSET :offset
        """), {"size": size, "offset": offset}).mappings().all()
        return [dict(r) for r in rows]


def search_artists(query: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("SELECT id, name FROM library_artists WHERE name ILIKE :query LIMIT :limit"), {"query": query, "limit": limit}).mappings().all()
        return [dict(r) for r in rows]


def search_albums(query: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT a.id, a.name, a.artist, a.year, a.has_cover, ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.name ILIKE :query
            LIMIT :limit
        """), {"query": query, "limit": limit}).mappings().all()
        return [dict(r) for r in rows]


def search_tracks(query: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                   t.format, t.bitrate, a.id as album_id, a.has_cover, ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.title ILIKE :query OR t.artist ILIKE :query
            LIMIT :limit
        """), {"query": query, "limit": limit}).mappings().all()
        return [dict(r) for r in rows]


def get_track_path_and_format(track_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT path, format FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return dict(row) if row else None


def get_track_basic(track_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT title, artist, album FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return dict(row) if row else None


def get_random_tracks(size: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                   t.format, t.bitrate, t.track_number, t.disc_number,
                   a.id as album_id, a.has_cover, a.year, ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            ORDER BY RANDOM()
            LIMIT :size
        """), {"size": size}).mappings().all()
        return [dict(r) for r in rows]
