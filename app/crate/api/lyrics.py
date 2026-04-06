import logging

import requests
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.db import get_cache, set_cache

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/lyrics")
def api_lyrics(request: Request, artist: str = Query(""), title: str = Query("")):
    _require_auth(request)
    if not artist.strip() or not title.strip():
        return JSONResponse({"error": "artist and title required"}, status_code=400)

    cache_key = f"lyrics:{artist.lower().strip()}:{title.lower().strip()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 30)
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            "https://lrclib.net/api/get",
            params={"artist_name": artist.strip(), "track_name": title.strip()},
            timeout=10,
            headers={"User-Agent": "Crate/1.0"},
        )
        if resp.status_code != 200:
            return {"syncedLyrics": None, "plainLyrics": None}

        data = resp.json()
        result = {
            "syncedLyrics": data.get("syncedLyrics"),
            "plainLyrics": data.get("plainLyrics"),
        }
        set_cache(cache_key, result, ttl=86400 * 30)
        return result
    except Exception:
        log.debug("Lyrics fetch failed for %s - %s", artist, title, exc_info=True)
        return {"syncedLyrics": None, "plainLyrics": None}
