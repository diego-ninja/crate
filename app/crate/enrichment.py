"""Unified artist enrichment — fetches all sources and persists to DB."""

from __future__ import annotations

import atexit
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

from crate.db.cache_settings import get_setting
from crate.db.cache_store import delete_cache, get_cache, set_cache
from crate.db.genres import set_artist_genres
from crate.db.repositories.library import get_library_artist, update_artist_enrichment, update_artist_has_photo
from crate.db.similarities import bulk_upsert_similarities
from crate.provider_rate_limits import wait_for_provider_slot

log = logging.getLogger(__name__)

_ENRICHMENT_FETCH_ORDER = (
    "lastfm",
    "spotify",
    "musicbrainz",
    "setlist",
    "fanart",
    "discogs",
)

_SOURCE_CACHE_PREFIX = "enrichment:source"
_SOURCE_TTLS_SECONDS = {
    "lastfm": 86400 * 7,
    "spotify": 86400 * 3,
    "musicbrainz": 86400 * 30,
    "setlist": 86400,
    "fanart": 86400 * 30,
    "discogs": 86400 * 30,
}
_PROVIDER_MIN_INTERVAL_SECONDS = {
    "lastfm": 0.25,
    "spotify": 0.15,
    "musicbrainz": 1.1,
    "setlist": 1.0,
    "fanart": 1.0,
    "discogs": 1.0,
}
_EXECUTORS: dict[int, ThreadPoolExecutor] = {}
_EXECUTOR_LOCK = threading.Lock()


def _shutdown_executors() -> None:
    with _EXECUTOR_LOCK:
        executors = list(_EXECUTORS.values())
        _EXECUTORS.clear()
    for executor in executors:
        executor.shutdown(wait=False, cancel_futures=True)


atexit.register(_shutdown_executors)


def _get_enrichment_parallelism(config: dict) -> int:
    raw = config.get("enrichment_parallelism", 3)
    try:
        parallelism = int(raw or 3)
    except (TypeError, ValueError):
        parallelism = 3
    return max(1, min(parallelism, len(_ENRICHMENT_FETCH_ORDER)))


def _provider_label(source: str) -> str:
    labels = {
        "lastfm": "Last.fm",
        "spotify": "Spotify",
        "musicbrainz": "MusicBrainz",
        "setlist": "Setlist.fm",
        "fanart": "Fanart.tv",
        "discogs": "Discogs",
    }
    return labels.get(source, source)


def _source_cache_key(source: str, artist_name: str) -> str:
    return f"{_SOURCE_CACHE_PREFIX}:{source}:{artist_name.lower()}"


def _source_ttl(source: str) -> int:
    return _SOURCE_TTLS_SECONDS.get(source, 86400)


def _get_cached_source_payload(source: str, artist_name: str) -> Any | None:
    ttl = _source_ttl(source)
    cached = get_cache(_source_cache_key(source, artist_name), max_age_seconds=ttl)
    if cached is not None:
        return cached

    legacy = get_cache(f"enrichment:{artist_name.lower()}", max_age_seconds=ttl)
    if isinstance(legacy, dict) and source in legacy:
        payload = legacy[source]
        set_cache(_source_cache_key(source, artist_name), payload, ttl=ttl)
        return payload
    return None


def _set_cached_source_payload(source: str, artist_name: str, payload: Any) -> None:
    set_cache(_source_cache_key(source, artist_name), payload, ttl=_source_ttl(source))


def _get_executor(worker_count: int) -> ThreadPoolExecutor:
    with _EXECUTOR_LOCK:
        executor = _EXECUTORS.get(worker_count)
        if executor is None:
            executor = ThreadPoolExecutor(
                max_workers=worker_count,
                thread_name_prefix=f"enrichment-{worker_count}",
            )
            _EXECUTORS[worker_count] = executor
        return executor


def _execute_enrichment_fetcher(source: str, artist_name: str, fetcher: Callable[[], Any]) -> Any | None:
    try:
        wait_for_provider_slot(source, _PROVIDER_MIN_INTERVAL_SECONDS.get(source, 0.0))
        payload = fetcher()
    except Exception:
        log.debug("%s failed for %s", _provider_label(source), artist_name, exc_info=True)
        return None
    return payload or None


def _run_enrichment_fetchers(
    artist_name: str,
    fetchers: dict[str, Callable[[], Any]],
    *,
    max_workers: int,
) -> dict[str, Any]:
    if not fetchers:
        return {}

    worker_count = max(1, min(int(max_workers or 1), len(fetchers)))
    results: dict[str, Any] = {}
    if worker_count == 1:
        for source, fetcher in fetchers.items():
            payload = _execute_enrichment_fetcher(source, artist_name, fetcher)
            if payload is not None:
                results[source] = payload
        return results

    executor = _get_executor(worker_count)
    future_map = {
        executor.submit(_execute_enrichment_fetcher, source, artist_name, fetcher): source
        for source, fetcher in fetchers.items()
    }
    for future in as_completed(future_map):
        source = future_map[future]
        try:
            payload = future.result()
        except Exception:
            log.debug("%s failed for %s", _provider_label(source), artist_name, exc_info=True)
            continue
        if payload is not None:
            results[source] = payload
    return results


def _fetch_lastfm_payload(name: str) -> dict | None:
    from crate.lastfm import get_artist_info

    return get_artist_info(name)


def _fetch_spotify_payload(name: str) -> dict | None:
    from crate import spotify

    artist = spotify.search_artist(name)
    if not artist:
        return None

    return {
        "artist": dict(artist),
        "top_tracks": spotify.get_top_tracks(artist["id"]) or [],
        "related_artists": spotify.get_related_artists(artist["id"]) or [],
    }


def _fetch_musicbrainz_payload(name: str) -> dict | None:
    from crate import musicbrainz_ext

    return musicbrainz_ext.get_artist_details(name)


def _fetch_setlist_payload(name: str) -> list[dict] | None:
    from crate import setlistfm

    return setlistfm.get_probable_setlist(name)


def _fetch_fanart_payload(name: str) -> dict | None:
    from crate.lastfm import get_fanart_all_images

    return get_fanart_all_images(name)


def _fetch_discogs_payload(name: str) -> dict | None:
    from crate.discogs import enrich_artist as discogs_enrich

    return discogs_enrich(name)


def _discogs_is_configured() -> bool:
    try:
        from crate.discogs import is_configured as discogs_configured
    except Exception:
        log.debug("Discogs config check failed", exc_info=True)
        return False
    return bool(discogs_configured())


def _collect_enrichment_payloads(name: str, *, max_workers: int, force: bool = False) -> dict[str, Any]:
    available_fetchers: dict[str, Callable[[], Any]] = {
        "lastfm": lambda: _fetch_lastfm_payload(name),
        "spotify": lambda: _fetch_spotify_payload(name),
        "musicbrainz": lambda: _fetch_musicbrainz_payload(name),
        "setlist": lambda: _fetch_setlist_payload(name),
        "fanart": lambda: _fetch_fanart_payload(name),
    }
    if _discogs_is_configured():
        available_fetchers["discogs"] = lambda: _fetch_discogs_payload(name)

    payloads: dict[str, Any] = {}
    fetchers: dict[str, Callable[[], Any]] = {}
    for source, fetcher in available_fetchers.items():
        cached = None if force else _get_cached_source_payload(source, name)
        if cached is not None:
            payloads[source] = cached
        else:
            fetchers[source] = fetcher

    fetched = _run_enrichment_fetchers(name, fetchers, max_workers=max_workers)
    for source, payload in fetched.items():
        _set_cached_source_payload(source, name, payload)
    payloads.update(fetched)
    return payloads


def _has_local_artist_photo(artist_dir: Path) -> bool:
    return artist_dir.is_dir() and any(
        (artist_dir / photo_name).exists() for photo_name in ("artist.jpg", "artist.png", "photo.jpg")
    )


def _download_artist_photo(name: str, artist_dir: Path) -> bool:
    if not artist_dir.is_dir():
        return False

    try:
        from crate.lastfm import get_best_artist_image
    except Exception:
        return False

    try:
        image = get_best_artist_image(name)
        if not image:
            return False
        (artist_dir / "artist.jpg").write_bytes(image)
        update_artist_has_photo(name)
        return True
    except OSError:
        return False


def enrich_artist(name: str, config: dict, force: bool = False) -> dict:
    """Full enrichment for a single artist. Fetches all sources, persists to DB, downloads photo.

    Returns dict with source flags (has_lastfm, has_spotify, etc.)
    """

    lib = Path(config["library_path"])
    db_artist = get_library_artist(name)
    folder = (db_artist.get("folder_name") if db_artist else None) or name
    artist_dir = lib / folder

    # Skip if recently enriched (unless force)
    if not force and db_artist and db_artist.get("enriched_at"):
        from datetime import datetime, timezone
        from crate.utils import to_datetime
        enriched = to_datetime(db_artist["enriched_at"])
        if enriched is not None:
            age_hours = (datetime.now(timezone.utc) - enriched).total_seconds() / 3600
            try:
                min_age = int(get_setting("enrichment_min_age_hours", "24"))
            except (TypeError, ValueError):
                min_age = 24
            if age_hours < min_age:
                return {"artist": name, "skipped": True, "reason": "recently_enriched"}

    if force:
        for prefix in ("enrichment:", "lastfm:artist:", "fanart:artist:",
                        "fanart:bg:", "fanart:all:", "deezer:artist_img:"):
            delete_cache(f"{prefix}{name.lower()}")
        for source in _ENRICHMENT_FETCH_ORDER:
            delete_cache(_source_cache_key(source, name))

    enrichment_data: dict = {}
    persist_data: dict = {}
    similar_list: list[dict] = []
    payloads = _collect_enrichment_payloads(
        name,
        max_workers=_get_enrichment_parallelism(config),
        force=force,
    )

    info = payloads.get("lastfm")
    if info:
        enrichment_data["lastfm"] = info
        persist_data["bio"] = info.get("bio", "")
        persist_data["tags"] = info.get("tags", [])
        persist_data["similar"] = info.get("similar", [])
        persist_data["listeners"] = info.get("listeners")
        persist_data["lastfm_playcount"] = info.get("playcount")
        if info.get("url"):
            persist_data.setdefault("urls", {})["lastfm"] = info["url"]
        similar_list = info.get("similar", [])

    spotify_payload = payloads.get("spotify")
    if spotify_payload:
        spotify_artist = spotify_payload.get("artist", {})
        spotify_data = {
            "popularity": spotify_artist.get("popularity"),
            "followers": spotify_artist.get("followers"),
            "genres": spotify_artist.get("genres", []),
            "url": spotify_artist.get("url"),
            "top_tracks": spotify_payload.get("top_tracks", []),
            "related_artists": spotify_payload.get("related_artists", []),
        }
        enrichment_data["spotify"] = spotify_data
        persist_data["spotify_id"] = spotify_artist.get("id")
        persist_data["spotify_popularity"] = spotify_artist.get("popularity")
        persist_data["spotify_followers"] = spotify_artist.get("followers")
        if spotify_artist.get("url"):
            persist_data.setdefault("urls", {})["spotify"] = spotify_artist["url"]

        spotify_genres = spotify_artist.get("genres", [])
        if spotify_genres:
            existing_tags = persist_data.get("tags", [])
            persist_data["tags"] = list(dict.fromkeys(existing_tags + spotify_genres))

        related_artists = spotify_payload.get("related_artists", [])
        if not persist_data.get("similar") and related_artists:
            persist_data["similar"] = [{"name": artist["name"]} for artist in related_artists[:10]]

    musicbrainz_payload = payloads.get("musicbrainz")
    if musicbrainz_payload:
        enrichment_data["musicbrainz"] = musicbrainz_payload
        persist_data["mbid"] = musicbrainz_payload.get("mbid")
        persist_data["country"] = musicbrainz_payload.get("country")
        persist_data["area"] = musicbrainz_payload.get("area")
        persist_data["formed"] = musicbrainz_payload.get("begin_date")
        persist_data["ended"] = musicbrainz_payload.get("end_date")
        persist_data["artist_type"] = musicbrainz_payload.get("type")
        persist_data["members"] = musicbrainz_payload.get("members", [])
        musicbrainz_urls = musicbrainz_payload.get("urls", {})
        existing_urls = persist_data.get("urls", {})
        persist_data["urls"] = {**musicbrainz_urls, **existing_urls}

    setlist_payload = payloads.get("setlist")
    if setlist_payload:
        enrichment_data["setlist"] = {
            "probable_setlist": setlist_payload,
            "total_shows": len(setlist_payload),
        }

    fanart_payload = payloads.get("fanart")
    if fanart_payload:
        enrichment_data["fanart"] = fanart_payload

    discogs_payload = payloads.get("discogs")
    if discogs_payload:
        enrichment_data["discogs"] = discogs_payload
        if discogs_payload.get("discogs_id"):
            persist_data["discogs_id"] = str(discogs_payload["discogs_id"])
        if discogs_payload.get("discogs_profile"):
            persist_data["discogs_profile"] = discogs_payload["discogs_profile"][:2000]
        if discogs_payload.get("discogs_members"):
            persist_data["discogs_members"] = discogs_payload["discogs_members"]
        if discogs_payload.get("discogs_url"):
            persist_data.setdefault("urls", {})["discogs"] = discogs_payload["discogs_url"]

    # ── Persist to cache ──
    if enrichment_data:
        set_cache(f"enrichment:{name.lower()}", enrichment_data, ttl=86400 * 7)

    # ── Persist to DB ──
    if persist_data:
        try:
            update_artist_enrichment(name, persist_data)
        except Exception:
            log.warning("Failed to persist enrichment for %s", name, exc_info=True)

    if similar_list:
        try:
            bulk_upsert_similarities(name, similar_list)
        except Exception:
            log.debug("Failed to persist similarities for %s", name)

    # ── Update genre index ──
    tags = persist_data.get("tags", [])
    if tags:
        try:
            genres = []
            for j, tag in enumerate(tags):
                tag = tag.strip()
                if tag and len(tag) >= 2:
                    weight = max(0.1, 1.0 - j * 0.12)
                    genres.append((tag, weight, "enrichment"))
            if genres:
                set_artist_genres(name, genres)
        except Exception:
            log.debug("Failed to index genres for %s", name)

    # ── Download photo ──
    if not _has_local_artist_photo(artist_dir):
        _download_artist_photo(name, artist_dir)

    return {
        "artist": name,
        "has_lastfm": "lastfm" in enrichment_data,
        "has_spotify": "spotify" in enrichment_data,
        "has_setlist": "setlist" in enrichment_data,
        "has_musicbrainz": "musicbrainz" in enrichment_data,
        "has_fanart": "fanart" in enrichment_data,
        "has_discogs": "discogs" in enrichment_data,
    }
