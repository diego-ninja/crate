import os
import logging
import time

import requests

from musicdock.db import get_cache, set_cache

log = logging.getLogger(__name__)

_token: str | None = None
_token_expires: float = 0


def _get_token() -> str | None:
    global _token, _token_expires

    if _token and time.time() < _token_expires:
        return _token

    client_id = os.environ.get("SPOTIFY_ID")
    client_secret = os.environ.get("SPOTIFY_SECRET")
    if not client_id or not client_secret:
        return None

    try:
        resp = requests.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _token = data["access_token"]
        _token_expires = time.time() + data.get("expires_in", 3600) - 60
        return _token
    except Exception:
        log.debug("Spotify token request failed")
        return None


def _api_get(endpoint: str, params: dict | None = None) -> dict | None:
    token = _get_token()
    if not token:
        return None
    try:
        resp = requests.get(
            f"https://api.spotify.com/v1/{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 403:
            log.warning("Spotify API 403: Premium subscription required")
        else:
            log.debug("Spotify API call failed: %s %s", endpoint, e)
        return None
    except Exception as e:
        log.debug("Spotify API call failed: %s %s", endpoint, e)
        return None


def search_artist(name: str) -> dict | None:
    cache_key = f"spotify:artist:{name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached

    data = _api_get("search", {"q": name, "type": "artist", "limit": 1})
    if not data:
        return None

    items = data.get("artists", {}).get("items", [])
    if not items:
        return None

    artist = items[0]
    result = {
        "id": artist["id"],
        "name": artist["name"],
        "popularity": artist.get("popularity", 0),
        "followers": artist.get("followers", {}).get("total", 0),
        "genres": artist.get("genres", []),
        "images": artist.get("images", []),
    }

    set_cache(cache_key, result)
    return result


def get_top_tracks(spotify_id: str, market: str = "ES") -> list[dict] | None:
    cache_key = f"spotify:top_tracks:{spotify_id}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached.get("tracks")

    data = _api_get(f"artists/{spotify_id}/top-tracks", {"market": market})
    if not data:
        return None

    tracks = []
    for t in data.get("tracks", []):
        tracks.append({
            "name": t["name"],
            "album": t.get("album", {}).get("name", ""),
            "duration_ms": t.get("duration_ms", 0),
            "popularity": t.get("popularity", 0),
            "preview_url": t.get("preview_url"),
            "id": t["id"],
        })

    set_cache(cache_key, {"tracks": tracks})
    return tracks


def get_related_artists(spotify_id: str) -> list[dict] | None:
    cache_key = f"spotify:related:{spotify_id}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached.get("artists")

    data = _api_get(f"artists/{spotify_id}/related-artists")
    if not data:
        return None

    artists = []
    for a in data.get("artists", []):
        artists.append({
            "name": a["name"],
            "id": a["id"],
            "images": a.get("images", []),
            "genres": a.get("genres", []),
            "popularity": a.get("popularity", 0),
        })

    set_cache(cache_key, {"artists": artists})
    return artists
