from __future__ import annotations

from crate.db.home_builder_shared import _album_identity, _artist_identity, _select_diverse_tracks_with_backfill
from crate.db.queries.home import get_artist_core_track_rows, get_library_artist_by_id, get_recent_playlist_rows_with_artwork
from crate.db.queries.user_library import get_play_history


def build_recently_played(user_id: int, limit: int = 9) -> list[dict]:
    target_per_bucket = max(3, (limit + 2) // 3)
    history = get_play_history(user_id, limit=max(limit * 6, 48))

    recent_artists: list[dict] = []
    recent_albums: list[dict] = []
    seen_artists: set[object] = set()
    seen_albums: set[object] = set()

    for row in history:
        artist_key = _artist_identity(row)
        if artist_key and artist_key not in seen_artists:
            seen_artists.add(artist_key)
            recent_artists.append(
                {
                    "type": "artist",
                    "artist_id": row.get("artist_id"),
                    "artist_slug": row.get("artist_slug"),
                    "artist_name": row.get("artist") or "",
                    "subtitle": "Artist",
                    "played_at": row.get("played_at"),
                }
            )
        album_key = _album_identity(row)
        if row.get("album") and album_key not in seen_albums:
            seen_albums.add(album_key)
            recent_albums.append(
                {
                    "type": "album",
                    "album_id": row.get("album_id"),
                    "album_slug": row.get("album_slug"),
                    "album_name": row.get("album") or "",
                    "artist_name": row.get("artist") or "",
                    "artist_id": row.get("artist_id"),
                    "artist_slug": row.get("artist_slug"),
                    "subtitle": "Album",
                    "played_at": row.get("played_at"),
                }
            )
        if len(recent_artists) >= target_per_bucket and len(recent_albums) >= target_per_bucket:
            break

    recent_playlists = get_recent_playlist_rows_with_artwork(user_id, target_per_bucket)

    items: list[dict] = []
    for index in range(target_per_bucket):
        if index < len(recent_playlists):
            items.append(recent_playlists[index])
        if index < len(recent_artists):
            items.append(recent_artists[index])
        if index < len(recent_albums):
            items.append(recent_albums[index])
    return items[:limit]


def build_artist_core_rows(
    user_id: int,
    *,
    artist_id: int,
    artist_name: str,
    limit: int,
) -> list[dict]:
    rows = get_artist_core_track_rows(artist_id=artist_id, artist_name=artist_name, limit=limit)
    return _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=limit, max_per_album=2)


def get_library_artist(artist_id: int) -> dict | None:
    return get_library_artist_by_id(artist_id)


__all__ = [
    "build_artist_core_rows",
    "build_recently_played",
    "get_library_artist",
]
