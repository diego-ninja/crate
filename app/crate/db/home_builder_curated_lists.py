from __future__ import annotations

from crate.db.home_builder_discovery import _build_artist_core_rows
from crate.db.home_builder_shared import _artwork_artists, _artwork_tracks


def _build_radio_stations(top_artists: list[dict], top_albums: list[dict], limit: int) -> list[dict]:
    radio_stations: list[dict] = []
    seen: set[tuple[str, object]] = set()

    for row in top_artists:
        artist_id = row.get("artist_id")
        if artist_id is None:
            continue
        key = ("artist", artist_id)
        if key in seen:
            continue
        seen.add(key)
        radio_stations.append(
            {
                "type": "artist",
                "artist_id": artist_id,
                "artist_slug": row.get("artist_slug"),
                "artist_name": row.get("artist_name") or "",
                "title": f"{row.get('artist_name') or ''} Radio",
                "subtitle": "Based on your heavy rotation",
                "play_count": row.get("play_count") or 0,
            }
        )
        if len(radio_stations) >= limit:
            return radio_stations

    for row in top_albums:
        album_id = row.get("album_id")
        if album_id is None:
            continue
        key = ("album", album_id)
        if key in seen:
            continue
        seen.add(key)
        radio_stations.append(
            {
                "type": "album",
                "album_id": album_id,
                "album_slug": row.get("album_slug"),
                "album_name": row.get("album") or "",
                "artist_name": row.get("artist") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "title": f"{row.get('album') or ''} Radio",
                "subtitle": "Seeded from an album you keep coming back to",
                "play_count": row.get("play_count") or 0,
            }
        )
        if len(radio_stations) >= limit:
            break

    return radio_stations


def _build_favorite_artists(top_artists: list[dict], limit: int) -> list[dict]:
    return [
        {
            "artist_id": row.get("artist_id"),
            "artist_slug": row.get("artist_slug"),
            "artist_name": row.get("artist_name") or "",
            "play_count": row.get("play_count") or 0,
            "minutes_listened": row.get("minutes_listened") or 0,
        }
        for row in top_artists[:limit]
        if row.get("artist_id") is not None
    ]


def _build_core_playlists(user_id: int, top_artists: list[dict], limit: int, track_limit: int = 8) -> list[dict]:
    essentials: list[dict] = []
    for row in top_artists:
        artist_id = row.get("artist_id")
        artist_name = row.get("artist_name") or ""
        if artist_id is None or not artist_name:
            continue
        rows = _build_artist_core_rows(
            user_id,
            artist_id=artist_id,
            artist_name=artist_name,
            limit=track_limit,
        )
        if not rows:
            continue
        essentials.append(
            {
                "id": f"core-tracks-artist-{artist_id}",
                "name": artist_name,
                "description": f"The defining tracks from {artist_name}.",
                "artwork_tracks": _artwork_tracks(rows),
                "artwork_artists": _artwork_artists(rows),
                "track_count": len(rows),
                "badge": "Core Tracks",
                "kind": "core",
            }
        )
        if len(essentials) >= limit:
            break
    return essentials


__all__ = [
    "_build_core_playlists",
    "_build_favorite_artists",
    "_build_radio_stations",
]
