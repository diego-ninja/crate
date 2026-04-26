from __future__ import annotations

from crate.db.home_builders import (
    _build_core_playlists,
    _build_custom_mix_summaries,
    _build_home_upcoming,
    _build_mix_rows,
    _build_radio_stations,
    _build_recommended_tracks,
    _build_recent_global_artists,
    _build_suggested_albums,
    _get_home_hero,
    _track_payload,
)
from crate.db.home_context import (
    get_cached_home_context,
    merged_artists_from_context,
    recent_releases_from_context,
)
from crate.db.home_personalized_collections import (
    get_home_favorite_artists,
    get_home_recently_played,
)
from crate.db.queries.user_library import get_replay_mix


def get_home_section(user_id: int, section_id: str, limit: int = 42) -> dict | None:
    context = get_cached_home_context(
        user_id,
        top_artist_limit=max(limit * 2, 28),
        top_album_limit=max(limit, 12),
        top_genre_limit=max(limit, 8),
    )
    top_artists = context["top_artists"]
    top_albums = context["top_albums"]
    top_genres_lower = context["top_genres_lower"]
    mix_seed_genres = context["mix_seed_genres"]
    interest_artists_lower = context["interest_artists_lower"]
    recent_releases = recent_releases_from_context(context)

    if section_id == "recently-played":
        return {
            "id": section_id,
            "title": "Recently played",
            "subtitle": "Albums, artists and playlists you touched most recently.",
            "items": get_home_recently_played(user_id),
        }

    if section_id == "custom-mixes":
        return {
            "id": section_id,
            "title": "Custom mixes",
            "subtitle": "Dynamic playlists shaped around your own listening profile.",
            "items": _build_custom_mix_summaries(
                user_id,
                mix_seed_genres=mix_seed_genres,
                interest_artists_lower=interest_artists_lower,
                top_genres_lower=top_genres_lower,
                mix_count=limit,
                recent_releases=recent_releases,
            ),
        }

    if section_id == "suggested-albums":
        return {
            "id": section_id,
            "title": "Suggested new albums for you",
            "subtitle": "Recent releases from the artists you already care about.",
            "items": _build_suggested_albums(recent_releases, limit),
        }

    if section_id == "recommended-tracks":
        rows = _build_recommended_tracks(
            user_id,
            recent_releases=recent_releases,
            interest_artists_lower=interest_artists_lower,
            limit=limit,
        )
        return {
            "id": section_id,
            "title": "Recommended new tracks",
            "subtitle": "Fresh cuts from artists and albums that line up with your taste.",
            "items": [_track_payload(row) for row in rows],
        }

    if section_id == "radio-stations":
        return {
            "id": section_id,
            "title": "Radio stations",
            "subtitle": "Artist and album radios seeded from the things you replay the most.",
            "items": _build_radio_stations(top_artists, top_albums, limit),
        }

    if section_id == "favorite-artists":
        return {
            "id": section_id,
            "title": "Favorite artists",
            "subtitle": "Your most played names over the last few months.",
            "items": get_home_favorite_artists(user_id),
        }

    if section_id == "core-tracks":
        return {
            "id": section_id,
            "title": "Core tracks",
            "subtitle": "Artist-focused sets built from the names most present in your listening.",
            "items": _build_core_playlists(user_id, top_artists, min(limit, 6)),
        }

    return None


def build_home_discovery_payload(user_id: int) -> dict:
    context = get_cached_home_context(user_id, top_artist_limit=28, top_album_limit=12, top_genre_limit=8)
    top_albums = context["top_albums"]
    followed_names_lower = context["followed_names_lower"]
    top_artist_names_lower = context["top_artist_names_lower"]
    top_genres_lower = context["top_genres_lower"]
    mix_seed_genres = context["mix_seed_genres"]
    interest_artists_lower = context["interest_artists_lower"]

    hero = _get_home_hero(user_id, followed_names_lower, top_artist_names_lower[:8], top_genres_lower[:4])
    recent_releases = recent_releases_from_context(context)

    precomputed_mixes: dict[str, tuple[str, str, list[dict]]] = {}
    my_new_arrivals_mix = _build_mix_rows(
        user_id,
        interest_artists_lower=interest_artists_lower,
        top_genres_lower=top_genres_lower,
        mix_id="my-new-arrivals",
        limit=18,
        recent_releases=recent_releases,
    )
    if my_new_arrivals_mix[0] and my_new_arrivals_mix[2]:
        precomputed_mixes["my-new-arrivals"] = my_new_arrivals_mix

    suggested_albums = _build_suggested_albums(recent_releases, 14)
    recommended_tracks = _build_recommended_tracks(
        user_id,
        recent_releases=recent_releases,
        interest_artists_lower=interest_artists_lower,
        limit=18,
        fallback_tracks=precomputed_mixes.get("my-new-arrivals", ("", "", []))[2],
    )
    custom_mixes = _build_custom_mix_summaries(
        user_id,
        mix_seed_genres=mix_seed_genres,
        interest_artists_lower=interest_artists_lower,
        top_genres_lower=top_genres_lower,
        mix_count=8,
        recent_releases=recent_releases,
        precomputed_mixes=precomputed_mixes,
    )
    merged_artists = merged_artists_from_context(context)

    return {
        "hero": hero,
        "recently_played": get_home_recently_played(user_id),
        "custom_mixes": custom_mixes,
        "suggested_albums": suggested_albums,
        "recommended_tracks": [_track_payload(row) for row in recommended_tracks],
        "radio_stations": _build_radio_stations(merged_artists, top_albums, 14),
        "favorite_artists": get_home_favorite_artists(user_id),
        "essentials": _build_core_playlists(user_id, merged_artists, 6),
        "recent_global_artists": _build_recent_global_artists(10),
        "replay": get_replay_mix(user_id, window="30d", limit=18),
        "upcoming": _build_home_upcoming(user_id, limit=120),
    }


__all__ = [
    "build_home_discovery_payload",
    "get_home_section",
]
