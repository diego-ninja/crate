"""DB functions for management worker handlers."""

from crate.db.core import get_db_ctx


def find_album_path(artist_name: str, album_name: str, escape_like_fn) -> str | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT path FROM library_albums WHERE artist = %s AND name = %s LIMIT 1",
            (artist_name, album_name),
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                "SELECT path FROM library_albums WHERE artist = %s AND name LIKE %s ESCAPE '\\' LIMIT 1",
                (artist_name, escape_like_fn(album_name)),
            )
            row = cur.fetchone()
        return row["path"] if row else None


def rename_artist_in_db(old_name: str, new_name: str, old_folder: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_artists SET name = %s, folder_name = %s WHERE name = %s",
            (new_name, new_name, old_name),
        )
        cur.execute("UPDATE library_albums SET artist = %s WHERE artist = %s", (new_name, old_name))
        cur.execute("UPDATE library_tracks SET artist = %s WHERE artist = %s", (new_name, old_name))
        cur.execute("SELECT id, path FROM library_albums WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{old_folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_albums SET path = %s WHERE id = %s", (new_path, row["id"]))
        cur.execute("SELECT id, path FROM library_tracks WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{old_folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_tracks SET path = %s WHERE id = %s", (new_path, row["id"]))


def find_album_path_for_match(artist_name: str, album_name: str, album_db_path: str, escape_like_fn) -> str:
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_albums WHERE path = %s", (album_db_path,))
        row = cur.fetchone()
        if not row:
            cur.execute(
                "SELECT path FROM library_albums WHERE artist = %s AND (name = %s OR name LIKE %s ESCAPE '\\') LIMIT 1",
                (artist_name, album_name, escape_like_fn(album_name)),
            )
            row = cur.fetchone()
        return row["path"] if row else album_db_path


def apply_mbid_to_album(mbid: str, album_db_path: str, release_group_id: str | None) -> int | None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET musicbrainz_albumid = %s WHERE path = %s RETURNING id",
            (mbid, album_db_path),
        )
        album_row = cur.fetchone()
        if release_group_id:
            cur.execute(
                "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE path = %s",
                (release_group_id, album_db_path),
            )
        if album_row:
            cur.execute(
                "UPDATE library_tracks SET musicbrainz_albumid = %s "
                "WHERE album_id = %s AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')",
                (mbid, album_row["id"]),
            )
            return album_row["id"]
        return None
