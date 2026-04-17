from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_artists_with_folder() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, folder_name FROM library_artists WHERE folder_name IS NOT NULL")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_orphan_albums() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, artist, path FROM library_albums "
                 "WHERE artist NOT IN (SELECT name FROM library_artists)")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_orphan_tracks() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT path, album_id FROM library_tracks "
                 "WHERE album_id NOT IN (SELECT id FROM library_albums)")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_all_artists() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, folder_name FROM library_artists")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_all_albums() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, artist, path FROM library_albums")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_tracks_sample(total_threshold: int = 5000, modulo: int = 10) -> list[dict]:
    with transaction_scope() as session:
        total = session.execute(
            text("SELECT COUNT(*) AS cnt FROM library_tracks")
        ).mappings().first()["cnt"]
        if total < total_threshold:
            rows = session.execute(
                text("SELECT path, artist FROM library_tracks")
            ).mappings().all()
        else:
            rows = session.execute(
                text(f"SELECT path, artist FROM library_tracks WHERE MOD(id, {modulo}) = 0")
            ).mappings().all()
    return [dict(r) for r in rows]


def get_zombie_artists() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT la.name FROM library_artists la "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM library_albums alb "
                "  WHERE LOWER(alb.artist) = LOWER(la.name)"
                ") "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM library_tracks lt "
                "  WHERE LOWER(lt.artist) = LOWER(la.name)"
                ")"
            )
        ).mappings().all()
    return [dict(r) for r in rows]


def get_artists_with_photo() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, folder_name, has_photo FROM library_artists")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_duplicate_albums() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT artist, LOWER(name) AS album_key, MIN(name) AS album_name, COUNT(*) AS cnt "
                 "FROM library_albums GROUP BY artist, LOWER(name) HAVING COUNT(*) > 1")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_all_track_paths() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT path FROM library_tracks")
        ).mappings().all()
    return {r["path"] for r in rows}


def get_tracks_tag_sample(total_threshold: int = 5000, modulo: int = 20) -> list[dict]:
    with transaction_scope() as session:
        total = session.execute(
            text("SELECT COUNT(*) AS cnt FROM library_tracks")
        ).mappings().first()["cnt"]
        if total < total_threshold:
            rows = session.execute(
                text("SELECT path, artist FROM library_tracks")
            ).mappings().all()
        else:
            rows = session.execute(
                text(f"SELECT path, artist FROM library_tracks WHERE MOD(id, {modulo}) = 0")
            ).mappings().all()
    return [dict(r) for r in rows]


def get_albums_with_year() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, artist, year, path FROM library_albums "
                 "WHERE year IS NOT NULL AND year != '' AND length(year) >= 4")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_all_albums_for_covers() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT artist, name, path FROM library_albums")
        ).mappings().all()
    return [dict(r) for r in rows]
