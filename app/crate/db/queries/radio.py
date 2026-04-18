from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_track_path_by_id(track_id: int) -> str | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
    return row["path"] if row else None


def get_track_path_by_pattern(path: str, escaped_path: str) -> str | None:
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT path
            FROM library_tracks
            WHERE path = :path OR path LIKE :path_like ESCAPE '\\'
            ORDER BY CASE WHEN path = :path THEN 0 ELSE 1 END, path ASC
            LIMIT 1
            """),
            {"path": path, "path_like": f"%{escaped_path}"},
        ).mappings().first()
    return row["path"] if row else None


def get_album_for_radio(album_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT artist, name FROM library_albums WHERE id = :album_id"), {"album_id": album_id}).mappings().first()
    return dict(row) if row else None


def get_playlist_for_radio(playlist_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id, name, scope, user_id, is_active FROM playlists WHERE id = :playlist_id"), {"playlist_id": playlist_id}).mappings().first()
    return dict(row) if row else None
