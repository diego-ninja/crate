"""DB functions for artwork worker handlers."""

from crate.db.core import get_db_ctx


def set_artist_has_photo(artist_name: str) -> None:
    with get_db_ctx() as cur:
        cur.execute("UPDATE library_artists SET has_photo = 1 WHERE name = %s", (artist_name,))


def set_album_has_cover(album_id: int) -> None:
    with get_db_ctx() as cur:
        cur.execute("UPDATE library_albums SET has_cover = 1 WHERE id = %s", (album_id,))
