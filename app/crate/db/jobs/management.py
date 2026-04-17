"""DB functions for management worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def find_album_path(artist_name: str, album_name: str, escape_like_fn) -> str | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT path FROM library_albums WHERE artist = :artist AND name = :name LIMIT 1"),
            {"artist": artist_name, "name": album_name},
        ).mappings().first()
        if not row:
            row = session.execute(
                text("SELECT path FROM library_albums WHERE artist = :artist AND name LIKE :pattern ESCAPE '\\' LIMIT 1"),
                {"artist": artist_name, "pattern": escape_like_fn(album_name)},
            ).mappings().first()
        return row["path"] if row else None


def rename_artist_in_db(old_name: str, new_name: str, old_folder: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET name = :new_name, folder_name = :new_name WHERE name = :old_name"),
            {"new_name": new_name, "old_name": old_name},
        )
        session.execute(text("UPDATE library_albums SET artist = :new WHERE artist = :old"),
                        {"new": new_name, "old": old_name})
        session.execute(text("UPDATE library_tracks SET artist = :new WHERE artist = :old"),
                        {"new": new_name, "old": old_name})
        albums = session.execute(
            text("SELECT id, path FROM library_albums WHERE artist = :artist"),
            {"artist": new_name},
        ).mappings().all()
        for row in albums:
            old_path = row["path"]
            new_path = old_path.replace(f"/{old_folder}/", f"/{new_name}/", 1)
            session.execute(text("UPDATE library_albums SET path = :path WHERE id = :id"),
                            {"path": new_path, "id": row["id"]})
        tracks = session.execute(
            text("SELECT id, path FROM library_tracks WHERE artist = :artist"),
            {"artist": new_name},
        ).mappings().all()
        for row in tracks:
            old_path = row["path"]
            new_path = old_path.replace(f"/{old_folder}/", f"/{new_name}/", 1)
            session.execute(text("UPDATE library_tracks SET path = :path WHERE id = :id"),
                            {"path": new_path, "id": row["id"]})


def find_album_path_for_match(artist_name: str, album_name: str, album_db_path: str, escape_like_fn) -> str:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT path FROM library_albums WHERE path = :path"),
            {"path": album_db_path},
        ).mappings().first()
        if not row:
            row = session.execute(
                text("SELECT path FROM library_albums WHERE artist = :artist AND (name = :name OR name LIKE :pattern ESCAPE '\\') LIMIT 1"),
                {"artist": artist_name, "name": album_name, "pattern": escape_like_fn(album_name)},
            ).mappings().first()
        return row["path"] if row else album_db_path


def apply_mbid_to_album(mbid: str, album_db_path: str, release_group_id: str | None) -> int | None:
    with transaction_scope() as session:
        album_row = session.execute(
            text("UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE path = :path RETURNING id"),
            {"mbid": mbid, "path": album_db_path},
        ).mappings().first()
        if release_group_id:
            session.execute(
                text("UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE path = :path"),
                {"rgid": release_group_id, "path": album_db_path},
            )
        if album_row:
            session.execute(
                text("UPDATE library_tracks SET musicbrainz_albumid = :mbid "
                     "WHERE album_id = :album_id AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')"),
                {"mbid": mbid, "album_id": album_row["id"]},
            )
            return album_row["id"]
        return None
