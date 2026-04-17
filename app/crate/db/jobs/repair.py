from crate.db.tx import transaction_scope
from sqlalchemy import text


def find_artist_canonical(artist_name: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT name FROM library_artists WHERE LOWER(name) = LOWER(:artist) LIMIT 1"),
            {"artist": artist_name},
        ).mappings().first()
    return dict(row) if row else None


def reassign_album_artist(album_path: str, artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET artist = :artist WHERE path = :path"),
            {"artist": artist_name, "path": album_path},
        )


def update_artist_has_photo(artist_name: str, has_photo: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET has_photo = :photo WHERE name = :name"),
            {"photo": has_photo, "name": artist_name},
        )


def rename_artist(old_name: str, new_name: str, folder_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET name = :new_name, folder_name = :folder WHERE name = :old_name"),
            {"new_name": new_name, "folder": folder_name, "old_name": old_name},
        )
        session.execute(
            text("UPDATE library_albums SET artist = :new_name WHERE artist = :old_name"),
            {"new_name": new_name, "old_name": old_name},
        )
        session.execute(
            text("UPDATE library_tracks SET artist = :new_name WHERE artist = :old_name"),
            {"new_name": new_name, "old_name": old_name},
        )


def find_canonical_artist_by_folder(folder_name: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT name FROM library_artists "
                 "WHERE folder_name = :folder OR LOWER(name) = LOWER(:name) LIMIT 1"),
            {"folder": folder_name, "name": folder_name},
        ).mappings().first()
    return dict(row) if row else None


def count_artist_tracks(artist_name: str) -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) AS c FROM library_tracks t "
                 "JOIN library_albums a ON t.album_id = a.id WHERE a.artist = :artist"),
            {"artist": artist_name},
        ).mappings().first()
    return int(row["c"]) if row else 0


def update_track_artist(track_path: str, artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET artist = :artist WHERE path = :path"),
            {"artist": artist_name, "path": track_path},
        )


def update_album_path_and_name(old_path: str, new_path: str, album_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"),
            {"name": album_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text("UPDATE library_tracks SET path = REPLACE(path, :old_prefix, :new_prefix) WHERE path LIKE :pattern"),
            {"old_prefix": old_path + "/", "new_prefix": new_path + "/", "pattern": old_path + "/%"},
        )


def merge_album_folder(old_path: str, new_path: str, album_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"),
            {"name": album_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text("UPDATE library_tracks SET path = REPLACE(path, :old_prefix, :new_prefix) WHERE path LIKE :pattern"),
            {"old_prefix": old_path + "/", "new_prefix": new_path + "/", "pattern": old_path + "/%"},
        )
        session.execute(
            text("DELETE FROM library_albums WHERE path = :old_path AND EXISTS "
                 "(SELECT 1 FROM library_albums WHERE path = :new_path)"),
            {"old_path": old_path, "new_path": new_path},
        )
