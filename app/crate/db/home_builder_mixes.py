from __future__ import annotations

from crate.db.home_builder_discovery import (
    _build_artist_core_rows,
    _fallback_recent_interest_tracks,
    _filter_interesting_releases,
    _query_discovery_tracks,
    _track_candidates_for_album_ids,
)
from crate.db.home_builder_shared import (
    _artwork_artists,
    _artwork_tracks,
    _merge_track_rows,
    _select_diverse_tracks_with_backfill,
)
from crate.db.releases import get_new_releases
from crate.genre_taxonomy import get_genre_display_name, get_related_genre_terms


def _build_mix_rows(
    user_id: int,
    *,
    interest_artists_lower: list[str],
    top_genres_lower: list[str],
    mix_id: str,
    limit: int,
    recent_releases: list[dict] | None = None,
) -> tuple[str, str, list[dict]]:
    if mix_id == "daily-discovery":
        primary_rows = _query_discovery_tracks(
            user_id,
            genres=top_genres_lower[:3],
            excluded_artist_names=interest_artists_lower[:12] or [""],
            limit=max(limit * 5, 120),
        )
        primary_rows = [row for row in primary_rows if not row.get("user_play_count") and not row.get("is_liked")]
        fallback_rows: list[dict] = []
        if len(primary_rows) < limit:
            fallback_rows = _query_discovery_tracks(
                user_id,
                genres=top_genres_lower[:3],
                excluded_artist_names=[],
                limit=max(limit * 6, 160),
            )
            fallback_rows = [
                row for row in fallback_rows if not row.get("is_liked") and int(row.get("user_play_count") or 0) <= 1
            ]
        rows = _merge_track_rows(primary_rows, fallback_rows)
        return (
            "Daily Discovery",
            "Fresh tracks orbiting around your favorite scenes.",
            _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=2, max_per_album=2),
        )

    if mix_id == "my-new-arrivals":
        releases = recent_releases if recent_releases is not None else _filter_interesting_releases(
            get_new_releases(limit=250),
            interest_artists_lower=set(interest_artists_lower),
            saved_album_ids=set(),
            days=180,
        )
        album_ids = [row["album_id"] for row in releases if row.get("album_id")][:40]
        primary_rows = _track_candidates_for_album_ids(user_id, album_ids, limit=max(limit * 5, 120))
        primary_rows = [row for row in primary_rows if not row.get("is_liked")]
        fallback_rows: list[dict] = []
        if len(primary_rows) < limit:
            fallback_candidates = _fallback_recent_interest_tracks(
                user_id,
                interest_artists_lower[:18] or [""],
                limit=max(limit * 6, 160),
            )
            fallback_rows = [
                row for row in fallback_candidates if not row.get("is_liked") and int(row.get("user_play_count") or 0) <= 2
            ]
            if len(fallback_rows) < limit:
                fallback_rows = _merge_track_rows(
                    fallback_rows,
                    [row for row in fallback_candidates if not row.get("is_liked")],
                )
            if len(fallback_rows) < limit:
                fallback_rows = _merge_track_rows(fallback_rows, fallback_candidates)
        rows = _merge_track_rows(primary_rows, fallback_rows)
        return (
            "My New Arrivals",
            "Recent material from the artists already in your orbit.",
            _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=2, max_per_album=2),
        )

    if mix_id.startswith("genre-"):
        genre_slug = mix_id.removeprefix("genre-")
        genre_name = get_genre_display_name(genre_slug)
        related_genres = get_related_genre_terms(genre_slug, limit=12, max_depth=1)
        if not related_genres:
            return ("", "", [])
        rows = _query_discovery_tracks(
            user_id,
            genres=related_genres,
            excluded_artist_names=[],
            limit=max(limit * 6, 180),
        )
        return (
            f"{genre_name} mix",
            f"Tracks from your library matching {genre_name} and closely related scenes.",
            _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=2, max_per_album=2),
        )

    return ("", "", [])


def _mix_summary_payload(mix: dict) -> dict:
    return {
        "id": mix["id"],
        "name": mix["name"],
        "description": mix["description"],
        "artwork_tracks": mix["artwork_tracks"],
        "artwork_artists": mix.get("artwork_artists", []),
        "track_count": mix["track_count"],
        "badge": mix["badge"],
        "kind": mix["kind"],
    }


def _build_custom_mix_summaries(
    user_id: int,
    *,
    mix_seed_genres: list[dict],
    interest_artists_lower: list[str],
    top_genres_lower: list[str],
    mix_count: int,
    summary_track_limit: int = 8,
    recent_releases: list[dict] | None = None,
    precomputed_mixes: dict[str, tuple[str, str, list[dict]]] | None = None,
) -> list[dict]:
    custom_mix_ids = ["daily-discovery", "my-new-arrivals"]
    custom_mix_ids.extend(
        [
            f"genre-{item['slug']}"
            for item in mix_seed_genres[: max(mix_count - 2, 0)]
            if item.get("slug")
        ]
    )
    mixes: list[dict] = []
    for mix_id in dict.fromkeys(custom_mix_ids):
        precomputed = (precomputed_mixes or {}).get(mix_id)
        if precomputed is not None:
            name, description, rows = precomputed
        else:
            name, description, rows = _build_mix_rows(
                user_id,
                interest_artists_lower=interest_artists_lower,
                top_genres_lower=top_genres_lower,
                mix_id=mix_id,
                limit=summary_track_limit,
                recent_releases=recent_releases,
            )
        if not name or not rows:
            continue
        mixes.append(
            {
                "id": mix_id,
                "name": name,
                "description": description,
                "artwork_tracks": _artwork_tracks(rows),
                "artwork_artists": _artwork_artists(rows),
                "track_count": len(rows),
                "badge": "Mix",
                "kind": "mix",
            }
        )
        if len(mixes) >= mix_count:
            break
    return mixes


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
    "_build_custom_mix_summaries",
    "_build_favorite_artists",
    "_build_mix_rows",
    "_build_radio_stations",
    "_mix_summary_payload",
]
