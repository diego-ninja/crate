"""DB functions for storage V2 migration worker handlers."""

from crate.db.core import get_db_ctx


def get_artist_album_paths(artist_name: str, limit: int = 5) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT path FROM library_albums WHERE artist = %s LIMIT %s",
            (artist_name, limit),
        )
        return cur.fetchall()


def get_album_tracks(album_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id, storage_id, path, filename FROM library_tracks WHERE album_id = %s",
            (album_id,),
        )
        return cur.fetchall()


def update_track_path(track_id: int, new_path: str, new_filename: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET path = %s, filename = %s WHERE id = %s",
            (new_path, new_filename, track_id),
        )


def update_album_path(album_id: int, new_path: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET path = %s WHERE id = %s",
            (new_path, album_id),
        )


def get_artist_albums_ordered(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id, storage_id, path, name FROM library_albums WHERE artist = %s ORDER BY name",
            (artist_name,),
        )
        return cur.fetchall()


def update_artist_folder_name(artist_name: str, folder_name: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_artists SET folder_name = %s WHERE name = %s",
            (folder_name, artist_name),
        )


def get_all_artists_for_migration(single_artist: str | None = None) -> list[dict]:
    with get_db_ctx() as cur:
        if single_artist:
            cur.execute(
                "SELECT id, name, storage_id, folder_name FROM library_artists WHERE name = %s",
                (single_artist,),
            )
        else:
            cur.execute(
                "SELECT id, name, storage_id, folder_name FROM library_artists ORDER BY name"
            )
        return cur.fetchall()


def get_all_tracks_for_verification() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("SELECT id, path, storage_id, artist, title FROM library_tracks")
        return cur.fetchall()
