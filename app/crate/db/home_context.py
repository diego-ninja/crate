from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.home_cache import _get_or_compute_home_cache
from crate.db.queries.home import get_followed_artist_genre_names
from crate.db.releases import get_new_releases
from crate.db.tx import read_scope
from crate.genre_taxonomy import choose_mix_seed_genres, summarize_taste_genres


def _genre_stat_rows_from_names(names: list[str]) -> list[dict]:
    return [
        {
            "genre_name": name,
            "play_count": 1,
            "complete_play_count": 0,
            "minutes_listened": 0,
        }
        for name in names
        if (name or "").strip()
    ]


def _derive_home_genres(top_genres: list[dict], fallback_names: list[str], limit: int) -> tuple[list[str], list[dict]]:
    genre_rows = [dict(row) for row in top_genres if row.get("genre_name")]
    taste_genres = summarize_taste_genres(genre_rows, limit=limit)
    mix_seed_genres = choose_mix_seed_genres(genre_rows, limit=limit)
    if taste_genres or mix_seed_genres:
        return taste_genres, mix_seed_genres

    fallback_rows = _genre_stat_rows_from_names(fallback_names)
    return (
        summarize_taste_genres(fallback_rows, limit=limit),
        choose_mix_seed_genres(fallback_rows, limit=limit),
    )


def _coerce_json_rows(value) -> list[dict]:
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(loaded, list):
            return [dict(item) for item in loaded if isinstance(item, dict)]
    return []


def _load_home_context_rows(
    user_id: int,
    *,
    top_artist_limit: int,
    top_album_limit: int,
    top_genre_limit: int,
) -> dict[str, list[dict]]:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                WITH followed AS (
                    SELECT
                        uf.artist_name,
                        uf.created_at,
                        la.id AS artist_id,
                        la.entity_uid::text AS artist_entity_uid,
                        la.slug AS artist_slug,
                        la.album_count,
                        la.track_count,
                        la.has_photo
                    FROM user_follows uf
                    LEFT JOIN library_artists la ON la.name = uf.artist_name
                    WHERE uf.user_id = :user_id
                    ORDER BY uf.created_at DESC
                ),
                saved_albums AS (
                    SELECT
                        usa.created_at AS saved_at,
                        la.id,
                        la.entity_uid::text AS album_entity_uid,
                        la.slug,
                        la.artist,
                        art.id AS artist_id,
                        art.entity_uid::text AS artist_entity_uid,
                        art.slug AS artist_slug,
                        la.name,
                        la.year,
                        la.has_cover,
                        la.track_count,
                        la.total_duration
                    FROM user_saved_albums usa
                    JOIN library_albums la ON la.id = usa.album_id
                    LEFT JOIN library_artists art ON art.name = la.artist
                    WHERE usa.user_id = :user_id
                    ORDER BY usa.created_at DESC
                ),
                top_artists AS (
                    SELECT
                        uas.artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        uas.play_count,
                        uas.complete_play_count,
                        uas.minutes_listened,
                        uas.first_played_at,
                        uas.last_played_at
                    FROM user_artist_stats uas
                    LEFT JOIN library_artists la ON la.name = uas.artist_name
                    WHERE uas.user_id = :user_id AND uas.stat_window = '90d'
                    ORDER BY uas.play_count DESC, uas.minutes_listened DESC, uas.last_played_at DESC
                    LIMIT :top_artist_limit
                ),
                top_albums AS (
                    SELECT
                        uas.artist,
                        art.id AS artist_id,
                        art.slug AS artist_slug,
                        uas.album,
                        alb.id AS album_id,
                        alb.slug AS album_slug,
                        uas.play_count,
                        uas.complete_play_count,
                        uas.minutes_listened,
                        uas.first_played_at,
                        uas.last_played_at
                    FROM user_album_stats uas
                    LEFT JOIN library_albums alb ON alb.artist = uas.artist AND alb.name = uas.album
                    LEFT JOIN library_artists art ON art.name = uas.artist
                    WHERE uas.user_id = :user_id AND uas.stat_window = '90d'
                    ORDER BY uas.play_count DESC, uas.minutes_listened DESC, uas.last_played_at DESC
                    LIMIT :top_album_limit
                ),
                top_genres AS (
                    SELECT
                        genre_name,
                        play_count,
                        complete_play_count,
                        minutes_listened,
                        first_played_at,
                        last_played_at
                    FROM user_genre_stats
                    WHERE user_id = :user_id AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
                    LIMIT :top_genre_limit
                )
                SELECT
                    COALESCE((SELECT jsonb_agg(to_jsonb(followed) ORDER BY followed.created_at DESC) FROM followed), '[]'::jsonb) AS followed,
                    COALESCE((SELECT jsonb_agg(to_jsonb(saved_albums) ORDER BY saved_albums.saved_at DESC) FROM saved_albums), '[]'::jsonb) AS saved_albums,
                    COALESCE((SELECT jsonb_agg(to_jsonb(top_artists) ORDER BY top_artists.play_count DESC, top_artists.minutes_listened DESC, top_artists.last_played_at DESC) FROM top_artists), '[]'::jsonb) AS top_artists,
                    COALESCE((SELECT jsonb_agg(to_jsonb(top_albums) ORDER BY top_albums.play_count DESC, top_albums.minutes_listened DESC, top_albums.last_played_at DESC) FROM top_albums), '[]'::jsonb) AS top_albums,
                    COALESCE((SELECT jsonb_agg(to_jsonb(top_genres) ORDER BY top_genres.play_count DESC, top_genres.minutes_listened DESC, top_genres.last_played_at DESC) FROM top_genres), '[]'::jsonb) AS top_genres
                """
            ),
            {
                "user_id": user_id,
                "top_artist_limit": top_artist_limit,
                "top_album_limit": top_album_limit,
                "top_genre_limit": top_genre_limit,
            },
        ).mappings().first()

    data = dict(row or {})
    return {
        "followed": _coerce_json_rows(data.get("followed")),
        "saved_albums": _coerce_json_rows(data.get("saved_albums")),
        "top_artists": _coerce_json_rows(data.get("top_artists")),
        "top_albums": _coerce_json_rows(data.get("top_albums")),
        "top_genres": _coerce_json_rows(data.get("top_genres")),
    }


def get_home_context(
    user_id: int,
    *,
    top_artist_limit: int = 28,
    top_album_limit: int = 12,
    top_genre_limit: int = 8,
) -> dict:
    rows = _load_home_context_rows(
        user_id,
        top_artist_limit=top_artist_limit,
        top_album_limit=top_album_limit,
        top_genre_limit=top_genre_limit,
    )
    followed = rows["followed"]
    saved_albums = rows["saved_albums"]
    top_artists = rows["top_artists"]
    top_albums = rows["top_albums"]
    top_genres = rows["top_genres"]

    followed_names_lower = [(row.get("artist_name") or "").lower() for row in followed if row.get("artist_name")]
    top_artist_names_lower = [(row.get("artist_name") or "").lower() for row in top_artists if row.get("artist_name")]
    interest_artists_lower = list(dict.fromkeys(top_artist_names_lower + followed_names_lower))
    saved_album_ids = list({row["id"] for row in saved_albums if row.get("id") is not None})
    top_genres_lower, mix_seed_genres = _derive_home_genres(top_genres, [], top_genre_limit)
    if not top_genres_lower and not mix_seed_genres and followed_names_lower:
        fallback_genre_names = get_followed_artist_genre_names(followed_names_lower, top_genre_limit)
        top_genres_lower, mix_seed_genres = _derive_home_genres(top_genres, fallback_genre_names, top_genre_limit)

    return {
        "followed": followed,
        "saved_albums": saved_albums,
        "top_artists": top_artists,
        "top_albums": top_albums,
        "top_genres": top_genres,
        "followed_names_lower": followed_names_lower,
        "top_artist_names_lower": top_artist_names_lower,
        "top_genres_lower": top_genres_lower,
        "mix_seed_genres": mix_seed_genres,
        "interest_artists_lower": interest_artists_lower,
        "saved_album_ids": saved_album_ids,
    }


def get_cached_home_context(
    user_id: int,
    *,
    top_artist_limit: int = 28,
    top_album_limit: int = 12,
    top_genre_limit: int = 8,
) -> dict:
    cache_key = f"home:context:{user_id}:{top_artist_limit}:{top_album_limit}:{top_genre_limit}"
    return _get_or_compute_home_cache(
        cache_key,
        max_age_seconds=600,
        ttl=600,
        compute=lambda: get_home_context(
            user_id,
            top_artist_limit=top_artist_limit,
            top_album_limit=top_album_limit,
            top_genre_limit=top_genre_limit,
        ),
    )


_NEW_RELEASES_CACHE_TTL_SECONDS = 600


def _cached_new_releases(limit: int = 250) -> list[dict]:
    cache_key = f"home:new-releases:v1:{limit}"
    try:
        from crate.db.cache_store import get_cache, set_cache

        cached = get_cache(cache_key, max_age_seconds=_NEW_RELEASES_CACHE_TTL_SECONDS)
        if isinstance(cached, list):
            return cached
        rows = get_new_releases(limit=limit)
        set_cache(cache_key, rows, ttl=_NEW_RELEASES_CACHE_TTL_SECONDS)
        return rows
    except Exception:
        return get_new_releases(limit=limit)


def merged_artists_from_context(context: dict) -> list[dict]:
    top_artists = context["top_artists"]
    followed = context["followed"]
    seen_artist_ids = {row.get("artist_id") for row in top_artists if row.get("artist_id") is not None}
    merged = list(top_artists)
    for row in followed:
        aid = row.get("artist_id")
        if aid is not None and aid not in seen_artist_ids:
            merged.append(
                {
                    "artist_id": aid,
                    "artist_slug": row.get("artist_slug"),
                    "artist_name": row.get("artist_name") or "",
                    "play_count": 0,
                    "minutes_listened": 0,
                }
            )
            seen_artist_ids.add(aid)
    return merged


def recent_releases_from_context(context: dict, *, days: int = 240) -> list[dict]:
    from crate.db.home_builders import _filter_interesting_releases

    return _filter_interesting_releases(
        _cached_new_releases(limit=250),
        interest_artists_lower=set(context["interest_artists_lower"]),
        saved_album_ids=set(context["saved_album_ids"]),
        days=days,
    )
