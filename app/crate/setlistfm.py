import os
import logging
from collections import Counter

import requests

from crate.db.cache_store import get_cache, set_cache

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

    raw_setlists = _fetch_raw_setlists(mbid, num_setlists)
    if not raw_setlists:
        return None

    # Predict setlist using position-weighted frequency from recent shows
    result = _predict_setlist(raw_setlists)

    if result:
        set_cache(cache_key, {"songs": result}, ttl=604800)
    return result


def _fetch_raw_setlists(mbid: str, num_setlists: int) -> list[dict]:
    """Fetch raw setlist data from setlist.fm API."""
    setlists = []
    pages_needed = (num_setlists + 19) // 20

    for page in range(1, pages_needed + 1):
        data = get_setlists(mbid, page=page)
        if not data:
            break
        page_setlists = data.get("setlist", [])
        if not page_setlists:
            break
        for sl in page_setlists:
            if len(setlists) >= num_setlists:
                break
            songs = []
            for s in sl.get("sets", {}).get("set", []):
                for song in s.get("song", []):
                    title = song.get("name", "").strip()
                    if title:
                        songs.append(title)
            if songs:
                setlists.append({
                    "date": sl.get("eventDate", ""),
                    "venue": sl.get("venue", {}).get("name", ""),
                    "city": sl.get("venue", {}).get("city", {}).get("name", ""),
                    "tour": sl.get("tour", {}).get("name", ""),
                    "songs": songs,
                })

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
                predicted.append({
                    "title": title,
                    "frequency": round(global_counts[title] / total_shows, 3),
                    "play_count": global_counts[title],
                    "last_played": last_played.get(title, ""),
                    "position": pos + 1,
                })
                used_songs.add(title)
                break

    # Pass 2: append remaining frequent songs that didn't win a position
    for title, count in global_counts.most_common():
        if title not in used_songs and count >= 2:
            predicted.append({
                "title": title,
                "frequency": round(count / total_shows, 3),
                "play_count": count,
                "last_played": last_played.get(title, ""),
            })
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
