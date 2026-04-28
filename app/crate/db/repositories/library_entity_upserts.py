"""Entity upsert helpers for the library repository."""

from __future__ import annotations

from crate.db.repositories.library_album_upserts import upsert_album
from crate.db.repositories.library_artist_upserts import upsert_artist
from crate.db.repositories.library_track_upserts import upsert_track


__all__ = [
    "upsert_album",
    "upsert_artist",
    "upsert_track",
]
