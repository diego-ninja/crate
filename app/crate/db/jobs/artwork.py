"""DB functions for artwork worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def set_artist_has_photo(artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET has_photo = 1, updated_at = NOW() WHERE name = :name"),
            {"name": artist_name},
        )


def touch_artist_artwork(artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET updated_at = NOW() WHERE name = :name"),
            {"name": artist_name},
        )


def set_album_has_cover(album_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET has_cover = 1, updated_at = NOW() WHERE id = :id"),
            {"id": album_id},
        )
