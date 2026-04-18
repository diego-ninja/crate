"""DB functions for acquisition worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def update_artist_latest_release_date(artist_name: str, release_date: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET latest_release_date = :date WHERE name = :name"),
            {"date": release_date, "name": artist_name},
        )
