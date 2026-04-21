"""Admin-only endpoints for metrics, worker logs, and health summary."""

from fastapi import APIRouter, Query, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES

router = APIRouter(prefix="/api/admin", tags=["admin-metrics"])


@router.get("/metrics/summary", responses=AUTH_ERROR_RESPONSES, summary="Current metrics snapshot")
def metrics_summary(request: Request):
    _require_admin(request)
    from crate.metrics import query_summary

    return {
        "api_latency": query_summary("api.latency", minutes=5),
        "api_requests": query_summary("api.requests", minutes=5),
        "api_errors": query_summary("api.errors", minutes=5),
        "stream_requests": query_summary("stream.requests", minutes=5),
        "stream_latency": query_summary("stream.latency", minutes=5),
        "stream_concurrent": query_summary("stream.concurrent", minutes=5),
    }


@router.get("/metrics/timeseries", responses=AUTH_ERROR_RESPONSES, summary="Time-series metric data")
def metrics_timeseries(
    request: Request,
    name: str = Query(..., description="Metric name, e.g. api.latency"),
    period: str = Query("hour", description="Granularity: minute, hour, day"),
    start: str | None = Query(None, description="ISO start timestamp"),
    end: str | None = Query(None, description="ISO end timestamp"),
    minutes: int = Query(60, ge=1, le=2880, description="Minutes of recent data (for period=minute)"),
):
    _require_admin(request)
    from crate.metrics import query_recent, query_historical

    if period == "minute":
        return {"name": name, "period": period, "data": query_recent(name, minutes)}

    return {"name": name, "period": period, "data": query_historical(name, period, start, end)}


@router.get("/logs", responses=AUTH_ERROR_RESPONSES, summary="Query worker logs")
def admin_logs(
    request: Request,
    worker_id: str | None = Query(None),
    task_id: str | None = Query(None),
    level: str | None = Query(None),
    category: str | None = Query(None),
    since: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    _require_admin(request)
    from crate.db.worker_logs import query_logs

    return query_logs(
        worker_id=worker_id,
        task_id=task_id,
        level=level,
        category=category,
        since=since,
        limit=limit,
    )


@router.get("/logs/workers", responses=AUTH_ERROR_RESPONSES, summary="List known workers")
def admin_workers(request: Request):
    _require_admin(request)
    from crate.db.worker_logs import list_known_workers

    return list_known_workers()


@router.get("/download-policy", responses=AUTH_ERROR_RESPONSES, summary="Download policy status and suggested limits")
def admin_download_policy(request: Request):
    _require_admin(request)
    from crate.db.cache import get_setting
    from crate.actors import (
        _is_download_allowed, _count_active_users, _count_active_streams,
        _is_in_time_window, get_suggested_download_limits,
    )

    suggested = get_suggested_download_limits()
    window_enabled = get_setting("download_window_enabled", "false") == "true"

    return {
        "downloads_allowed_now": _is_download_allowed(),
        "active_users": _count_active_users(),
        "active_streams": _count_active_streams(),
        "time_window": {
            "enabled": window_enabled,
            "in_window": _is_in_time_window() if window_enabled else True,
            "start": get_setting("download_window_start", "02:00"),
            "end": get_setting("download_window_end", "07:00"),
        },
        "user_limit": {
            "enabled": int(get_setting("download_max_active_users", "0")) > 0,
            "max": int(get_setting("download_max_active_users", "0")),
        },
        "stream_limit": {
            "enabled": int(get_setting("download_max_active_streams", "0")) > 0,
            "max": int(get_setting("download_max_active_streams", "0")),
        },
        "suggested": suggested,
    }
