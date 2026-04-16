import json
import os

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.db import get_setting, set_setting, get_db_table_stats, get_cache_stats, delete_cache_prefix, clear_all_cache_tables
from crate.scheduler import get_schedules, set_schedules

router = APIRouter(prefix="/api/settings", tags=["settings"])

VALID_ENRICHMENT_SOURCES = {"lastfm", "spotify", "fanart", "setlistfm", "musicbrainz"}
DEFAULT_ENRICHMENT = '{"lastfm":true,"spotify":true,"fanart":true,"setlistfm":true,"musicbrainz":true}'


class WorkerSettings(BaseModel):
    max_workers: int


class CacheClearRequest(BaseModel):
    type: str


@router.get("")
def get_settings(request: Request):
    _require_admin(request)
    return {
        "schedules": get_schedules(),
        "worker": {"max_workers": int(get_setting("max_workers", "5"))},
        "enrichment": json.loads(get_setting("enrichment_sources", DEFAULT_ENRICHMENT)),
        "cache_stats": get_cache_stats(),
        "db_stats": get_db_table_stats(),
        "library": {
            "path": "/music",
            "storage_layout": "v2-uuid",
            "audio_extensions": json.loads(get_setting("audio_extensions", '[".flac",".mp3",".m4a",".ogg",".opus"]')),
        },
        "processing": {
            "mb_auto_apply_threshold": int(get_setting("mb_auto_apply_threshold", "95")),
            "enrichment_min_age_hours": int(get_setting("enrichment_min_age_hours", "24")),
            "max_track_popularity": int(get_setting("max_track_popularity", "50")),
        },
        "shows": _get_shows_settings(),
        "soulseek": {
            "url": get_setting("slskd_url", os.environ.get("SLSKD_URL", "http://slskd:5030")),
            "quality": get_setting("soulseek_quality", "flac"),
            "min_bitrate": int(get_setting("soulseek_min_bitrate", "320")),
            "username": get_setting("slskd_username", os.environ.get("SLSKD_SLSK_USERNAME", "")),
            "shares_music": get_setting("slskd_shares_music", "true") == "true",
        },
        "telegram": {
            "enabled": get_setting("telegram_enabled", "false") == "true",
            "bot_token": _mask_token(get_setting("telegram_bot_token", "")),
            "chat_id": get_setting("telegram_chat_id", ""),
            "has_token": bool(get_setting("telegram_bot_token", "")),
        },
        "about": _get_about_info(),
    }


def _mask_token(token: str) -> str:
    if not token or len(token) < 10:
        return ""
    return token[:6] + "..." + token[-4:]


def _get_shows_settings() -> dict:
    from crate.db.shows import get_unique_user_cities, get_upcoming_show_counts
    cities = []
    try:
        cities = get_unique_user_cities()
    except Exception:
        pass
    counts = {"show_count": 0, "lastfm_count": 0}
    try:
        counts = get_upcoming_show_counts()
    except Exception:
        pass
    return {
        "lastfm_scraping_enabled": get_setting("lastfm_scraping_enabled", "true") == "true",
        "active_cities": [{"city": c["city"], "country": c.get("country", "")} for c in cities],
        "upcoming_shows": counts["show_count"],
        "lastfm_shows": counts["lastfm_count"],
    }


def _get_about_info() -> dict:
    import os
    import subprocess

    git_commit = "unknown"
    try:
        result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            git_commit = result.stdout.strip()
    except Exception:
        pass

    from crate.db import get_library_stats, get_library_track_count
    track_count = get_library_track_count()
    stats = get_library_stats() if track_count > 0 else {}

    import time
    _start_time = getattr(_get_about_info, "_start", None)
    if not _start_time:
        _get_about_info._start = time.time()
        _start_time = _get_about_info._start
    uptime_sec = int(time.time() - _start_time)

    return {
        "version": "1.0.0",
        "git_commit": git_commit,
        "python": os.sys.version.split()[0],
        "uptime_seconds": uptime_sec,
        "artists": stats.get("artists", 0),
        "albums": stats.get("albums", 0),
        "tracks": stats.get("tracks", 0),
        "total_size_gb": round(stats.get("total_size", 0) / (1024**3), 2) if stats.get("total_size") else 0,
    }


@router.put("/schedules")
def update_schedules(request: Request, body: dict[str, int]):
    _require_admin(request)
    for key, val in body.items():
        if not isinstance(val, int) or val < 0:
            raise HTTPException(status_code=422, detail=f"Invalid interval for '{key}': must be int >= 0")
    set_schedules(body)
    return {"ok": True}


@router.put("/worker")
def update_worker(request: Request, body: WorkerSettings):
    _require_admin(request)
    if body.max_workers < 1 or body.max_workers > 10:
        raise HTTPException(status_code=422, detail="max_workers must be between 1 and 10")
    set_setting("max_workers", str(body.max_workers))
    return {"ok": True}


@router.put("/enrichment")
def update_enrichment(request: Request, body: dict[str, bool]):
    _require_admin(request)
    invalid = set(body.keys()) - VALID_ENRICHMENT_SOURCES
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid sources: {', '.join(sorted(invalid))}")
    set_setting("enrichment_sources", json.dumps(body))
    return {"ok": True}


@router.post("/cache/clear")
def clear_cache(request: Request, body: CacheClearRequest):
    _require_admin(request)
    cache_type = body.type
    valid_types = {"all", "enrichment", "lastfm", "analytics"}
    if cache_type not in valid_types:
        raise HTTPException(status_code=422, detail=f"Invalid cache type: must be one of {', '.join(sorted(valid_types))}")

    # Clear Redis + PostgreSQL
    if cache_type == "all":
        delete_cache_prefix("")  # all cache keys
        clear_all_cache_tables()
        # Clear all Redis mb: keys
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r:
            try:
                cursor = 0
                while True:
                    cursor, keys = r.scan(cursor, match="mb:*", count=100)
                    if keys:
                        r.delete(*keys)
                    if cursor == 0:
                        break
            except Exception:
                pass
    elif cache_type == "enrichment":
        delete_cache_prefix("enrichment:")
    elif cache_type == "lastfm":
        delete_cache_prefix("lastfm:")
    elif cache_type == "analytics":
        from crate.db import delete_cache
        delete_cache("analytics")
        delete_cache("stats")

    return {"ok": True, "type": cache_type}


@router.put("/library")
def update_library(request: Request, body: dict):
    _require_admin(request)
    if "audio_extensions" in body:
        if not isinstance(body["audio_extensions"], list):
            raise HTTPException(status_code=422, detail="audio_extensions must be a list")
        set_setting("audio_extensions", json.dumps(body["audio_extensions"]))
    return {"ok": True}


@router.put("/processing")
def update_processing(request: Request, body: dict):
    _require_admin(request)
    if "mb_auto_apply_threshold" in body:
        val = int(body["mb_auto_apply_threshold"])
        if val < 50 or val > 100:
            raise HTTPException(status_code=422, detail="Threshold must be 50-100")
        set_setting("mb_auto_apply_threshold", str(val))
    if "enrichment_min_age_hours" in body:
        val = int(body["enrichment_min_age_hours"])
        if val < 1 or val > 168:
            raise HTTPException(status_code=422, detail="Must be 1-168 hours")
        set_setting("enrichment_min_age_hours", str(val))
    if "max_track_popularity" in body:
        val = int(body["max_track_popularity"])
        if val < 10 or val > 500:
            raise HTTPException(status_code=422, detail="Must be 10-500")
        set_setting("max_track_popularity", str(val))
    return {"ok": True}


@router.put("/telegram")
def update_telegram(request: Request, body: dict):
    _require_admin(request)
    if "bot_token" in body:
        token = (body["bot_token"] or "").strip()
        if token and "..." not in token:
            set_setting("telegram_bot_token", token)
    if "enabled" in body:
        set_setting("telegram_enabled", "true" if body["enabled"] else "false")
    if "chat_id" in body:
        set_setting("telegram_chat_id", str(body["chat_id"]).strip())
    return {"ok": True}


@router.post("/telegram/test")
def test_telegram(request: Request):
    _require_admin(request)
    from crate.telegram import send_message
    ok = send_message("\u2705 Crate bot test — connection working!")
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to send message. Check bot token and chat ID.")
    return {"ok": True}


@router.put("/shows")
def update_shows_settings(request: Request, body: dict):
    _require_admin(request)
    if "lastfm_scraping_enabled" in body:
        set_setting("lastfm_scraping_enabled", "true" if body["lastfm_scraping_enabled"] else "false")
    return {"ok": True}


@router.post("/shows/sync-lastfm")
def trigger_lastfm_sync(request: Request, body: dict | None = None):
    """Manually trigger Last.fm scrape for a specific city or all user cities."""
    _require_admin(request)
    from crate.db import create_task
    from crate.db.shows import get_unique_user_cities

    payload = body or {}
    city = (payload.get("city") or "").strip()

    if city:
        from crate.geolocation import geocode_city
        geo = geocode_city(city)
        if not geo:
            raise HTTPException(status_code=422, detail=f"Could not geocode city: {city}")
        task_id = create_task("sync_shows_lastfm", {
            "city": geo["city"],
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
        })
        return {"task_id": task_id, "city": geo["city"]}

    cities = get_unique_user_cities()
    task_ids = []
    for c in cities:
        tid = create_task("sync_shows_lastfm", {
            "city": c["city"],
            "latitude": c["latitude"],
            "longitude": c["longitude"],
        })
        task_ids.append(tid)
    return {"task_ids": task_ids, "cities": [c["city"] for c in cities]}


@router.put("/soulseek")
def update_soulseek(request: Request, body: dict):
    _require_admin(request)
    if "url" in body:
        set_setting("slskd_url", body["url"])
    if "quality" in body:
        valid = ("flac", "flac_320", "any")
        if body["quality"] not in valid:
            raise HTTPException(status_code=422, detail=f"quality must be one of {valid}")
        set_setting("soulseek_quality", body["quality"])
    if "min_bitrate" in body:
        set_setting("soulseek_min_bitrate", str(int(body["min_bitrate"])))
    if "username" in body:
        set_setting("slskd_username", body["username"])
    if "shares_music" in body:
        set_setting("slskd_shares_music", "true" if body["shares_music"] else "false")
    return {"ok": True}
