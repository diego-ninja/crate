"""Catalog and entity lookup helpers for the library repository."""

from __future__ import annotations

from crate.db.repositories.library_album_reads import (
    get_library_album,
    get_library_album_by_entity_uid,
    get_library_album_by_id,
    get_library_albums,
)
from crate.db.repositories.library_artist_reads import (
    get_library_artist,
    get_library_artist_by_entity_uid,
    get_library_artist_by_id,
    get_library_artist_by_slug,
    get_library_artists,
)
from crate.db.repositories.library_release_reads import get_release_by_id
from crate.db.repositories.library_track_reads import (
    get_library_track_by_entity_uid,
    get_library_track_by_id,
    get_library_track_by_path,
    get_library_tracks,
    get_library_tracks_by_entity_uids,
)


__all__ = [
    "get_library_album",
    "get_library_album_by_entity_uid",
    "get_library_album_by_id",
    "get_library_albums",
    "get_library_artist",
    "get_library_artist_by_entity_uid",
    "get_library_artist_by_id",
    "get_library_artist_by_slug",
    "get_library_artists",
    "get_library_track_by_entity_uid",
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_tracks",
    "get_library_tracks_by_entity_uids",
    "get_release_by_id",
]
