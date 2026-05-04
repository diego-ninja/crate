from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def search_artists(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, entity_uid::text AS entity_uid, slug, name, album_count, has_photo
                FROM library_artists
                WHERE name ILIKE :like
                ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        items: list[dict] = []
        for row in rows:
            item = dict(row)
            item["entity_uid"] = str(item["entity_uid"]) if item.get("entity_uid") is not None else None
            items.append(item)
        return items


def search_albums(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.year, a.has_cover,
                       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.name ILIKE :like OR a.artist ILIKE :like
                ORDER BY year DESC NULLS LAST, name ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        items: list[dict] = []
        for row in rows:
            item = dict(row)
            item["entity_uid"] = str(item["entity_uid"]) if item.get("entity_uid") is not None else None
            item["artist_entity_uid"] = (
                str(item["artist_entity_uid"]) if item.get("artist_entity_uid") is not None else None
            )
            items.append(item)
        return items


def search_tracks(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id, t.entity_uid::text AS entity_uid, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                       a.entity_uid::text AS album_entity_uid, a.name AS album,
                       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
                       t.path, t.duration,
                       t.bpm, t.audio_key, t.audio_scale, t.energy,
                       t.danceability, t.valence, t.bliss_vector
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.title ILIKE :like OR t.artist ILIKE :like OR a.name ILIKE :like
                ORDER BY t.title ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        items: list[dict] = []
        for row in rows:
            item = dict(row)
            entity_uid = str(item["entity_uid"]) if item.get("entity_uid") is not None else None
            item["entity_uid"] = entity_uid
            item["album_entity_uid"] = str(item["album_entity_uid"]) if item.get("album_entity_uid") is not None else None
            item["artist_entity_uid"] = (
                str(item["artist_entity_uid"]) if item.get("artist_entity_uid") is not None else None
            )
            if item.get("bliss_vector") is not None:
                item["bliss_vector"] = list(item["bliss_vector"])
            items.append(item)
        return items


__all__ = [
    "search_albums",
    "search_artists",
    "search_tracks",
]
