"""Compatibility facade for library write helpers."""

from __future__ import annotations

from crate.db.repositories.library_enrichment_writes import (
    delete_album,
    delete_artist,
    delete_track,
    set_track_rating,
    update_artist_enrichment,
    update_artist_has_photo,
)
from crate.db.repositories.library_quarantine import delete_quarantined_album, quarantine_album, unquarantine_album
from crate.db.repositories.library_upserts import (
    update_track_analysis,
    upsert_album,
    upsert_artist,
    upsert_track,
)

__all__ = [
    "delete_album",
    "delete_artist",
    "delete_quarantined_album",
    "delete_track",
    "quarantine_album",
    "set_track_rating",
    "unquarantine_album",
    "update_artist_enrichment",
    "update_artist_has_photo",
    "update_track_analysis",
    "upsert_album",
    "upsert_artist",
    "upsert_track",
]
