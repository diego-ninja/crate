"""DB functions for storage V2 migration worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_artist_album_paths(artist_name: str, limit: int = 5) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT path FROM library_albums WHERE artist = :artist LIMIT :lim"),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_album_tracks(album_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, storage_id, path, filename FROM library_tracks WHERE album_id = :album_id"),
            {"album_id": album_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_track_path(track_id: int, new_path: str, new_filename: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET path = :path, filename = :filename WHERE id = :id"),
            {"path": new_path, "filename": new_filename, "id": track_id},
        )


def update_album_path(album_id: int, new_path: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET path = :path WHERE id = :id"),
            {"path": new_path, "id": album_id},
        )


def get_artist_albums_ordered(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, storage_id, path, name FROM library_albums WHERE artist = :artist ORDER BY name"),
            {"artist": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_artist_folder_name(artist_name: str, folder_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET folder_name = :folder WHERE name = :name"),
            {"folder": folder_name, "name": artist_name},
        )


def get_all_artists_for_migration(single_artist: str | None = None) -> list[dict]:
    with transaction_scope() as session:
        if single_artist:
            rows = session.execute(
                text("SELECT id, name, storage_id, folder_name FROM library_artists WHERE name = :name"),
                {"name": single_artist},
            ).mappings().all()
        else:
            rows = session.execute(
                text("SELECT id, name, storage_id, folder_name FROM library_artists ORDER BY name")
            ).mappings().all()
        return [dict(row) for row in rows]


def get_all_tracks_for_verification() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, path, storage_id, artist, title FROM library_tracks")
        ).mappings().all()
        return [dict(row) for row in rows]
