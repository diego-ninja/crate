import os
import logging
from collections import Counter

import requests

from musicdock.db import get_cache, set_cache

log = logging.getLogger(__name__)

SETLISTFM_BASE = "https://api.setlist.fm/rest/1.0"


def _api_key() -> str | None:
    return os.environ.get("SETLISTFM_API_KEY")


def _api_get(endpoint: str, params: dict | None = None) -> dict | None:
    key = _api_key()
    if not key:
        return None
    try:
        resp = requests.get(
            f"{SETLISTFM_BASE}/{endpoint}",
            headers={"x-api-key": key, "Accept": "application/json"},
            params=params or {},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        log.debug("Setlist.fm API call failed: %s", endpoint)
        return None


def search_artist(name: str) -> str | None:
    data = _api_get("search/artists", {"artistName": name, "sort": "relevance"})
    if not data:
        return None
    artists = data.get("artist", [])
    if not artists:
        return None
    for a in artists:
        if a.get("name", "").lower() == name.lower():
            return a.get("mbid")
    return artists[0].get("mbid")


def get_setlists(mbid: str, page: int = 1, per_page: int = 20) -> dict | None:
    return _api_get(f"artist/{mbid}/setlists", {"p": page})


def get_probable_setlist(artist_name: str, num_setlists: int = 30) -> list[dict] | None:
    cache_key = f"setlistfm:probable:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 7)
    if cached:
        return cached.get("songs")

    mbid = search_artist(artist_name)
    if not mbid:
        return None

    all_songs: list[str] = []
    last_played: dict[str, str] = {}
    pages_needed = (num_setlists + 19) // 20
    total_fetched = 0

    for page in range(1, pages_needed + 1):
        data = get_setlists(mbid, page=page)
        if not data:
            break
        setlists = data.get("setlist", [])
        if not setlists:
            break

        for sl in setlists:
            if total_fetched >= num_setlists:
                break
            total_fetched += 1
            event_date = sl.get("eventDate", "")
            for s in sl.get("sets", {}).get("set", []):
                for song in s.get("song", []):
                    title = song.get("name", "").strip()
                    if not title:
                        continue
                    all_songs.append(title)
                    if title not in last_played or event_date > last_played[title]:
                        last_played[title] = event_date

    if not all_songs:
        return None

    counts = Counter(all_songs)
    total = total_fetched or 1
    result = []
    for title, play_count in counts.most_common():
        result.append({
            "title": title,
            "frequency": round(play_count / total, 3),
            "play_count": play_count,
            "last_played": last_played.get(title, ""),
        })

    set_cache(cache_key, {"songs": result})
    return result
