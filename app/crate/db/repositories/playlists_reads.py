"""Compatibility facade for playlist read helpers."""

from __future__ import annotations

from crate.db.repositories.playlists_collection_reads import (
    get_followed_system_playlists,
    get_playlist,
    get_playlist_followers_count,
    get_playlists,
    get_smart_playlists_for_refresh,
    is_playlist_followed,
    list_system_playlists,
)
from crate.db.repositories.playlists_detail_reads import (
    get_generation_history,
    get_playlist_filter_options,
    get_playlist_tracks,
)
from crate.db.repositories.playlists_membership_reads import (
    can_edit_playlist,
    can_view_playlist,
    get_playlist_member,
    get_playlist_members,
    is_playlist_owner,
)


__all__ = [
    "can_edit_playlist",
    "can_view_playlist",
    "get_followed_system_playlists",
    "get_generation_history",
    "get_playlist",
    "get_playlist_filter_options",
    "get_playlist_followers_count",
    "get_playlist_member",
    "get_playlist_members",
    "get_playlist_tracks",
    "get_playlists",
    "get_smart_playlists_for_refresh",
    "is_playlist_followed",
    "is_playlist_owner",
    "list_system_playlists",
]
