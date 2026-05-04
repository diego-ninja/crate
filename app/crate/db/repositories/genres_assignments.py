import re

from sqlalchemy import text

from crate.db.repositories.entity_identity_keys import upsert_entity_identity_key
from crate.db.tx import transaction_scope
from crate.entity_ids import genre_entity_uid
from crate.genre_taxonomy import slugify_genre


def _slugify(name: str) -> str:
    return slugify_genre(name)


def get_or_create_genre(name: str, *, session=None) -> int:
    name = name.strip().lower()
    slug = _slugify(name)
    if not slug:
        return -1
    if session is None:
        with transaction_scope() as s:
            return get_or_create_genre(name, session=s)
    row = session.execute(
        text("SELECT id FROM genres WHERE slug = :slug"),
        {"slug": slug},
    ).mappings().first()
    if row:
        return row["id"]
    row = session.execute(
        text(
            """
            INSERT INTO genres (entity_uid, name, slug)
            VALUES (:entity_uid, :name, :slug)
            ON CONFLICT(slug) DO UPDATE
            SET entity_uid = COALESCE(genres.entity_uid, EXCLUDED.entity_uid),
                name = EXCLUDED.name
            RETURNING id
            """
        ),
        {"entity_uid": str(genre_entity_uid(name=name, slug=slug)), "name": name, "slug": slug},
    ).mappings().first()
    if row:
        upsert_entity_identity_key(session, entity_type="genre", entity_uid=str(genre_entity_uid(name=name, slug=slug)), key_type="slug", key_value=slug, is_primary=True)
        upsert_entity_identity_key(session, entity_type="genre", entity_uid=str(genre_entity_uid(name=name, slug=slug)), key_type="name", key_value=name, is_primary=True)
    return row["id"]


def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]], *, session=None):
    if session is None:
        with transaction_scope() as s:
            return set_artist_genres(artist_name, genres, session=s)
    session.execute(
        text("DELETE FROM artist_genres WHERE artist_name = :artist_name"),
        {"artist_name": artist_name},
    )
    for name, weight, source in genres:
        genre_id = get_or_create_genre(name, session=session)
        if genre_id < 0:
            continue
        session.execute(
            text(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (:artist_name, :genre_id, :weight, :source) "
                "ON CONFLICT DO NOTHING"
            ),
            {"artist_name": artist_name, "genre_id": genre_id, "weight": weight, "source": source},
        )


def set_album_genres(album_id: int, genres: list[tuple[str, float, str]], *, session=None):
    if session is None:
        with transaction_scope() as s:
            return set_album_genres(album_id, genres, session=s)
    session.execute(
        text("DELETE FROM album_genres WHERE album_id = :album_id"),
        {"album_id": album_id},
    )
    for name, weight, source in genres:
        genre_id = get_or_create_genre(name, session=session)
        if genre_id < 0:
            continue
        session.execute(
            text(
                "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (:album_id, :genre_id, :weight, :source) "
                "ON CONFLICT DO NOTHING"
            ),
            {"album_id": album_id, "genre_id": genre_id, "weight": weight, "source": source},
        )


__all__ = [
    "get_or_create_genre",
    "set_album_genres",
    "set_artist_genres",
]
