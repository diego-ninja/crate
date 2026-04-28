from sqlalchemy import text

from crate.db.tx import transaction_scope


def reassign_album_artist(album_path: str, artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET artist = :artist WHERE path = :path"),
            {"artist": artist_name, "path": album_path},
        )


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
            text(
                "DELETE FROM library_albums WHERE path = :old_path AND EXISTS "
                "(SELECT 1 FROM library_albums WHERE path = :new_path)"
            ),
            {"old_path": old_path, "new_path": new_path},
        )


__all__ = [
    "merge_album_folder",
    "reassign_album_artist",
    "update_album_path_and_name",
    "update_track_artist",
]
