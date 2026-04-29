from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_timeline_albums() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    a.id,
                    a.entity_uid::text AS entity_uid,
                    a.slug,
                    a.year,
                    a.artist,
                    ar.id AS artist_id,
                    ar.entity_uid::text AS artist_entity_uid,
                    ar.slug AS artist_slug,
                    a.name,
                    a.track_count
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.year IS NOT NULL AND a.year != ''
                ORDER BY a.year
                """
            )
        ).mappings().all()
        return [dict(row) for row in rows]


__all__ = ["get_timeline_albums"]
