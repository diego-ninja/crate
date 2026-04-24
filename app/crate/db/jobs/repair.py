from uuid import uuid4

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
    if not old_name:
        return
    with transaction_scope() as session:
        existing = session.execute(
            text("SELECT 1 FROM library_artists WHERE name = :name"),
            {"name": old_name},
        ).mappings().first()
        if not existing:
            return

        if old_name == new_name:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET folder_name = COALESCE(NULLIF(:folder, ''), folder_name)
                    WHERE name = :name
                    """
                ),
                {"folder": folder_name, "name": old_name},
            )
            return

        target = session.execute(
            text("SELECT 1 FROM library_artists WHERE name = :name"),
            {"name": new_name},
        ).mappings().first()
        temp_name = f"__crate_tmp__{uuid4().hex}"

        session.execute(
            text(
                """
                INSERT INTO library_artists (name, storage_id, folder_name)
                VALUES (:name, :storage_id, :folder_name)
                """
            ),
            {"name": temp_name, "storage_id": str(uuid4()), "folder_name": folder_name or None},
        )
        session.execute(
            text("UPDATE library_albums SET artist = :temp_name WHERE artist = :old_name"),
            {"temp_name": temp_name, "old_name": old_name},
        )
        session.execute(
            text("UPDATE artist_genres SET artist_name = :temp_name WHERE artist_name = :old_name"),
            {"temp_name": temp_name, "old_name": old_name},
        )

        if target:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET folder_name = COALESCE(NULLIF(folder_name, ''), NULLIF(:folder, ''), folder_name)
                    WHERE name = :name
                    """
                ),
                {"folder": folder_name, "name": new_name},
            )
            session.execute(
                text(
                    """
                    INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                    SELECT :new_name, genre_id, weight, source
                    FROM artist_genres
                    WHERE artist_name = :temp_name
                    ON CONFLICT (artist_name, genre_id) DO UPDATE
                    SET weight = GREATEST(artist_genres.weight, EXCLUDED.weight)
                    """
                ),
                {"new_name": new_name, "temp_name": temp_name},
            )
            session.execute(
                text("DELETE FROM artist_genres WHERE artist_name = :temp_name"),
                {"temp_name": temp_name},
            )
            session.execute(
                text("UPDATE library_albums SET artist = :new_name WHERE artist = :temp_name"),
                {"new_name": new_name, "temp_name": temp_name},
            )
            session.execute(
                text("DELETE FROM library_artists WHERE name = :old_name"),
                {"old_name": old_name},
            )
        else:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET name = :new_name,
                        folder_name = COALESCE(NULLIF(:folder, ''), folder_name)
                    WHERE name = :old_name
                    """
                ),
                {"new_name": new_name, "folder": folder_name, "old_name": old_name},
            )
            session.execute(
                text("UPDATE library_albums SET artist = :new_name WHERE artist = :temp_name"),
                {"new_name": new_name, "temp_name": temp_name},
            )
            session.execute(
                text("UPDATE artist_genres SET artist_name = :new_name WHERE artist_name = :temp_name"),
                {"new_name": new_name, "temp_name": temp_name},
            )

        session.execute(
            text("DELETE FROM library_artists WHERE name = :temp_name"),
            {"temp_name": temp_name},
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
