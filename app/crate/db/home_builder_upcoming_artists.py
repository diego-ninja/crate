from __future__ import annotations

from crate.db.queries.home import get_recent_global_artist_rows


def _build_recent_global_artists(limit: int = 10) -> list[dict]:
    return [
        {
            "id": row.get("id"),
            "slug": row.get("slug"),
            "name": row.get("name"),
            "album_count": row.get("album_count"),
            "track_count": row.get("track_count"),
            "has_photo": bool(row.get("has_photo")),
        }
        for row in get_recent_global_artist_rows(limit)
        if row.get("name")
    ]


__all__ = ["_build_recent_global_artists"]
