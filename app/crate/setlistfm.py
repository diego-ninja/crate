import os
import logging
import math
import re
from collections import Counter
from collections.abc import Mapping
from datetime import date, datetime, timezone
from typing import Any

import requests
from requests import RequestException

from crate.db.cache_store import get_cache, set_cache

log = logging.getLogger(__name__)

SETLISTFM_BASE = "https://api.setlist.fm/rest/1.0"
_PROBABLE_TTL_SECONDS = 7 * 86400
_PENDING_TTL_SECONDS = 15 * 60
_NEGATIVE_TTL_SECONDS = 6 * 3600


class SetlistProviderUnavailable(RuntimeError):
    pass


class SetlistProviderRateLimited(SetlistProviderUnavailable):
    def __init__(self, retry_after_seconds: float = 60.0) -> None:
        super().__init__("Setlist.fm rate limit exceeded")
        self.retry_after_seconds = max(1.0, retry_after_seconds)


def _normalized_artist_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def _probable_cache_key(name: str) -> str:
    return f"setlistfm:probable:{_normalized_artist_name(name).casefold()}"


def _probable_status_key(name: str) -> str:
    return f"setlistfm:probable-status:{_normalized_artist_name(name).casefold()}"


def _as_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _song_title(song) -> str:
    if isinstance(song, dict):
        return str(song.get("name") or song.get("title") or "").strip()
    return str(song or "").strip()


def _normalize_cached_songs(value) -> list[dict] | None:
    if isinstance(value, dict) and "song" in value:
        songs = _as_list(value.get("song"))
    else:
        songs = _as_list(value)
    normalized: list[dict] = []
    for song in songs:
        if not isinstance(song, dict):
            title = _song_title(song)
            if title:
                normalized.append({"title": title, "frequency": 1.0, "play_count": 1})
            continue
        title = str(song.get("title") or song.get("name") or "").strip()
        if not title:
            continue
        normalized_song = {**song, "title": title}
        normalized_song.setdefault("frequency", 1.0)
        normalized_song.setdefault("play_count", 1)
        normalized.append(normalized_song)
    return normalized or None


def _api_key() -> str | None:
    env_key = os.environ.get("SETLISTFM_API_KEY")
    if env_key:
        return env_key
    try:
        from crate.db.cache_settings import get_setting

        return get_setting("setlistfm_api_key")
    except Exception:
        log.debug("Could not read Setlist.fm API key from settings", exc_info=True)
        return None


def is_configured() -> bool:
    """Return whether a Setlist.fm API key is available."""
    return bool(_api_key())


def is_shows_sync_enabled() -> bool:
    """Return whether the experimental future-shows sync is explicitly enabled."""
    return os.environ.get("SETLISTFM_SHOWS_SYNC_ENABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def shows_sync_max_artists() -> int:
    """Return the bounded number of artists queried by one shows sync."""
    try:
        configured = int(os.environ.get("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "100"))
    except ValueError:
        configured = 100
    return max(0, min(configured, 1000))


def _api_get(endpoint: str, params: dict | None = None) -> dict | None:
    key = _api_key()
    if not key:
        log.debug("Setlist.fm API key is not configured")
        return None
    try:
        from crate.provider_rate_limits import wait_for_provider_slot

        wait_for_provider_slot("setlistfm", 1.0)
        resp = requests.get(
            f"{SETLISTFM_BASE}/{endpoint}",
            headers={"x-api-key": key, "Accept": "application/json"},
            params=params or {},
            timeout=10,
        )
        if resp.status_code == 429:
            retry_after = (getattr(resp, "headers", {}) or {}).get("Retry-After")
            try:
                retry_after_seconds = float(retry_after or 60)
            except (TypeError, ValueError):
                retry_after_seconds = 60.0
            raise SetlistProviderRateLimited(retry_after_seconds)
        if resp.status_code >= 500:
            raise SetlistProviderUnavailable(
                f"Setlist.fm returned HTTP {resp.status_code}"
            )
        if resp.status_code >= 400:
            log.warning(
                "Setlist.fm API call failed: endpoint=%s status=%s params=%s body=%s",
                endpoint,
                resp.status_code,
                params or {},
                resp.text[:300],
            )
            return None
        return resp.json()
    except (SetlistProviderRateLimited, SetlistProviderUnavailable):
        raise
    except RequestException as exc:
        log.warning(
            "Setlist.fm API request failed: endpoint=%s params=%s error=%s",
            endpoint,
            params or {},
            exc,
        )
        raise SetlistProviderUnavailable("Setlist.fm request failed") from exc
    except ValueError as exc:
        log.warning(
            "Setlist.fm API returned invalid JSON: endpoint=%s params=%s error=%s",
            endpoint,
            params or {},
            exc,
        )
        return None


def search_artist(name: str) -> str | None:
    data = _api_get("search/artists", {"artistName": name, "sort": "relevance"})
    if not data:
        return None
    artists = _as_list(data.get("artist"))
    if not artists:
        return None
    for a in artists:
        if not isinstance(a, dict):
            continue
        if a.get("name", "").lower() == name.lower():
            return a.get("mbid")
    first = artists[0]
    return first.get("mbid") if isinstance(first, dict) else None


def get_setlists(mbid: str, page: int = 1, per_page: int = 20) -> dict | None:
    return _api_get(f"artist/{mbid}/setlists", {"p": page})


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _coordinate(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if math.isfinite(coordinate) else None


def normalize_upcoming_show(
    event: Mapping[str, Any],
    *,
    fallback_artist_name: str | None = None,
    today: date | None = None,
) -> dict[str, Any] | None:
    """Normalize one Setlist.fm event that is dated today or in the future.

    Setlist.fm is primarily a setlist catalogue. The API does not provide the
    ticketing fields needed to represent an on-sale event, so those fields are
    deliberately kept empty in the normalized show.
    """
    event_id = _clean_text(event.get("id"))
    raw_date = _clean_text(event.get("eventDate"))
    if not event_id or not raw_date or not re.fullmatch(r"\d{2}-\d{2}-\d{4}", raw_date):
        return None

    try:
        event_date = datetime.strptime(raw_date, "%d-%m-%Y").date()
    except ValueError:
        return None
    reference_date = today or datetime.now(timezone.utc).date()
    if event_date < reference_date:
        return None

    artist = _mapping(event.get("artist"))
    artist_name = _clean_text(artist.get("name")) or _clean_text(fallback_artist_name)
    venue = _mapping(event.get("venue"))
    venue_name = _clean_text(venue.get("name"))
    if not artist_name or not venue_name:
        return None

    city = _mapping(venue.get("city"))
    country = _mapping(city.get("country"))
    coords = _mapping(city.get("coords"))

    return {
        "external_id": f"setlistfm:{event_id}",
        "artist_name": artist_name,
        "date": event_date.isoformat(),
        "local_time": None,
        "venue": venue_name,
        "address_line1": None,
        "city": _clean_text(city.get("name")),
        "region": _clean_text(city.get("state")) or _clean_text(city.get("stateCode")),
        "postal_code": None,
        "country": _clean_text(country.get("name")),
        "country_code": _clean_text(country.get("code")),
        "latitude": _coordinate(coords.get("lat")),
        "longitude": _coordinate(coords.get("long")),
        "url": _clean_text(event.get("url")),
        "image_url": None,
        "lineup": [artist_name],
        "price_range": None,
        "tickets_url": None,
        "status": "scheduled",
        "source": "setlistfm",
    }


def get_upcoming_shows(
    mbid: str,
    limit: int = 20,
    *,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Return future-dated events already present in Setlist.fm.

    There is no documented upcoming-events endpoint. This makes a bounded
    request to the artist setlists resource and keeps only future-dated rows.
    """
    normalized_mbid = _clean_text(mbid)
    requested_limit = max(0, min(int(limit), 100))
    if not normalized_mbid or requested_limit == 0:
        return []

    page_size = 20
    pages_needed = min(5, max(1, (requested_limit + page_size - 1) // page_size))
    events: dict[str, dict[str, Any]] = {}
    for page in range(1, pages_needed + 1):
        data = get_setlists(normalized_mbid, page=page, per_page=page_size)
        if not data:
            break
        raw_events = _as_list(data.get("setlist"))
        if not raw_events:
            break
        for raw_event in raw_events:
            if not isinstance(raw_event, Mapping):
                continue
            normalized = normalize_upcoming_show(raw_event, today=today)
            if normalized:
                events[normalized["external_id"]] = normalized
        if len(events) >= requested_limit or len(raw_events) < page_size:
            break

    return sorted(
        events.values(), key=lambda item: (item["date"], item["external_id"])
    )[:requested_limit]


def get_cached_probable_setlist(artist_name: str) -> list[dict] | None:
    cached = get_cache(
        _probable_cache_key(artist_name), max_age_seconds=_PROBABLE_TTL_SECONDS
    )
    if not cached:
        return None
    if isinstance(cached, dict):
        return _normalize_cached_songs(cached.get("songs"))
    return _normalize_cached_songs(cached)


def queue_probable_setlist_refresh(artist_name: str) -> str | None:
    task_ids = queue_probable_setlist_refreshes([artist_name])
    return task_ids[0] if task_ids else None


def queue_probable_setlist_refreshes(artist_names: list[str]) -> list[str]:
    """Queue cache refreshes without performing provider I/O in the caller."""
    from crate.db.repositories.tasks import create_task_dedup

    queued: list[str] = []
    seen: set[str] = set()
    for raw_name in artist_names:
        artist_name = _normalized_artist_name(raw_name)
        normalized = artist_name.casefold()
        if not artist_name or normalized in seen:
            continue
        seen.add(normalized)
        if get_cached_probable_setlist(artist_name):
            continue
        status = get_cache(
            _probable_status_key(artist_name),
            max_age_seconds=_NEGATIVE_TTL_SECONDS,
        )
        if isinstance(status, dict) and status.get("status") in {"pending", "missing"}:
            continue
        set_cache(
            _probable_status_key(artist_name),
            {"status": "pending"},
            ttl=_PENDING_TTL_SECONDS,
        )
        task_id = create_task_dedup(
            "refresh_probable_setlist",
            {"artist_name": artist_name},
            dedup_key=normalized,
        )
        if task_id:
            queued.append(task_id)
    return queued


def refresh_probable_setlist(artist_name: str) -> dict:
    """Refresh one probable setlist from a worker-owned provider call."""
    normalized_name = _normalized_artist_name(artist_name)
    songs = get_probable_setlist(normalized_name)
    if songs:
        set_cache(
            _probable_status_key(normalized_name),
            {"status": "ready"},
            ttl=_PROBABLE_TTL_SECONDS,
        )
        return {
            "status": "ready",
            "artist_name": normalized_name,
            "songs": len(songs),
        }
    set_cache(
        _probable_status_key(normalized_name),
        {"status": "missing"},
        ttl=_NEGATIVE_TTL_SECONDS,
    )
    return {"status": "missing", "artist_name": normalized_name, "songs": 0}


def get_probable_setlist(artist_name: str, num_setlists: int = 30) -> list[dict] | None:
    cached = get_cached_probable_setlist(artist_name)
    if cached:
        return cached

    mbid = search_artist(artist_name)
    if not mbid:
        return None

    raw_setlists = _fetch_raw_setlists(mbid, num_setlists)
    if not raw_setlists:
        return None

    # Predict setlist using position-weighted frequency from recent shows
    result = _predict_setlist(raw_setlists)

    if result:
        set_cache(
            _probable_cache_key(artist_name),
            {"songs": result},
            ttl=_PROBABLE_TTL_SECONDS,
        )
    return result


def _fetch_raw_setlists(mbid: str, num_setlists: int) -> list[dict]:
    """Fetch raw setlist data from setlist.fm API."""
    setlists = []
    pages_needed = (num_setlists + 19) // 20

    for page in range(1, pages_needed + 1):
        data = get_setlists(mbid, page=page)
        if not data:
            break
        page_setlists = _as_list(data.get("setlist"))
        if not page_setlists:
            break
        for sl in page_setlists:
            if not isinstance(sl, dict):
                continue
            if len(setlists) >= num_setlists:
                break
            songs = []
            raw_sets = sl.get("sets")
            sets = raw_sets if isinstance(raw_sets, dict) else {}
            for s in _as_list(sets.get("set")):
                if not isinstance(s, dict):
                    continue
                for song in _as_list(s.get("song")):
                    title = _song_title(song)
                    if title:
                        songs.append(title)
            if songs:
                setlists.append(
                    {
                        "date": sl.get("eventDate", ""),
                        "venue": sl.get("venue", {}).get("name", ""),
                        "city": sl.get("venue", {}).get("city", {}).get("name", ""),
                        "tour": sl.get("tour", {}).get("name", ""),
                        "songs": songs,
                    }
                )

    return setlists


def _predict_setlist(setlists: list[dict]) -> list[dict] | None:
    """Predict a probable setlist using position-weighted frequency.

    Uses the last N shows with data. For each position, picks the most
    frequently played song at that slot. Songs already placed are skipped
    so the result has no duplicates. Remaining frequent songs that didn't
    win a position slot are appended at the end.
    """
    if not setlists:
        return None

    from datetime import datetime

    # Track global frequency and last played date
    global_counts: Counter = Counter()
    last_played: dict[str, str] = {}
    for sl in setlists:
        event_date = sl.get("date", "")
        for title in sl.get("songs", []):
            global_counts[title] += 1
            if title not in last_played or event_date > last_played[title]:
                last_played[title] = event_date

    if not global_counts:
        return None

    total_shows = len(setlists)

    # Build position-frequency map from all shows
    max_len = max(len(s["songs"]) for s in setlists)
    position_songs: dict[int, Counter] = {}
    for show in setlists:
        for pos, title in enumerate(show["songs"]):
            if pos not in position_songs:
                position_songs[pos] = Counter()
            position_songs[pos][title] += 1

    # Pass 1: pick the most common song per position
    predicted: list[dict] = []
    used_songs: set[str] = set()

    for pos in range(max_len):
        if pos not in position_songs:
            break
        for title, count in position_songs[pos].most_common():
            if title not in used_songs:
                predicted.append(
                    {
                        "title": title,
                        "frequency": round(global_counts[title] / total_shows, 3),
                        "play_count": global_counts[title],
                        "last_played": last_played.get(title, ""),
                        "position": pos + 1,
                    }
                )
                used_songs.add(title)
                break

    # Pass 2: append remaining frequent songs that didn't win a position
    for title, count in global_counts.most_common():
        if title not in used_songs and count >= 2:
            predicted.append(
                {
                    "title": title,
                    "frequency": round(count / total_shows, 3),
                    "play_count": count,
                    "last_played": last_played.get(title, ""),
                }
            )
            used_songs.add(title)

    # Detect if there's an active tour
    latest_date = setlists[0].get("date", "")
    tour_name = setlists[0].get("tour", "")
    try:
        latest = datetime.strptime(latest_date, "%d-%m-%Y")
        days_ago = (datetime.now() - latest).days
    except (ValueError, TypeError):
        days_ago = 999

    # Add metadata about tour status
    for song in predicted:
        song["on_tour"] = days_ago <= 180
        if tour_name:
            song["tour_name"] = tour_name

    return predicted if predicted else None
