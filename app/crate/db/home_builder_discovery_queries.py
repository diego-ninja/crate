from __future__ import annotations

from collections.abc import Mapping

from crate.artist_hero_artwork import (
    ARTIST_HERO_RENDER_VERSION,
    DESKTOP_HERO_SIZE,
    MOBILE_HERO_SIZE,
    get_artist_hero_artwork_bounds,
)
from crate.artist_hero_contract import artist_hero_recipe_hash
from crate.db.home_builder_shared import _trim_bio
from crate.db.home_hero_scoring import (
    HOME_HERO_SCORE_VERSION,
    score_home_hero_rows,
    select_home_hero_rows,
    strip_home_hero_score,
)
from crate.db.home_debug import record_home_hero_debug
from crate.db.queries.home import (
    get_artist_genre_profiles_map,
    get_discovery_track_rows,
    get_home_hero_rows,
    get_recent_interest_track_rows,
    get_track_candidates_for_album_ids,
)
from crate.genre_taxonomy import expand_genre_terms_with_aliases
from crate.utils import coerce_int

HOME_JUST_LANDED_VERSION = "home_just_landed_v2"
HOME_HERO_CANDIDATE_LIMIT = 32
HOME_HERO_SELECTED_LIMIT = 8
_CANONICAL_SURFACES = ("desktop", "mobile")


def _dedupe_home_hero_rows(rows: list[dict]) -> list[dict]:
    seen_names: set[str] = set()
    deduped: list[dict] = []
    for row in rows:
        name = " ".join(str(row.get("name") or "").split()).casefold()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        deduped.append(row)
    return deduped


def _hero_source_dimensions(
    item: Mapping[str, object], composition: str
) -> tuple[object, object]:
    width = item.get(f"_hero_{composition}_source_width")
    height = item.get(f"_hero_{composition}_source_height")
    has_composition_dimensions = any(
        item.get(f"_hero_{candidate}_source_width") is not None
        or item.get(f"_hero_{candidate}_source_height") is not None
        for candidate in _CANONICAL_SURFACES
    )
    if has_composition_dimensions:
        return width, height
    return item.get("_hero_source_width"), item.get("_hero_source_height")


def _add_hero_artwork_bounds(item: dict) -> None:
    generic_width = item.pop("_hero_source_width", None)
    generic_height = item.pop("_hero_source_height", None)
    has_composition_dimensions = any(
        item.get(f"_hero_{candidate}_source_width") is not None
        or item.get(f"_hero_{candidate}_source_height") is not None
        for candidate in _CANONICAL_SURFACES
    )
    compositions: dict[str, dict] = {}
    for composition, output_size in (
        ("desktop", DESKTOP_HERO_SIZE),
        ("mobile", MOBILE_HERO_SIZE),
    ):
        width = item.pop(f"_hero_{composition}_source_width", None)
        height = item.pop(f"_hero_{composition}_source_height", None)
        if not has_composition_dimensions:
            width = width or generic_width
            height = height or generic_height
        recipe = item.pop(f"_hero_{composition}_recipe", None)
        if item.get(f"_hero_{composition}_enabled", True) is False:
            continue
        if not width or not height or not isinstance(recipe, Mapping):
            continue
        bounds = get_artist_hero_artwork_bounds(
            (coerce_int(width), coerce_int(height)), recipe, output_size
        )
        item[f"{composition}_artwork_bounds"] = bounds
        if item.get("artwork_revision"):
            compositions[composition] = {
                "schema_version": 1,
                "composition": composition,
                "render_revision": str(item["artwork_revision"]),
                "recipe_hash": artist_hero_recipe_hash(recipe),
                "width": output_size[0],
                "height": output_size[1],
                "bounds": bounds,
                "asset_path": (
                    f"/api/artists/{int(item['id'])}/hero?composition={composition}"
                    f"&size={output_size[0]}&v={item['artwork_revision']}"
                ),
            }
    if compositions:
        item["hero_compositions"] = compositions


def _canonical_surface_ready(item: Mapping[str, object], composition: str) -> bool:
    """Return whether a profile can safely use the canonical Home surface."""

    if item.get("is_featured") is not True:
        return False
    if item.get("_hero_provenance") != "manual":
        return False
    if item.get("_hero_review_status") != "approved":
        return False
    if item.get(f"_hero_{composition}_enabled", True) is False:
        return False
    if not str(item.get("artwork_revision") or "").startswith(
        f"{ARTIST_HERO_RENDER_VERSION}:"
    ):
        return False

    width, height = _hero_source_dimensions(item, composition)
    recipe = item.get(f"_hero_{composition}_recipe")
    return bool(
        width
        and height
        and coerce_int(width) > 0
        and coerce_int(height) > 0
        and isinstance(recipe, Mapping)
    )


def _rank_home_hero_rows(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> tuple[list[dict], dict[str, list[dict]]] | None:
    rows = get_home_hero_rows(
        user_id=user_id,
        followed_names_lower=followed_names_lower,
        similar_target_names_lower=similar_target_names_lower,
        top_genres_lower=top_genres_lower,
        limit=HOME_HERO_CANDIDATE_LIMIT,
    )
    if not rows:
        record_home_hero_debug(
            {
                "selection_version": HOME_JUST_LANDED_VERSION,
                "score_version": HOME_HERO_SCORE_VERSION,
                "candidate_pool_size": 0,
                "selected_count": 0,
                "candidates": [],
            }
        )
        return None

    personalized = any(
        row.get("is_followed")
        or row.get("similar_hits")
        or row.get("genre_hits")
        or row.get("user_play_count")
        or row.get("recent_exposure_count")
        for row in rows
    )
    ranked_rows = score_home_hero_rows(rows) if personalized else rows
    ranked_rows = _dedupe_home_hero_rows(ranked_rows)
    selected_rows = ranked_rows[:HOME_HERO_SELECTED_LIMIT]

    record_home_hero_debug(
        {
            "selection_version": HOME_JUST_LANDED_VERSION,
            "score_version": HOME_HERO_SCORE_VERSION,
            "candidate_pool_size": len(ranked_rows),
            "selected_count": len(selected_rows),
            "personalized": personalized,
            "candidates": [
                {
                    "name": row.get("name"),
                    "slug": row.get("slug"),
                    "first_added_sort": row.get("first_added_sort"),
                    "artwork_provenance": row.get("artwork_provenance", "fallback"),
                    "score": row.get("score"),
                    "score_contributions": row.get("score_contributions", []),
                }
                for row in ranked_rows
            ],
        }
    )

    surface_rows = {
        composition: select_home_hero_rows(
            [row for row in ranked_rows if _canonical_surface_ready(row, composition)],
            user_id=user_id,
            limit=HOME_HERO_SELECTED_LIMIT,
        )
        for composition in _CANONICAL_SURFACES
    }
    source_rows = list(selected_rows)
    for rows_for_surface in surface_rows.values():
        source_rows.extend(rows_for_surface)
    source_rows = _dedupe_home_hero_rows(source_rows)

    artist_names = [row["name"] for row in source_rows]
    genre_profile_map = get_artist_genre_profiles_map(artist_names, limit=4)

    public_by_name: dict[str, dict] = {}
    for source_item in source_rows:
        item = dict(source_item)
        _add_hero_artwork_bounds(item)
        item["bio"] = _trim_bio(item.get("bio") or "")
        genre_profile = genre_profile_map.get(item["name"], [])
        item["genres"] = [genre["name"] for genre in genre_profile]
        item["genre_profile"] = genre_profile
        item.setdefault("artwork_provenance", "fallback")
        for key in (
            "_hero_provenance",
            "_hero_review_status",
            "_hero_desktop_enabled",
            "_hero_mobile_enabled",
        ):
            item.pop(key, None)
        public_by_name[str(source_item["name"])] = strip_home_hero_score(item)

    hero = [public_by_name[str(row["name"])] for row in selected_rows]
    public_surfaces = {
        composition: [public_by_name[str(row["name"])] for row in rows_for_surface]
        for composition, rows_for_surface in surface_rows.items()
    }
    return hero, public_surfaces


def get_home_hero_bundle(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> dict | None:
    ranked = _rank_home_hero_rows(
        user_id,
        followed_names_lower,
        similar_target_names_lower,
        top_genres_lower,
    )
    if ranked is None:
        return None

    hero, surface_artists = ranked
    surfaces = {}
    for composition in _CANONICAL_SURFACES:
        artists = surface_artists[composition]
        surfaces[composition] = {
            "mode": "canonical" if artists else "legacy",
            "artists": artists or hero,
        }

    return {"hero": hero, "hero_surfaces": surfaces}


def get_home_hero(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> list[dict] | None:
    bundle = get_home_hero_bundle(
        user_id,
        followed_names_lower,
        similar_target_names_lower,
        top_genres_lower,
    )
    if bundle is None:
        return None

    return bundle["hero"]


def track_candidates_for_album_ids(
    user_id: int, album_ids: list[int], limit: int = 240
) -> list[dict]:
    return get_track_candidates_for_album_ids(
        user_id=user_id, album_ids=album_ids, limit=limit
    )


def query_discovery_tracks(
    user_id: int,
    *,
    genres: list[str],
    excluded_artist_names: list[str],
    limit: int = 240,
) -> list[dict]:
    if not genres:
        return []
    genres = expand_genre_terms_with_aliases(genres)
    return get_discovery_track_rows(
        user_id=user_id,
        genres=genres,
        excluded_artist_names=excluded_artist_names,
        limit=limit,
    )


def fallback_recent_interest_tracks(
    user_id: int, interest_artists_lower: list[str], limit: int = 240
) -> list[dict]:
    return get_recent_interest_track_rows(
        user_id=user_id, interest_artists_lower=interest_artists_lower, limit=limit
    )


__all__ = [
    "fallback_recent_interest_tracks",
    "get_home_hero",
    "get_home_hero_bundle",
    "query_discovery_tracks",
    "track_candidates_for_album_ids",
]
