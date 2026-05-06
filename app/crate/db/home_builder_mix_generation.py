from __future__ import annotations

from crate.db.home_builder_discovery import (
    _fallback_recent_interest_tracks,
    _filter_interesting_releases,
    _query_discovery_tracks,
    _track_candidates_for_album_ids,
)
from crate.db.home_builder_shared import (
    _artwork_artists,
    _artwork_tracks,
    _daily_rotation_index,
    _merge_track_rows,
    _select_diverse_tracks_with_backfill,
)
from crate.db.releases import get_new_releases
from crate.genre_taxonomy import get_genre_display_name, get_related_genre_terms


def _daily_rotate_rows(rows: list[dict], user_id: int) -> list[dict]:
    if len(rows) <= 1:
        return rows
    offset = _daily_rotation_index(len(rows), user_id)
    return rows[offset:] + rows[:offset]


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
            _select_diverse_tracks_with_backfill(
                _daily_rotate_rows(rows, user_id),
                limit=limit,
                max_per_artist=2,
                max_per_album=2,
            ),
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


__all__ = [
    "_daily_rotate_rows",
    "_build_custom_mix_summaries",
    "_build_mix_rows",
    "_mix_summary_payload",
]
