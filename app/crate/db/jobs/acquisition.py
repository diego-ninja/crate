"""DB functions for acquisition worker handlers."""

from crate.db.core import get_db_ctx


def update_artist_latest_release_date(artist_name: str, release_date: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
            (release_date, artist_name),
        )
