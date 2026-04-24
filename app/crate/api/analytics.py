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
from crate.api._deps import artist_name_from_id, library_path, extensions, safe_path
from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.repositories.library import get_library_artist, get_library_track_count
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.analytics import (
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
from crate.db.queries.tasks import list_tasks

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


def _get_imports_pending_count() -> int:
    return count_import_queue_items(status="pending")


@router.get(
    "/api/analytics",
    response_model=AnalyticsOverviewResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the analytics overview for the library",
)
def api_analytics(request: Request):
    _require_auth(request)
    return get_cached_ops_snapshot().get("analytics", {})


@router.get(
    "/api/activity/recent",
    response_model=ActivityRecentResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List recent background activity",
)
def api_activity_recent(request: Request):
    _require_auth(request)
    return get_cached_ops_snapshot().get("recent", {})


@router.get(
    "/api/stats",
    response_model=StatsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get library statistics for dashboards",
)
def api_stats(request: Request):
    _require_auth(request)
    snapshot_stats = get_cached_ops_snapshot().get("stats")
    if snapshot_stats:
        return snapshot_stats
    return {
        "artists": 0,
        "albums": 0,
        "tracks": 0,
        "formats": {},
        "total_size_gb": 0,
        "last_scan": None,
        "pending_imports": _get_imports_pending_count(),
        "pending_tasks": len(list_tasks(status="pending")),
        "total_duration_hours": 0,
        "avg_bitrate": 0,
        "top_genres": [],
        "recent_albums": [],
        "analyzed_tracks": 0,
        "avg_album_duration_min": 0,
        "avg_tracks_per_album": 0,
    }

@router.get(
    "/api/activity/live",
    response_model=ActivityLiveResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get live worker and task activity",
)
def api_activity_live(request: Request):
    _require_auth(request)
    return get_cached_ops_snapshot().get("live", {})


@router.get(
    "/api/timeline",
    response_model=TimelineResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the album release timeline",
)
def api_timeline(request: Request):
    _require_auth(request)
    if not _has_library_data():
        return {}

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
