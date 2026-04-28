from __future__ import annotations

from crate.db.home_builders import (
    _artwork_artists,
    _artwork_tracks,
    _build_artist_core_rows,
    _build_core_playlists,
    _build_custom_mix_summaries,
    _build_favorite_artists,
    _build_mix_rows,
    _build_radio_stations,
    _build_recommended_tracks,
    _build_recently_played,
    _build_suggested_albums,
    _get_home_hero,
    _get_library_artist,
    _track_payload,
)
from crate.db.home_context import (
    get_cached_home_context,
    merged_artists_from_context,
    recent_releases_from_context,
)


def get_home_mix(user_id: int, mix_id: str, limit: int = 40) -> dict | None:
    context = get_cached_home_context(user_id, top_artist_limit=28, top_album_limit=12, top_genre_limit=8)
    recent_releases = recent_releases_from_context(context)

    name, description, rows = _build_mix_rows(
        user_id,
        interest_artists_lower=context["interest_artists_lower"],
        top_genres_lower=context["top_genres_lower"],
        mix_id=mix_id,
        limit=limit,
        recent_releases=recent_releases,
    )
    if not name or not rows:
        return None

    return {
        "id": mix_id,
        "name": name,
        "description": description,
        "artwork_tracks": _artwork_tracks(rows),
        "artwork_artists": _artwork_artists(rows),
        "track_count": len(rows),
        "total_duration": sum(int(row.get("duration") or 0) for row in rows),
        "badge": "Mix",
        "kind": "mix",
        "tracks": [_track_payload(row) for row in rows],
    }


def get_home_playlist(user_id: int, playlist_id: str, limit: int = 40) -> dict | None:
    mix = get_home_mix(user_id, playlist_id, limit=limit)
    if mix:
        return mix

    core_prefix = "core-tracks-artist-"
    if not playlist_id.startswith(core_prefix):
        return None

    try:
        artist_id = int(playlist_id.removeprefix(core_prefix))
    except ValueError:
        return None

    artist = _get_library_artist(artist_id)
    if not artist:
        return None

    rows = _build_artist_core_rows(user_id, artist_id=artist_id, artist_name=artist["name"], limit=limit)
    if not rows:
        return None

    return {
        "id": playlist_id,
        "name": artist["name"],
        "description": f"The defining tracks from {artist['name']}, shaped by what you keep coming back to.",
        "artwork_tracks": _artwork_tracks(rows),
        "artwork_artists": _artwork_artists(rows),
        "track_count": len(rows),
        "total_duration": sum(int(row.get("duration") or 0) for row in rows),
        "badge": "Core Tracks",
        "kind": "core",
        "tracks": [_track_payload(row) for row in rows],
    }


def get_home_hero(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _get_home_hero(user_id, ctx["followed_names_lower"], ctx["top_artist_names_lower"][:8], ctx["top_genres_lower"][:4])


def get_home_recently_played(user_id: int) -> list[dict]:
    return _build_recently_played(user_id, limit=18)


def get_home_mixes(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    recent_releases = recent_releases_from_context(ctx)
    return _build_custom_mix_summaries(
        user_id,
        mix_seed_genres=ctx["mix_seed_genres"],
        interest_artists_lower=ctx["interest_artists_lower"],
        top_genres_lower=ctx["top_genres_lower"],
        mix_count=8,
        recent_releases=recent_releases,
    )


def get_home_suggested_albums(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_suggested_albums(recent_releases_from_context(ctx), 14)


def get_home_recommended_tracks(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    rows = _build_recommended_tracks(
        user_id,
        recent_releases=recent_releases_from_context(ctx),
        interest_artists_lower=ctx["interest_artists_lower"],
        limit=18,
    )
    return [_track_payload(row) for row in rows]


def get_home_radio_stations(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_radio_stations(merged_artists_from_context(ctx), ctx["top_albums"], 14)


def get_home_favorite_artists(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_favorite_artists(merged_artists_from_context(ctx), 14)


def get_home_essentials(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_core_playlists(user_id, merged_artists_from_context(ctx), 6)


__all__ = [
    "get_home_essentials",
    "get_home_favorite_artists",
    "get_home_hero",
    "get_home_mix",
    "get_home_mixes",
    "get_home_playlist",
    "get_home_radio_stations",
    "get_home_recently_played",
    "get_home_recommended_tracks",
    "get_home_suggested_albums",
]
