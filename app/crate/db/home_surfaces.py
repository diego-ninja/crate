from __future__ import annotations

from crate.db.home_builders import (
    _artwork_artists,
    _artwork_tracks,
    _build_artist_core_rows,
    _build_core_playlists,
    _build_custom_mix_summaries,
    _build_favorite_artists,
    _build_home_upcoming,
    _build_mix_rows,
    _build_radio_stations,
    _build_recommended_tracks,
    _build_recent_global_artists,
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
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.db.queries.user_library import get_replay_mix


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


def get_cached_home_discovery(user_id: int, *, fresh: bool = False) -> dict:
    return get_or_build_ui_snapshot(
        scope="home:discovery",
        subject_key=str(user_id),
        max_age_seconds=600,
        fresh=fresh,
        allow_stale_on_error=True,
        stale_max_age_seconds=3600,
        build=lambda: get_home_discovery(user_id),
    )


def get_home_discovery(user_id: int) -> dict:
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
        "recently_played": _build_recently_played(user_id, limit=18),
        "custom_mixes": custom_mixes,
        "suggested_albums": suggested_albums,
        "recommended_tracks": [_track_payload(row) for row in recommended_tracks],
        "radio_stations": _build_radio_stations(merged_artists, top_albums, 14),
        "favorite_artists": _build_favorite_artists(merged_artists, 14),
        "essentials": _build_core_playlists(user_id, merged_artists, 6),
        "recent_global_artists": _build_recent_global_artists(10),
        "replay": get_replay_mix(user_id, window="30d", limit=18),
        "upcoming": _build_home_upcoming(user_id, limit=120),
    }


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
            "items": _build_recently_played(user_id, limit=limit),
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
            "items": _build_favorite_artists(top_artists, limit),
        }

    if section_id == "core-tracks":
        return {
            "id": section_id,
            "title": "Core tracks",
            "subtitle": "Artist-focused sets built from the names most present in your listening.",
            "items": _build_core_playlists(user_id, top_artists, min(limit, 6)),
        }

    return None
