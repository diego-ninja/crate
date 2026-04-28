"""Compatibility facade for read-side library repository helpers."""

from __future__ import annotations

from crate.db.repositories.library_catalog_reads import (
    get_library_album,
    get_library_album_by_id,
    get_library_albums,
    get_library_artist,
    get_library_artist_by_id,
    get_library_artist_by_slug,
    get_library_artists,
    get_library_track_by_id,
    get_library_track_by_path,
    get_library_track_by_storage_id,
    get_library_tracks,
    get_library_tracks_by_storage_ids,
    get_release_by_id,
)
from crate.db.repositories.library_reference_reads import (
    enrich_track_refs,
    find_user_playlist_by_name,
    get_artist_analysis_tracks,
    get_artist_refs_by_names,
    get_artist_tracks_for_setlist,
)
from crate.db.repositories.library_stats_reads import (
    get_album_quality_map,
    get_albums_missing_covers,
    get_library_stats,
    get_library_track_count,
    get_track_path_by_id,
    get_track_rating,
)

__all__ = [
    "enrich_track_refs",
    "find_user_playlist_by_name",
    "get_album_quality_map",
    "get_albums_missing_covers",
    "get_artist_analysis_tracks",
    "get_artist_refs_by_names",
    "get_artist_tracks_for_setlist",
    "get_library_album",
    "get_library_album_by_id",
    "get_library_albums",
    "get_library_artist",
    "get_library_artist_by_id",
    "get_library_artist_by_slug",
    "get_library_artists",
    "get_library_stats",
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_track_by_storage_id",
    "get_library_track_count",
    "get_library_tracks",
    "get_library_tracks_by_storage_ids",
    "get_release_by_id",
    "get_track_path_by_id",
    "get_track_rating",
]
