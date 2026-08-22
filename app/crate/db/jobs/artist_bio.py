"""Bounded maintenance jobs for artist biography cleanup."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from crate.artist_bio import normalize_artist_bio
from crate.db.orm.library import LibraryArtist
from crate.db.repositories.field_locks import list_locked_fields
from crate.db.tx import transaction_scope


def normalize_artist_bios_batch(*, after_id: int = 0, limit: int = 100) -> dict:
    """Normalize one ordered batch without touching manually locked bios."""
    safe_limit = max(1, min(int(limit or 100), 500))
    cursor = max(0, int(after_id or 0))

    with transaction_scope() as session:
        artists = (
            session.execute(
                select(LibraryArtist)
                .where(
                    LibraryArtist.id.is_not(None),
                    LibraryArtist.id > cursor,
                    LibraryArtist.bio.is_not(None),
                    LibraryArtist.bio != "",
                )
                .order_by(LibraryArtist.id.asc())
                .limit(safe_limit)
            )
            .scalars()
            .all()
        )
        result = {
            "scanned": len(artists),
            "changed": 0,
            "already_clean": 0,
            "locked": 0,
            "empty_after_cleaning": 0,
            "last_id": cursor,
            "has_more": bool(artists),
        }
        for artist in artists:
            if artist.id is None:
                continue
            result["last_id"] = int(artist.id)
            if "bio" in list_locked_fields(
                entity_type="artist", entity_id=int(artist.id), session=session
            ):
                result["locked"] += 1
                continue
            normalized = normalize_artist_bio(artist.bio)
            if normalized == artist.bio:
                result["already_clean"] += 1
                continue
            artist.bio = normalized or None
            artist.updated_at = datetime.now(timezone.utc)
            result["changed"] += 1
            if not normalized:
                result["empty_after_cleaning"] += 1
        return result


__all__ = ["normalize_artist_bios_batch"]
