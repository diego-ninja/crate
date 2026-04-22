import re as _re

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.analytics import (
    ActivityLiveResponse,
    ActivityRecentResponse,
    AnalyticsOverviewResponse,
    ArtistStatsResponse,
    InsightsResponse,
    MissingAlbumsResponse,
    QualityReportResponse,
    StatsResponse,
    TimelineResponse,
)
from crate.missing import find_missing_albums
from crate.quality import quality_report
from crate.audio import read_tags, get_audio_files
from crate.api._deps import artist_name_from_id, library_path, extensions, safe_path, get_config
from crate.db import (
    list_tasks, get_latest_scan, get_library_stats, get_library_track_count,
    get_setting,
)
from crate.db.queries.analytics import (
    get_genre_distribution,
    get_decade_distribution,
    get_format_distribution,
    get_bitrate_distribution,
    get_top_artists_by_albums,
    get_total_duration_hours,
    get_sizes_by_format_gb,
    get_avg_tracks_per_album,
    get_stats_duration_hours,
    get_stats_avg_bitrate,
    get_stats_top_genres,
    get_stats_recent_albums,
    get_stats_analyzed_track_count,
    get_stats_avg_album_duration_min,
    get_timeline_albums,
    get_artist_format_distribution,
    get_artist_albums_timeline,
    get_artist_audio_by_album,
    get_artist_top_tracks,
    get_artist_genre_tags,
    get_insights_countries,
    get_insights_bpm_distribution,
    get_insights_energy_danceability,
    get_insights_top_genres,
    get_insights_popularity,
    get_insights_albums_by_year,
    get_insights_feature_coverage,
    get_insights_top_albums,
    get_insights_acoustic_instrumental,
    get_insights_artist_depth,
)
from crate.importer import ImportQueue

router = APIRouter(tags=["analytics"])

_ANALYTICS_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested analytics resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_year_re = _re.compile(r"^\d{4}\s*[-–]\s*")


def _has_library_data() -> bool:
    return get_library_track_count() > 0


@router.get(
    "/api/analytics",
    response_model=AnalyticsOverviewResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the analytics overview for the library",
)
def api_analytics(request: Request):
    _require_auth(request)
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

    return {
        "genres": get_genre_distribution(),
        "decades": get_decade_distribution(),
        "formats": get_format_distribution(),
        "bitrates": get_bitrate_distribution(),
        "top_artists": get_top_artists_by_albums(),
        "total_duration_hours": get_total_duration_hours(),
        "sizes_by_format_gb": get_sizes_by_format_gb(),
        "avg_tracks_per_album": get_avg_tracks_per_album(),
    }


@router.get(
    "/api/activity/recent",
    response_model=ActivityRecentResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List recent background activity",
)
def api_activity_recent(request: Request):
    _require_auth(request)
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


@router.get(
    "/api/stats",
    response_model=StatsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get library statistics for dashboards",
)
def api_stats(request: Request):
    _require_auth(request)
    if _has_library_data():
        stats = get_library_stats()
        scan = get_latest_scan()
        config = get_config()
        queue = ImportQueue(config)
        pending_imports = len(queue.scan_pending())
        pending_tasks = len(list_tasks(status="pending"))

        total_duration_hours = get_stats_duration_hours()
        avg_bitrate = get_stats_avg_bitrate()
        top_genres = get_stats_top_genres()
        raw_albums = get_stats_recent_albums()
        recent_albums = [
            {"id": r["id"], "slug": r["slug"], "artist": r["artist"], "artist_id": r["artist_id"], "artist_slug": r["artist_slug"], "name": r["name"],
             "display_name": _year_re.sub("", r["name"]),
             "year": r["year"]}
            for r in raw_albums
        ]
        analyzed_tracks = get_stats_analyzed_track_count()
        avg_album_duration_min = get_stats_avg_album_duration_min()

        return {
            "artists": stats["artists"],
            "albums": stats["albums"],
            "tracks": stats["tracks"],
            "formats": stats["formats"],
            "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
            "last_scan": scan["scanned_at"] if scan else None,
            "pending_imports": pending_imports,
            "pending_tasks": pending_tasks,
            "total_duration_hours": total_duration_hours,
            "avg_bitrate": avg_bitrate,
            "top_genres": top_genres,
            "recent_albums": recent_albums,
            "analyzed_tracks": analyzed_tracks,
            "avg_album_duration_min": avg_album_duration_min,
            "avg_tracks_per_album": round(stats["tracks"] / stats["albums"], 1) if stats["albums"] else 0,
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


DEFAULT_MAX_WORKERS = 3


@router.get(
    "/api/activity/live",
    response_model=ActivityLiveResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get live worker and task activity",
)
def api_activity_live(request: Request):
    _require_auth(request)
    running = list_tasks(status="running")
    running_tasks = []
    for t in running:
        progress = t.get("progress", "")
        running_tasks.append({"id": t["id"], "type": t["type"], "progress": progress})

    recent = list_tasks(limit=10)
    recent_tasks = [
        {"id": t["id"], "type": t["type"], "status": t["status"], "updated_at": t["updated_at"]}
        for t in recent
    ]

    max_workers = int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS)
    worker_slots = {"max": max_workers, "active": len(running)}

    # System health checks
    pg_ok = True  # if we got here, postgres is up
    watcher_ok = True  # watcher runs in-process with worker

    return {
        "running_tasks": running_tasks,
        "recent_tasks": recent_tasks,
        "worker_slots": worker_slots,
        "systems": {
            "postgres": pg_ok,
            "watcher": watcher_ok,
        },
    }


@router.get(
    "/api/timeline",
    response_model=TimelineResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the album release timeline",
)
def api_timeline(request: Request):
    _require_auth(request)
    if _has_library_data():
        rows = get_timeline_albums()

        years: dict[str, list[dict]] = {}
        for r in rows:
            year = r["year"][:4] if r["year"] else ""
            if year and year.isdigit():
                years.setdefault(year, []).append({
                    "id": r["id"],
                    "slug": r["slug"],
                    "artist": r["artist"],
                    "artist_id": r["artist_id"],
                    "artist_slug": r["artist_slug"],
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


@router.get(
    "/api/quality",
    response_model=QualityReportResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the library quality report",
)
def api_quality(request: Request):
    _require_auth(request)
    lib = library_path()
    exts = extensions()
    report = quality_report(lib, exts)
    return report


def api_missing_albums(request: Request, artist: str):
    _require_auth(request)
    lib = library_path()
    artist_dir = safe_path(lib, artist)
    if not artist_dir or not artist_dir.is_dir():
        raise HTTPException(status_code=404, detail="Artist not found")

    exts = extensions()
    result = find_missing_albums(artist_dir, exts)
    return result


@router.get(
    "/api/artists/{artist_id}/missing",
    response_model=MissingAlbumsResponse,
    responses=_ANALYTICS_RESPONSES,
    summary="Get missing-album analysis for an artist",
)
def api_missing_albums_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return api_missing_albums(request, artist_name)


@router.get(
    "/api/missing-search",
    response_model=MissingAlbumsResponse,
    responses=_ANALYTICS_RESPONSES,
    summary="Search missing albums by artist name",
)
def api_missing_albums_search(request: Request, q: str = Query("")):
    _require_auth(request)
    query = q.strip()
    if not query:
        raise HTTPException(status_code=404, detail="Artist not found")
    return api_missing_albums(request, query)


def api_artist_stats(request: Request, name: str):
    """Stats for a single artist: format split, year timeline, audio features."""
    _require_auth(request)
    # Resolve canonical name (case-insensitive)
    from crate.db import get_library_artist
    db_artist = get_library_artist(name)
    canonical = db_artist["name"] if db_artist else name

    return {
        "formats": get_artist_format_distribution(canonical),
        "albums_timeline": get_artist_albums_timeline(canonical),
        "audio_by_album": get_artist_audio_by_album(canonical),
        "top_tracks_by_popularity": get_artist_top_tracks(canonical),
        "genres": get_artist_genre_tags(canonical),
    }


@router.get(
    "/api/artists/{artist_id}/stats",
    response_model=ArtistStatsResponse,
    responses=_ANALYTICS_RESPONSES,
    summary="Get analytics for a single artist",
)
def api_artist_stats_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return api_artist_stats(request, artist_name)


@router.get(
    "/api/insights",
    response_model=InsightsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get advanced insights for charts and dashboards",
)
def api_insights(request: Request):
    """High-signal analytics for the Insights page."""
    _require_auth(request)

    countries = get_insights_countries()
    bpm_dist = get_insights_bpm_distribution()
    energy_dance = get_insights_energy_danceability()
    top_genres = get_insights_top_genres()
    popularity = get_insights_popularity()
    feature_coverage = get_insights_feature_coverage()
    artist_depth = get_insights_artist_depth()

    # Albums per decade
    albums_rows = get_insights_albums_by_year()
    albums_by_decade: dict[str, int] = {}
    for r in albums_rows:
        y = r["year"][:4] if r["year"] and len(r["year"]) >= 4 else r["year"]
        try:
            decade = f"{int(y) // 10 * 10}s"
            albums_by_decade[decade] = albums_by_decade.get(decade, 0) + r["cnt"]
        except (ValueError, TypeError):
            pass

    raw_top_albums = get_insights_top_albums()

    def _strip_year_prefix(name: str) -> str:
        return _year_re.sub("", name)

    top_albums = [
        {
            "album": _strip_year_prefix(r["name"]),
            "artist": r["artist"],
            "listeners": r["lastfm_listeners"] or 0,
            "popularity": r["popularity"] or (round((r["popularity_score"] or 0) * 100) if r.get("popularity_score") is not None else 0),
            "popularity_score": round(r["popularity_score"], 4) if r.get("popularity_score") is not None else None,
            "year": r["year"],
        }
        for r in raw_top_albums
    ]

    acoustic_instrumental = get_insights_acoustic_instrumental()

    return {
        "countries": countries,
        "bpm_distribution": bpm_dist,
        "energy_danceability": energy_dance,
        "top_genres": top_genres,
        "popularity": popularity,
        "albums_by_decade": albums_by_decade,
        "feature_coverage": feature_coverage,
        "artist_depth": artist_depth,
        "top_albums": top_albums,
        "acoustic_instrumental": acoustic_instrumental,
    }
