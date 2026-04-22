from __future__ import annotations

import logging
import re
import secrets
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from threading import Event, Lock

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.db.releases import get_new_releases
from crate.db.user_library import (
    get_followed_artists,
    get_play_history,
    get_saved_albums,
    get_top_albums,
    get_top_artists,
    get_top_genres,
)
from crate.genre_taxonomy import (
    choose_mix_seed_genres,
    expand_genre_terms_with_aliases,
    get_genre_display_name,
    get_related_genre_terms,
    summarize_taste_genres,
)

log = logging.getLogger(__name__)

_home_cache_singleflight_guard = Lock()
_home_cache_singleflight_events: dict[str, Event] = {}


def _home_cache_scope(cache_key: str) -> str:
    parts = cache_key.split(":")
    return parts[1] if len(parts) > 1 else cache_key


def _record_home_metric(name: str, *, cache_key: str, value: float = 1.0):
    try:
        from crate.metrics import record, record_counter

        tags = {"scope": _home_cache_scope(cache_key)}
        if name.endswith(".ms"):
            record(name, value, tags)
        else:
            record_counter(name, tags)
    except Exception:
        return


def _coerce_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if not value:
        return None
    text_val = str(value).strip()
    if not text_val:
        return None
    try:
        if "T" in text_val:
            parsed = datetime.fromisoformat(text_val.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        parsed_date = date.fromisoformat(text_val)
        return datetime.combine(parsed_date, datetime.min.time(), tzinfo=timezone.utc)
    except ValueError:
        return None


def _trim_bio(value: str, max_length: int = 280) -> str:
    text_val = re.sub(r"\s+", " ", (value or "")).strip()
    if len(text_val) <= max_length:
        return text_val
    trimmed = text_val[:max_length].rsplit(" ", 1)[0].strip()
    return f"{trimmed}…"


def _daily_rotation_index(pool_size: int, user_id: int) -> int:
    if pool_size <= 1:
        return 0
    return (date.today().toordinal() + max(user_id, 0)) % pool_size


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


def _get_or_compute_home_cache(
    cache_key: str,
    *,
    max_age_seconds: int,
    ttl: int,
    compute: Callable[[], dict],
    fresh: bool = False,
    allow_stale_on_error: bool = False,
    stale_max_age_seconds: int | None = None,
    wait_timeout_seconds: float = 10.0,
) -> dict:
    from crate.db.cache import get_cache, set_cache

    def _wait_for_cached_value() -> dict | None:
        deadline = time.time() + wait_timeout_seconds
        while time.time() < deadline:
            cached_value = get_cache(cache_key, max_age_seconds=max_age_seconds)
            if cached_value is not None:
                return cached_value
            time.sleep(0.1)
        return None

    def _acquire_distributed_lock() -> tuple[object, str, str] | None | bool:
        from crate.db.cache import _get_redis

        redis_client = _get_redis()
        if not redis_client:
            return None
        lock_key = f"lock:{cache_key}"
        token = secrets.token_urlsafe(12)
        try:
            acquired = redis_client.set(lock_key, token, ex=max(int(wait_timeout_seconds) + 5, 15), nx=True)
        except Exception:
            return None
        if acquired:
            return redis_client, lock_key, token
        return False

    def _release_distributed_lock(lock_state: tuple[object, str, str] | None):
        if not lock_state:
            return
        redis_client, lock_key, token = lock_state
        try:
            redis_client.eval(
                """
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                end
                return 0
                """,
                1,
                lock_key,
                token,
            )
        except Exception:
            return

    if not fresh:
        cached = get_cache(cache_key, max_age_seconds=max_age_seconds)
        if cached is not None:
            _record_home_metric("home.cache.hit", cache_key=cache_key)
            return cached
    _record_home_metric("home.cache.miss", cache_key=cache_key)

    is_owner = False
    wait_event: Event
    with _home_cache_singleflight_guard:
        wait_event = _home_cache_singleflight_events.get(cache_key)
        if wait_event is None:
            wait_event = Event()
            _home_cache_singleflight_events[cache_key] = wait_event
            is_owner = True

    if not is_owner:
        if wait_event.wait(wait_timeout_seconds):
            cached = get_cache(cache_key, max_age_seconds=max_age_seconds)
            if cached is not None:
                _record_home_metric("home.cache.coalesced", cache_key=cache_key)
                return cached
        waited = _wait_for_cached_value()
        if waited is not None:
            _record_home_metric("home.cache.waited", cache_key=cache_key)
            return waited
        # The owner likely failed or timed out; fall through and compute locally.

    distributed_lock = _acquire_distributed_lock()
    if distributed_lock is False:
        waited = _wait_for_cached_value()
        if waited is not None:
            _record_home_metric("home.cache.waited", cache_key=cache_key)
            return waited
        distributed_lock = None

    try:
        started = time.monotonic()
        value = compute()
        elapsed_ms = (time.monotonic() - started) * 1000
        _record_home_metric("home.compute.ms", cache_key=cache_key, value=elapsed_ms)
        if elapsed_ms >= 1000:
            log.info("Slow home cache compute for %s: %.1fms", cache_key, elapsed_ms)
        set_cache(cache_key, value, ttl=ttl)
        return value
    except Exception:
        if allow_stale_on_error and stale_max_age_seconds is not None:
            stale = get_cache(cache_key, max_age_seconds=stale_max_age_seconds)
            if stale is not None:
                _record_home_metric("home.cache.stale_fallback", cache_key=cache_key)
                return stale
        raise
    finally:
        _release_distributed_lock(distributed_lock if isinstance(distributed_lock, tuple) else None)
        if is_owner:
            with _home_cache_singleflight_guard:
                current = _home_cache_singleflight_events.pop(cache_key, None)
                if current is not None:
                    current.set()


def _artist_identity(row: dict) -> object | None:
    artist_slug = (row.get("artist_slug") or "").strip().lower()
    if artist_slug:
        return ("slug", artist_slug)
    artist_id = row.get("artist_id")
    if artist_id is not None:
        return ("id", artist_id)
    artist_name = (row.get("artist") or "").strip().lower()
    if artist_name:
        return ("name", artist_name)
    return None


def _album_identity(row: dict) -> object | None:
    artist_identity = _artist_identity(row)
    album_slug = (row.get("album_slug") or "").strip().lower()
    if album_slug:
        return ("slug", artist_identity, album_slug)
    album_name = (row.get("album") or "").strip().lower()
    if album_name:
        return ("name", artist_identity, album_name)
    album_id = row.get("album_id")
    if album_id is not None:
        return ("id", album_id)
    return None


def _track_payload(row: dict) -> dict:
    return {
        "track_id": row.get("track_id"),
        "track_storage_id": str(row["track_storage_id"]) if row.get("track_storage_id") is not None else None,
        "track_path": row.get("track_path"),
        "title": row.get("title") or "",
        "artist": row.get("artist") or "",
        "artist_id": row.get("artist_id"),
        "artist_slug": row.get("artist_slug"),
        "album": row.get("album") or "",
        "album_id": row.get("album_id"),
        "album_slug": row.get("album_slug"),
        "duration": row.get("duration"),
        "format": row.get("format"),
        "bitrate": (row["bitrate"] // 1000) if row.get("bitrate") else None,
        "sample_rate": row.get("sample_rate"),
        "bit_depth": row.get("bit_depth"),
    }


def _artwork_tracks(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[tuple[object, str, str]] = set()
    for row in rows:
        key = (row.get("album_id"), row.get("artist") or "", row.get("album") or "")
        if key in seen:
            continue
        seen.add(key)
        artwork.append(
            {
                "artist": row.get("artist"),
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
            }
        )
        if len(artwork) >= limit:
            break
    return artwork


def _artwork_artists(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[object] = set()
    for row in rows:
        artist_key = row.get("artist_id") or (row.get("artist") or "").strip().lower()
        if not artist_key or artist_key in seen:
            continue
        seen.add(artist_key)
        artwork.append(
            {
                "artist_name": row.get("artist") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
            }
        )
        if len(artwork) >= limit:
            break
    return artwork


def _select_diverse_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}

    for row in rows:
        track_key = row.get("track_id") or row.get("track_path")
        if not track_key or track_key in seen_tracks:
            continue
        artist_name = (row.get("artist") or "").strip().lower()
        album_key = (artist_name, (row.get("album") or "").strip().lower())
        if artist_name and artist_counts.get(artist_name, 0) >= max_per_artist:
            continue
        if album_key[1] and album_counts.get(album_key, 0) >= max_per_album:
            continue

        seen_tracks.add(track_key)
        if artist_name:
            artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
        if album_key[1]:
            album_counts[album_key] = album_counts.get(album_key, 0) + 1
        selected.append(row)
        if len(selected) >= limit:
            break

    return selected


def _merge_track_rows(*collections: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen_tracks: set[object] = set()

    for rows in collections:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            seen_tracks.add(track_key)
            merged.append(row)

    return merged


def _select_diverse_tracks_with_backfill(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    if limit <= 0:
        return []

    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}
    passes = [
        (max_per_artist, max_per_album),
        (max(max_per_artist + 1, 3), max(max_per_album + 1, 3)),
        (limit, limit),
    ]

    for artist_limit, album_limit in passes:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            artist_name = (row.get("artist") or "").strip().lower()
            album_key = (artist_name, (row.get("album") or "").strip().lower())
            if artist_name and artist_counts.get(artist_name, 0) >= artist_limit:
                continue
            if album_key[1] and album_counts.get(album_key, 0) >= album_limit:
                continue

            seen_tracks.add(track_key)
            if artist_name:
                artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
            if album_key[1]:
                album_counts[album_key] = album_counts.get(album_key, 0) + 1
            selected.append(row)
            if len(selected) >= limit:
                return selected

    return selected


def _playlist_artwork_map(session, playlist_ids: list[int]) -> dict[int, list[dict]]:
    if not playlist_ids:
        return {}
    rows = session.execute(
        text("""
        SELECT
            pt.playlist_id,
            lt.artist,
            art.id AS artist_id,
            art.slug AS artist_slug,
            lt.album,
            alb.id AS album_id,
            alb.slug AS album_slug
        FROM playlist_tracks pt
        LEFT JOIN LATERAL (
            SELECT id, artist, album, album_id
            FROM library_tracks lt
            WHERE lt.id = pt.track_id
               OR (pt.track_id IS NULL AND lt.path = pt.track_path)
            ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 ELSE 1 END
            LIMIT 1
        ) lt ON TRUE
        LEFT JOIN library_artists art ON art.name = lt.artist
        LEFT JOIN library_albums alb ON alb.id = lt.album_id
        WHERE pt.playlist_id = ANY(:playlist_ids) AND lt.id IS NOT NULL
        ORDER BY pt.playlist_id ASC, pt.position ASC
        """),
        {"playlist_ids": playlist_ids},
    ).mappings().all()
    artwork: dict[int, list[dict]] = {}
    for row in rows:
        bucket = artwork.setdefault(row["playlist_id"], [])
        if len(bucket) >= 4:
            continue
        bucket.append(
            {
                "artist": row.get("artist"),
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
            }
        )
    return artwork


def _build_recently_played(user_id: int, limit: int = 9) -> list[dict]:
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

    recent_playlists: list[dict] = []
    with transaction_scope() as session:
        playlist_rows = [dict(row) for row in session.execute(
            text("""
            SELECT *
            FROM (
                SELECT DISTINCT ON (upe.context_playlist_id)
                    p.id AS playlist_id,
                    p.name,
                    p.description,
                    p.scope,
                    p.cover_data_url,
                    upe.ended_at AS played_at
                FROM user_play_events upe
                JOIN playlists p ON p.id = upe.context_playlist_id
                WHERE upe.user_id = :user_id
                  AND upe.context_playlist_id IS NOT NULL
                ORDER BY upe.context_playlist_id ASC, upe.ended_at DESC
            ) recent
                ORDER BY recent.played_at DESC
                LIMIT :lim
            """),
            {"user_id": user_id, "lim": target_per_bucket},
        ).mappings().all()]
        artwork_map = _playlist_artwork_map(
            session,
            [row["playlist_id"] for row in playlist_rows if row.get("playlist_id") is not None],
        )

    for row in playlist_rows:
        recent_playlists.append(
            {
                "type": "playlist",
                "playlist_id": row.get("playlist_id"),
                "playlist_name": row.get("name") or "",
                "playlist_description": row.get("description") or "",
                "playlist_scope": row.get("scope") or "user",
                "playlist_cover_data_url": row.get("cover_data_url"),
                "playlist_tracks": artwork_map.get(row.get("playlist_id") or 0, []),
                "subtitle": "Playlist" if row.get("scope") != "system" else "Mix",
                "played_at": row.get("played_at"),
            }
        )

    items: list[dict] = []
    for index in range(target_per_bucket):
        if index < len(recent_playlists):
            items.append(recent_playlists[index])
        if index < len(recent_artists):
            items.append(recent_artists[index])
        if index < len(recent_albums):
            items.append(recent_albums[index])
    return items[:limit]


def _get_home_hero(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> dict | None:
    with transaction_scope() as session:
        rows_result = session.execute(
            text("""
            SELECT
                la.id,
                la.slug,
                la.name,
                COALESCE(la.listeners, 0) AS listeners,
                COALESCE(la.lastfm_playcount, 0) AS scrobbles,
                COALESCE(la.album_count, 0) AS album_count,
                COALESCE(la.track_count, 0) AS track_count,
                COALESCE(la.bio, '') AS bio,
                COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) AS genre_hits,
                MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) AS similar_hits
            FROM library_artists la
            LEFT JOIN artist_genres ag ON ag.artist_name = la.name
            LEFT JOIN genres g ON g.id = ag.genre_id
            LEFT JOIN artist_similarities sim ON sim.artist_name = la.name AND sim.in_library = TRUE
            WHERE la.has_photo = 1
              AND COALESCE(la.bio, '') <> ''
              AND NOT (LOWER(la.name) = ANY(:followed))
            GROUP BY la.id, la.slug, la.name, la.listeners, la.lastfm_playcount, la.album_count, la.track_count, la.bio
            HAVING COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) > 0
            ORDER BY
                MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) DESC,
                COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) DESC,
                COALESCE(la.listeners, 0) DESC,
                COALESCE(la.lastfm_playcount, 0) DESC
            LIMIT 7
            """),
            {
                "top_genres": top_genres_lower,
                "similar_targets": similar_target_names_lower,
                "followed": followed_names_lower,
            },
        ).mappings().all()

        if not rows_result:
            rows_result = session.execute(
                text("""
                SELECT
                    id,
                    slug,
                    name,
                    COALESCE(listeners, 0) AS listeners,
                    COALESCE(lastfm_playcount, 0) AS scrobbles,
                    COALESCE(album_count, 0) AS album_count,
                    COALESCE(track_count, 0) AS track_count,
                    COALESCE(bio, '') AS bio
                FROM library_artists
                WHERE has_photo = 1
                  AND COALESCE(bio, '') <> ''
                  AND NOT (LOWER(name) = ANY(:followed))
                ORDER BY COALESCE(listeners, 0) DESC, COALESCE(lastfm_playcount, 0) DESC
                LIMIT 7
                """),
                {"followed": followed_names_lower},
            ).mappings().all()

    rows = [dict(item) for item in rows_result]
    if not rows:
        return None

    # Fetch top genres for each hero artist
    artist_names = [r["name"] for r in rows]
    genre_map: dict[str, list[str]] = {}
    if artist_names:
        with transaction_scope() as session:
            genre_rows = session.execute(
                text("""
                SELECT ag.artist_name, g.name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = ANY(:names)
                ORDER BY ag.artist_name
                """),
                {"names": artist_names},
            ).mappings().all()
            for gr in genre_rows:
                genre_map.setdefault(gr["artist_name"], []).append(gr["name"])

    for item in rows:
        item["bio"] = _trim_bio(item.get("bio") or "")
        item["genres"] = genre_map.get(item["name"], [])[:4]

    # Deterministic shuffle: rotate by day+user so different users see
    # different orderings and the same user sees a new order each day.
    offset = _daily_rotation_index(len(rows), user_id)
    return rows[offset:] + rows[:offset]


def _track_candidates_for_album_ids(user_id: int, album_ids: list[int], limit: int = 240) -> list[dict]:
    if not album_ids:
        return []
    # Cap album IDs to prevent massive IN queries
    capped_ids = album_ids[:30]
    with transaction_scope() as session:
        # Set per-query timeout to prevent pool starvation
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text("""
            SELECT
                t.id AS track_id,
                t.storage_id::text AS track_storage_id,
                t.path AS track_path,
                t.title,
                t.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                t.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                t.duration,
                t.format,
                t.bitrate,
                t.sample_rate,
                t.bit_depth,
                COALESCE(t.lastfm_playcount, 0) AS popularity
            FROM library_tracks t
            JOIN library_albums alb ON alb.id = t.album_id
            LEFT JOIN library_artists art ON art.name = t.artist
            WHERE t.album_id = ANY(:album_ids)
            ORDER BY
                COALESCE(t.lastfm_playcount, 0) DESC,
                COALESCE(t.track_number, 9999) ASC,
                t.title ASC
            LIMIT :lim
            """),
            {"album_ids": capped_ids, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def _query_discovery_tracks(
    user_id: int,
    *,
    genres: list[str],
    excluded_artist_names: list[str],
    limit: int = 240,
) -> list[dict]:
    if not genres:
        return []
    genres = expand_genre_terms_with_aliases(genres)
    # Cap genres to prevent massive ANY() arrays
    capped_genres = genres[:20]
    capped_excluded = excluded_artist_names[:50]
    with transaction_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        # Step 1: find artists that match the genres (cheap, indexed)
        artist_rows = session.execute(
            text("""
            SELECT DISTINCT ag.artist_name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE LOWER(g.name) = ANY(:genres)
              AND NOT (LOWER(ag.artist_name) = ANY(:excluded))
            LIMIT 200
            """),
            {"genres": capped_genres, "excluded": capped_excluded},
        ).mappings().all()
        matching_artists = [r["artist_name"] for r in artist_rows]
        if not matching_artists:
            return []

        # Step 2: get tracks from those artists (simple indexed query)
        rows = session.execute(
            text("""
            SELECT
                t.id AS track_id,
                t.storage_id::text AS track_storage_id,
                t.path AS track_path,
                t.title,
                t.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                t.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                t.duration,
                t.format,
                t.bitrate,
                t.sample_rate,
                t.bit_depth,
                COALESCE(t.lastfm_playcount, 0) AS popularity
            FROM library_tracks t
            JOIN library_albums alb ON alb.id = t.album_id
            LEFT JOIN library_artists art ON art.name = t.artist
            WHERE t.artist = ANY(:artists)
            ORDER BY
                COALESCE(t.lastfm_playcount, 0) DESC,
                t.title ASC
            LIMIT :lim
            """),
            {"artists": matching_artists[:100], "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def _filter_interesting_releases(
    releases: list[dict],
    *,
    interest_artists_lower: set[str],
    saved_album_ids: set[int],
    days: int | None = None,
) -> list[dict]:
    now = datetime.now(timezone.utc)
    items: list[dict] = []
    seen_album_ids: set[int] = set()
    for row in releases:
        album_id = row.get("album_id")
        artist_name = (row.get("artist_name") or "").strip()
        if not album_id or not artist_name:
            continue
        if album_id in saved_album_ids or album_id in seen_album_ids:
            continue
        if interest_artists_lower and artist_name.lower() not in interest_artists_lower:
            continue
        key_dt = _coerce_datetime(row.get("release_date")) or _coerce_datetime(row.get("detected_at"))
        if days is not None and key_dt and key_dt < now - timedelta(days=days):
            continue
        seen_album_ids.add(album_id)
        items.append(dict(row))
    items.sort(
        key=lambda item: _coerce_datetime(item.get("release_date")) or _coerce_datetime(item.get("detected_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return items


def _fallback_recent_interest_tracks(user_id: int, interest_artists_lower: list[str], limit: int = 240) -> list[dict]:
    if not interest_artists_lower:
        return []
    capped_artists = interest_artists_lower[:50]
    with transaction_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text("""
            SELECT
                t.id AS track_id,
                t.storage_id::text AS track_storage_id,
                t.path AS track_path,
                t.title,
                t.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                t.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                t.duration,
                t.format,
                t.bitrate,
                t.sample_rate,
                t.bit_depth,
                COALESCE(t.lastfm_playcount, 0) AS popularity
            FROM library_tracks t
            JOIN library_albums alb ON alb.id = t.album_id
            LEFT JOIN library_artists art ON art.name = t.artist
            WHERE LOWER(t.artist) = ANY(:artists)
            ORDER BY
                alb.updated_at DESC NULLS LAST,
                COALESCE(t.lastfm_playcount, 0) DESC,
                COALESCE(t.track_number, 9999) ASC
            LIMIT :lim
            """),
            {"artists": capped_artists, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


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
        primary_rows = [
            row for row in primary_rows if not row.get("user_play_count") and not row.get("is_liked")
        ]
        fallback_rows: list[dict] = []
        if len(primary_rows) < limit:
            fallback_rows = _query_discovery_tracks(
                user_id,
                genres=top_genres_lower[:3],
                excluded_artist_names=[],
                limit=max(limit * 6, 160),
            )
            fallback_rows = [
                row
                for row in fallback_rows
                if not row.get("is_liked") and int(row.get("user_play_count") or 0) <= 1
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
                row
                for row in fallback_candidates
                if not row.get("is_liked") and int(row.get("user_play_count") or 0) <= 2
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


def _build_artist_core_rows(
    user_id: int,
    *,
    artist_id: int,
    artist_name: str,
    limit: int,
) -> list[dict]:
    with transaction_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text("""
            SELECT
                t.id AS track_id,
                t.storage_id::text AS track_storage_id,
                t.path AS track_path,
                t.title,
                t.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                t.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                t.duration,
                t.format,
                t.bitrate,
                t.sample_rate,
                t.bit_depth,
                COALESCE(t.lastfm_playcount, 0) AS popularity,
                COALESCE(alb.year, '') AS album_year,
                COALESCE(t.track_number, 9999) AS track_number
            FROM library_tracks t
            LEFT JOIN library_albums alb ON alb.id = t.album_id
            LEFT JOIN library_artists art ON art.name = t.artist
            WHERE art.id = :artist_id OR (art.id IS NULL AND t.artist = :artist_name)
            ORDER BY
                COALESCE(t.lastfm_playcount, 0) DESC,
                COALESCE(alb.year, '') DESC,
                COALESCE(t.track_number, 9999) ASC,
                t.title ASC
            LIMIT :lim
            """),
            {"artist_id": artist_id,
             "artist_name": artist_name, "lim": max(limit * 5, 80)},
        ).mappings().all()
        rows = [dict(row) for row in rows]

    return _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=limit, max_per_album=2)


def _get_library_artist(artist_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT id, slug, name FROM library_artists WHERE id = :id"),
            {"id": artist_id},
        ).mappings().first()
    return dict(row) if row else None


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


def _get_home_context(
    user_id: int,
    *,
    top_artist_limit: int = 28,
    top_album_limit: int = 12,
    top_genre_limit: int = 8,
) -> dict:
    followed = get_followed_artists(user_id)
    saved_albums = get_saved_albums(user_id)
    top_artists = get_top_artists(user_id, window="90d", limit=top_artist_limit)
    top_albums = get_top_albums(user_id, window="90d", limit=top_album_limit)
    top_genres = get_top_genres(user_id, window="90d", limit=top_genre_limit)

    followed_names_lower = [(row.get("artist_name") or "").lower() for row in followed if row.get("artist_name")]
    top_artist_names_lower = [(row.get("artist_name") or "").lower() for row in top_artists if row.get("artist_name")]
    interest_artists_lower = list(dict.fromkeys(top_artist_names_lower + followed_names_lower))
    saved_album_ids = list({row["id"] for row in saved_albums if row.get("id") is not None})
    top_genres_lower, mix_seed_genres = _derive_home_genres(top_genres, [], top_genre_limit)
    if not top_genres_lower and not mix_seed_genres and followed_names_lower:
        with transaction_scope() as session:
            rows = session.execute(
                text("""SELECT g.name, COUNT(*) AS cnt
                    FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
                    WHERE LOWER(ag.artist_name) = ANY(:names)
                    GROUP BY g.name ORDER BY cnt DESC LIMIT :lim"""),
                {"names": followed_names_lower, "lim": top_genre_limit},
            ).mappings().all()
            fallback_genre_names = [row["name"].lower() for row in rows]
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


def _build_suggested_albums(recent_releases: list[dict], limit: int) -> list[dict]:
    suggested_albums: list[dict] = []
    for row in recent_releases:
        suggested_albums.append(
            {
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
                "artist_name": row.get("artist_name") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album_name": row.get("album_title") or "",
                "year": row.get("year"),
                "release_date": row.get("release_date"),
                "release_type": row.get("release_type") or "Album",
            }
        )
        if len(suggested_albums) >= limit:
            break
    return suggested_albums


def _build_recommended_tracks(
    user_id: int,
    *,
    recent_releases: list[dict],
    interest_artists_lower: list[str],
    limit: int,
    fallback_tracks: list[dict] | None = None,
) -> list[dict]:
    fresh_release_album_ids = [
        row["album_id"]
        for row in _filter_interesting_releases(
            recent_releases,
            interest_artists_lower=set(interest_artists_lower),
            saved_album_ids=set(),
            days=7,
        )
        if row.get("album_id") is not None
    ]
    if not fresh_release_album_ids:
        fresh_release_album_ids = [row["album_id"] for row in recent_releases[:24] if row.get("album_id") is not None]

    candidate_limit = max(limit * 6, 120)
    recommended_track_rows = _track_candidates_for_album_ids(user_id, fresh_release_album_ids[:24], limit=candidate_limit)
    recommended_track_rows = [
        row
        for row in recommended_track_rows
        if not row.get("user_play_count") and not row.get("is_liked")
    ]
    if len(recommended_track_rows) < limit:
        fallback_rows = [dict(track) for track in (fallback_tracks or [])]
        recommended_track_rows = _merge_track_rows(recommended_track_rows, fallback_rows)
    return _select_diverse_tracks_with_backfill(recommended_track_rows, limit=limit, max_per_artist=2, max_per_album=2)


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
    """Build mix summaries using pre-computed context (no redundant DB calls).

    Only fetches enough tracks per mix for artwork (4 covers) + count,
    NOT the full 36-track payload that get_home_playlist would return.
    """
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
        mixes.append({
            "id": mix_id,
            "name": name,
            "description": description,
            "artwork_tracks": _artwork_tracks(rows),
            "artwork_artists": _artwork_artists(rows),
            "track_count": len(rows),
            "badge": "Mix",
            "kind": "mix",
        })
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
    """Build core-tracks summaries directly (no redundant context fetching).

    Only fetches enough tracks per artist for artwork + count.
    """
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
        essentials.append({
            "id": f"core-tracks-artist-{artist_id}",
            "name": artist_name,
            "description": f"The defining tracks from {artist_name}.",
            "artwork_tracks": _artwork_tracks(rows),
            "artwork_artists": _artwork_artists(rows),
            "track_count": len(rows),
            "badge": "Core Tracks",
            "kind": "core",
        })
        if len(essentials) >= limit:
            break
    return essentials


def get_home_mix(user_id: int, mix_id: str, limit: int = 40) -> dict | None:
    context = _get_cached_home_context(user_id, top_artist_limit=28, top_album_limit=12, top_genre_limit=8)
    recent_releases = _recent_releases_from_context(context)

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

    rows = _build_artist_core_rows(
        user_id,
        artist_id=artist_id,
        artist_name=artist["name"],
        limit=limit,
    )
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


def _get_cached_home_context(
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
        compute=lambda: _get_home_context(
            user_id,
            top_artist_limit=top_artist_limit,
            top_album_limit=top_album_limit,
            top_genre_limit=top_genre_limit,
        ),
    )


def _merged_artists_from_context(context: dict) -> list[dict]:
    top_artists = context["top_artists"]
    followed = context["followed"]
    seen_artist_ids = {row.get("artist_id") for row in top_artists if row.get("artist_id") is not None}
    merged = list(top_artists)
    for row in followed:
        aid = row.get("artist_id")
        if aid is not None and aid not in seen_artist_ids:
            merged.append({
                "artist_id": aid,
                "artist_slug": row.get("artist_slug"),
                "artist_name": row.get("artist_name") or "",
                "play_count": 0,
                "minutes_listened": 0,
            })
            seen_artist_ids.add(aid)
    return merged


def _recent_releases_from_context(context: dict) -> list[dict]:
    return _filter_interesting_releases(
        get_new_releases(limit=250),
        interest_artists_lower=set(context["interest_artists_lower"]),
        saved_album_ids=set(context["saved_album_ids"]),
        days=240,
    )


def get_home_hero(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    return _get_home_hero(
        user_id,
        ctx["followed_names_lower"],
        ctx["top_artist_names_lower"][:8],
        ctx["top_genres_lower"][:4],
    )


def get_home_recently_played(user_id: int) -> list[dict]:
    return _build_recently_played(user_id, limit=18)


def get_home_mixes(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    recent_releases = _recent_releases_from_context(ctx)
    return _build_custom_mix_summaries(
        user_id,
        mix_seed_genres=ctx["mix_seed_genres"],
        interest_artists_lower=ctx["interest_artists_lower"],
        top_genres_lower=ctx["top_genres_lower"],
        mix_count=8,
        recent_releases=recent_releases,
    )


def get_home_suggested_albums(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    recent_releases = _recent_releases_from_context(ctx)
    return _build_suggested_albums(recent_releases, 14)


def get_home_recommended_tracks(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    recent_releases = _recent_releases_from_context(ctx)
    rows = _build_recommended_tracks(
        user_id,
        recent_releases=recent_releases,
        interest_artists_lower=ctx["interest_artists_lower"],
        limit=18,
    )
    return [_track_payload(row) for row in rows]


def get_home_radio_stations(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    merged = _merged_artists_from_context(ctx)
    return _build_radio_stations(merged, ctx["top_albums"], 14)


def get_home_favorite_artists(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    merged = _merged_artists_from_context(ctx)
    return _build_favorite_artists(merged, 14)


def get_home_essentials(user_id: int) -> list[dict]:
    ctx = _get_cached_home_context(user_id)
    merged = _merged_artists_from_context(ctx)
    return _build_core_playlists(user_id, merged, 6)


def get_cached_home_discovery(user_id: int, *, fresh: bool = False) -> dict:
    cache_key = f"home:discovery:{user_id}"
    return _get_or_compute_home_cache(
        cache_key,
        max_age_seconds=600,
        ttl=600,
        fresh=fresh,
        allow_stale_on_error=True,
        stale_max_age_seconds=3600,
        compute=lambda: get_home_discovery(user_id),
    )


def get_home_discovery(user_id: int) -> dict:
    context = _get_cached_home_context(user_id, top_artist_limit=28, top_album_limit=12, top_genre_limit=8)
    top_artists = context["top_artists"]
    top_albums = context["top_albums"]
    followed_names_lower = context["followed_names_lower"]
    top_artist_names_lower = context["top_artist_names_lower"]
    top_genres_lower = context["top_genres_lower"]
    mix_seed_genres = context["mix_seed_genres"]
    interest_artists_lower = context["interest_artists_lower"]

    hero = _get_home_hero(user_id, followed_names_lower, top_artist_names_lower[:8], top_genres_lower[:4])

    recent_releases = _filter_interesting_releases(
        get_new_releases(limit=250),
        interest_artists_lower=set(interest_artists_lower),
        saved_album_ids=set(context["saved_album_ids"]),
        days=240,
    )

    precomputed_mixes: dict[str, tuple[str, str, list[dict]]] = {}
    my_new_arrivals_mix = _build_mix_rows(
        user_id,
        interest_artists_lower=interest_artists_lower,
        top_genres_lower=top_genres_lower,
        mix_id="my-new-arrivals",
        limit=max(18, 8),
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
    merged_artists = _merged_artists_from_context(context)

    radio_stations = _build_radio_stations(merged_artists, top_albums, 14)
    favorite_artists = _build_favorite_artists(merged_artists, 14)
    essentials = _build_core_playlists(user_id, merged_artists, 6)

    return {
        "hero": hero,
        "recently_played": _build_recently_played(user_id, limit=18),
        "custom_mixes": custom_mixes,
        "suggested_albums": suggested_albums,
        "recommended_tracks": [_track_payload(row) for row in recommended_tracks],
        "radio_stations": radio_stations,
        "favorite_artists": favorite_artists,
        "essentials": essentials,
    }


def get_home_section(user_id: int, section_id: str, limit: int = 42) -> dict | None:
    context = _get_cached_home_context(
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
    recent_releases = _filter_interesting_releases(
        get_new_releases(limit=max(limit * 8, 250)),
        interest_artists_lower=set(interest_artists_lower),
        saved_album_ids=set(context["saved_album_ids"]),
        days=240,
    )

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
