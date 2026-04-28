"""Release lookup helpers for the library repository."""

from __future__ import annotations

from sqlalchemy.orm import Session

from crate.db.orm.releases import NewRelease
from crate.db.tx import read_scope


def get_release_by_id(release_id: int, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.get(NewRelease, release_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "artist_name": row.artist_name,
            "album_title": row.album_title,
            "tidal_id": row.tidal_id,
            "tidal_url": row.tidal_url,
            "cover_url": row.cover_url,
            "year": row.year,
            "tracks": row.tracks,
            "quality": row.quality,
            "status": row.status,
            "detected_at": row.detected_at,
            "downloaded_at": row.downloaded_at,
            "release_date": row.release_date,
            "release_type": row.release_type,
            "mb_release_group_id": row.mb_release_group_id,
        }

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = ["get_release_by_id"]
