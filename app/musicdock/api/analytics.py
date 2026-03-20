from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock.missing import find_missing_albums
from musicdock.quality import quality_report
from musicdock.audio import read_tags, get_audio_files
from musicdock.api._deps import library_path, extensions, safe_path, get_config
from musicdock.db import (
    list_tasks, get_latest_scan, get_library_stats, get_library_track_count,
    get_db_ctx,
)
from musicdock.importer import ImportQueue

router = APIRouter()


def _has_library_data() -> bool:
    return get_library_track_count() > 0


@router.get("/api/analytics")
def api_analytics():
    if not _has_library_data():
        return {
            "computing": True,
            "formats": {},
            "decades": {},
            "top_artists": [],
            "bitrates": {},
            "genres": {},
            "sizes_by_format_gb": {},
            "avg_tracks_per_album": 0,
            "total_duration_hours": 0,
        }

    with get_db_ctx() as cur:
        # Genres
        cur.execute(
            "SELECT genre, COUNT(*) as c FROM library_tracks WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY c DESC LIMIT 30"
        )
        genres = {r["genre"]: r["c"] for r in cur.fetchall()}

        # Decades
        cur.execute(
            "SELECT (CAST(year AS INTEGER)/10)*10 || 's' as decade, COUNT(*) as c FROM library_tracks WHERE year IS NOT NULL AND year != '' AND length(year) >= 4 GROUP BY decade ORDER BY decade"
        )
        decades = {r["decade"]: r["c"] for r in cur.fetchall()}

        # Formats
        cur.execute(
            "SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        formats = {r["format"]: r["c"] for r in cur.fetchall()}

        # Bitrates (bucketed)
        cur.execute("""
            SELECT
                CASE
                    WHEN bitrate IS NULL OR bitrate = 0 THEN 'unknown'
                    WHEN bitrate < 128000 THEN '<128k'
                    WHEN bitrate < 192000 THEN '128-191k'
                    WHEN bitrate < 256000 THEN '192-255k'
                    WHEN bitrate < 320000 THEN '256-319k'
                    WHEN bitrate = 320000 THEN '320k'
                    ELSE '>320k'
                END as bucket,
                COUNT(*) as c
            FROM library_tracks GROUP BY 1 ORDER BY 1
        """)
        bitrates = {r["bucket"]: r["c"] for r in cur.fetchall()}

        # Top artists by album count
        cur.execute(
            "SELECT artist, COUNT(DISTINCT name) as albums FROM library_albums GROUP BY artist ORDER BY albums DESC LIMIT 25"
        )
        top_artists = [{"name": r["artist"], "albums": r["albums"]} for r in cur.fetchall()]

        # Total duration
        cur.execute("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")
        dur_row = cur.fetchone()
        total_duration_hours = round(dur_row["total"] / 3600, 1) if dur_row["total"] else 0

        # Sizes by format
        cur.execute(
            "SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        sizes_by_format_gb = {r["format"]: round(r["total"] / (1024**3), 2) for r in cur.fetchall() if r["total"]}

        # Avg tracks per album
        cur.execute("SELECT COUNT(*) AS cnt FROM library_albums")
        album_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        track_count = cur.fetchone()["cnt"]
        avg_tracks = round(track_count / album_count, 1) if album_count else 0

    return {
        "genres": genres,
        "decades": decades,
        "formats": formats,
        "bitrates": bitrates,
        "top_artists": top_artists,
        "total_duration_hours": total_duration_hours,
        "sizes_by_format_gb": sizes_by_format_gb,
        "avg_tracks_per_album": avg_tracks,
    }


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
    if _has_library_data():
        stats = get_library_stats()
        scan = get_latest_scan()
        config = get_config()
        queue = ImportQueue(config)
        pending_imports = len(queue.scan_pending())
        pending_tasks = len(list_tasks(status="pending"))

        return {
            "artists": stats["artists"],
            "albums": stats["albums"],
            "tracks": stats["tracks"],
            "formats": stats["formats"],
            "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
            "last_scan": scan["scanned_at"] if scan else None,
            "pending_imports": pending_imports,
            "pending_tasks": pending_tasks,
        }

    # Fallback to filesystem
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

    return {
        "artists": artists, "albums": albums, "tracks": tracks,
        "formats": formats, "total_size_gb": round(total_size / (1024**3), 2),
        "last_scan": last_scan,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
    }


@router.get("/api/timeline")
def api_timeline():
    if _has_library_data():
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT year, artist, name, track_count FROM library_albums WHERE year IS NOT NULL AND year != '' ORDER BY year"
            )
            rows = cur.fetchall()

        years: dict[str, list[dict]] = {}
        for r in rows:
            year = r["year"][:4] if r["year"] else ""
            if year and year.isdigit():
                years.setdefault(year, []).append({
                    "artist": r["artist"],
                    "album": r["name"],
                    "tracks": r["track_count"],
                })
        return {y: albums for y, albums in sorted(years.items())}

    # Fallback to filesystem
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

    return {y: albums for y, albums in sorted(years.items())}


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
