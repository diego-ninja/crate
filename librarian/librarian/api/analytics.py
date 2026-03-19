from fastapi import APIRouter
from fastapi.responses import JSONResponse

from librarian.analytics import compute_analytics
from librarian.missing import find_missing_albums
from librarian.quality import quality_report
from librarian.audio import read_tags, get_audio_files
from librarian.api._deps import library_path, extensions, safe_path, get_config
from librarian.db import list_tasks, get_latest_scan, get_cache, set_cache, create_task
from librarian.importer import ImportQueue

router = APIRouter()

_ANALYTICS_TTL = 3600  # 1 hour
_STATS_TTL = 300       # 5 minutes


@router.get("/api/analytics")
def api_analytics():
    cached = get_cache("analytics", max_age_seconds=_ANALYTICS_TTL)
    if cached:
        return cached

    # Don't compute synchronously — it takes minutes for large libraries.
    # Trigger worker computation and return empty placeholder.
    pending = list_tasks(status="pending", task_type="compute_analytics", limit=1)
    running = list_tasks(status="running", task_type="compute_analytics", limit=1)
    if not pending and not running:
        create_task("compute_analytics")

    return {"computing": True, "formats": {}, "decades": {}, "top_artists": [], "bitrates": {}, "genres": {}, "sizes_by_format_gb": {}, "avg_tracks_per_album": 0, "total_duration_hours": 0}


@router.get("/api/activity/recent")
def api_activity_recent():
    tasks = list_tasks(limit=10)
    recent = [
        {
            "id": t["id"],
            "type": t["type"],
            "status": t["status"],
            "created_at": t["created_at"],
            "updated_at": t["updated_at"],
        }
        for t in tasks
    ]

    config = get_config()
    queue = ImportQueue(config)
    pending_imports = len(queue.scan_pending())

    scan = get_latest_scan()
    last_scan = scan["scanned_at"] if scan else None

    return {
        "tasks": recent,
        "pending_imports": pending_imports,
        "last_scan": last_scan,
    }


@router.get("/api/stats")
def api_stats():
    cached = get_cache("stats", max_age_seconds=_STATS_TTL)
    if cached:
        # Refresh dynamic fields from DB
        scan = get_latest_scan()
        cached["last_scan"] = scan["scanned_at"] if scan else cached.get("last_scan")
        cached["pending_tasks"] = len(list_tasks(status="pending"))
        return cached

    # Compute stats inline (usually fast enough, ~2-5s for 48K tracks)
    lib = library_path()
    exts = extensions()
    artists = albums = tracks = total_size = 0
    formats = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        artists += 1
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            albums += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    tracks += 1
                    ext = f.suffix.lower()
                    formats[ext] = formats.get(ext, 0) + 1
                    total_size += f.stat().st_size

    config = get_config()
    queue = ImportQueue(config)
    pending_imports = len(queue.scan_pending())

    pending_tasks = len(list_tasks(status="pending"))

    scan = get_latest_scan()
    last_scan = scan["scanned_at"] if scan else None

    data = {
        "artists": artists, "albums": albums, "tracks": tracks,
        "formats": formats, "total_size_gb": round(total_size / (1024**3), 2),
        "last_scan": last_scan,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
    }
    set_cache("stats", data)
    return data


_TIMELINE_TTL = 3600  # 1 hour


@router.get("/api/timeline")
def api_timeline():
    cached = get_cache("timeline", max_age_seconds=_TIMELINE_TTL)
    if cached:
        return cached

    lib = library_path()
    exts = extensions()
    years: dict[str, list[dict]] = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir():
                continue
            tracks = get_audio_files(album_dir, exts)
            if not tracks:
                continue
            tags = read_tags(tracks[0])
            year = tags.get("date", "")[:4]
            if year and year.isdigit():
                years.setdefault(year, []).append({
                    "artist": artist_dir.name,
                    "album": album_dir.name,
                    "tracks": len(tracks),
                })

    result = {y: albums for y, albums in sorted(years.items())}
    set_cache("timeline", result)
    return result


@router.get("/api/quality")
def api_quality():
    lib = library_path()
    exts = extensions()
    report = quality_report(lib, exts)
    return report


@router.get("/api/missing/{artist:path}")
def api_missing_albums(artist: str):
    lib = library_path()
    artist_dir = safe_path(lib, artist)
    if not artist_dir or not artist_dir.is_dir():
        return JSONResponse({"error": "Artist not found"}, status_code=404)

    exts = extensions()
    result = find_missing_albums(artist_dir, exts)
    return result
