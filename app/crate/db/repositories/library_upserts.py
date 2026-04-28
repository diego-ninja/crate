"""Compatibility facade for library upsert helpers."""

from __future__ import annotations

from crate.db.repositories.library_analysis_writes import update_track_analysis
from crate.db.repositories.library_entity_upserts import upsert_album, upsert_artist, upsert_track
from crate.db.repositories.library_processing_state import ensure_track_processing_rows


__all__ = [
    "ensure_track_processing_rows",
    "update_track_analysis",
    "upsert_album",
    "upsert_artist",
    "upsert_track",
]
