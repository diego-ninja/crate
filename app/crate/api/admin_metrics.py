"""Admin-only endpoints for metrics, worker logs, and health summary."""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES

router = APIRouter(prefix="/api/admin", tags=["admin-metrics"])

_DASHBOARD_TIMESERIES = [
    "api.latency",
    "api.requests",
    "api.errors",
    "api.slow",
    "stream.requests",
    "home.compute.ms",
    "home.endpoint_compute.ms",
    "worker.queue.depth",
    "worker.task.duration",
    "worker.queue.wait",
]


def _build_metrics_summary() -> dict:
    from crate.metrics import query_summary

    return {
        "api_latency": query_summary("api.latency", minutes=5),
        "api_requests": query_summary("api.requests", minutes=5),
        "api_errors": query_summary("api.errors", minutes=5),
        "api_slow": query_summary("api.slow", minutes=5),
        "stream_requests": query_summary("stream.requests", minutes=5),
        "stream_latency": query_summary("stream.latency", minutes=5),
        "stream_concurrent": query_summary("stream.concurrent", minutes=5),
        "home_cache_hit": query_summary("home.cache.hit", minutes=15),
        "home_cache_miss": query_summary("home.cache.miss", minutes=15),
        "home_cache_waited": query_summary("home.cache.waited", minutes=15),
        "home_cache_coalesced": query_summary("home.cache.coalesced", minutes=15),
        "home_cache_stale_fallback": query_summary("home.cache.stale_fallback", minutes=15),
        "home_compute_ms": query_summary("home.compute.ms", minutes=15),
        "home_endpoint_cache_hit": query_summary("home.endpoint_cache.hit", minutes=15),
        "home_endpoint_cache_miss": query_summary("home.endpoint_cache.miss", minutes=15),
        "home_endpoint_compute_ms": query_summary("home.endpoint_compute.ms", minutes=15),
    }


def _build_metrics_system() -> dict:
    import os
    import shutil

    disk = {}
    for label, path in [("music", "/music"), ("data", "/data")]:
        try:
            usage = shutil.disk_usage(path)
            disk[label] = {
                "total_gb": round(usage.total / (1024**3), 1),
                "used_gb": round(usage.used / (1024**3), 1),
                "free_gb": round(usage.free / (1024**3), 1),
                "percent": round(usage.used / usage.total * 100, 1) if usage.total else 0,
            }
        except Exception:
            disk[label] = None

    db_pool = {}
    db_pools = {"combined": {}, "sqlalchemy": {}, "legacy": {}}
    try:
        from crate.db.engine import _engine
        if _engine:
            pool = _engine.pool
            sqlalchemy_pool = {
                "size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
                "total": pool.checkedin() + pool.checkedout(),
            }
            db_pools["sqlalchemy"] = sqlalchemy_pool
    except Exception:
        pass

    try:
        from crate.db.core import _pool as legacy_pool
        if legacy_pool:
            checked_in = len(getattr(legacy_pool, "_pool", []) or [])
            checked_out = len(getattr(legacy_pool, "_used", {}) or {})
            legacy_state = {
                "size": int(getattr(legacy_pool, "maxconn", 0) or 0),
                "checked_in": checked_in,
                "checked_out": checked_out,
                "overflow": max(0, checked_out + checked_in - int(getattr(legacy_pool, "maxconn", 0) or 0)),
                "total": checked_in + checked_out,
                "minconn": int(getattr(legacy_pool, "minconn", 0) or 0),
                "maxconn": int(getattr(legacy_pool, "maxconn", 0) or 0),
            }
            db_pools["legacy"] = legacy_state
    except Exception:
        pass

    sqlalchemy_pool = db_pools.get("sqlalchemy") or {}
    legacy_state = db_pools.get("legacy") or {}
    if sqlalchemy_pool or legacy_state:
        combined = {
            "size": int(sqlalchemy_pool.get("size") or 0) + int(legacy_state.get("size") or 0),
            "checked_in": int(sqlalchemy_pool.get("checked_in") or 0) + int(legacy_state.get("checked_in") or 0),
            "checked_out": int(sqlalchemy_pool.get("checked_out") or 0) + int(legacy_state.get("checked_out") or 0),
            "overflow": int(sqlalchemy_pool.get("overflow") or 0) + int(legacy_state.get("overflow") or 0),
            "total": int(sqlalchemy_pool.get("total") or 0) + int(legacy_state.get("total") or 0),
        }
        db_pools["combined"] = combined
        db_pool = combined or sqlalchemy_pool or legacy_state

    analysis = {}
    try:
        from crate.analysis_daemon import get_analysis_status
        analysis = get_analysis_status()
    except Exception:
        pass

    load = {}
    try:
        load_avg = os.getloadavg()
        cpu_count = os.cpu_count() or 1
        load = {
            "load_1m": round(load_avg[0], 2),
            "load_5m": round(load_avg[1], 2),
            "load_15m": round(load_avg[2], 2),
            "cpu_count": cpu_count,
            "load_percent": round(load_avg[0] / cpu_count * 100, 1),
        }
    except Exception:
        pass

    return {"disk": disk, "db_pool": db_pool, "db_pools": db_pools, "analysis": analysis, "load": load}


def _list_running_tasks(limit: int = 10) -> list[dict]:
    from crate.db.tasks import list_tasks

    return list_tasks(status="running", limit=limit)


def _build_metrics_dashboard(period: str, minutes: int) -> dict:
    from crate.db.cache import get_cache, set_cache
    from crate.metrics import query_historical, query_recent, query_recent_rolled

    cache_key = f"admin:metrics:dashboard:{period}:{minutes}"
    cached = get_cache(cache_key, max_age_seconds=10)
    if cached is not None:
        return cached

    timeseries: dict[str, list[dict]] = {}
    for name in _DASHBOARD_TIMESERIES:
        if period == "minute":
            timeseries[name] = query_recent(name, minutes)
        elif period == "hour":
            timeseries[name] = query_recent_rolled(name, minutes=minutes, bucket_minutes=60)
        else:
            timeseries[name] = query_historical(name, period)

    payload = {
        "summary": _build_metrics_summary(),
        "system": _build_metrics_system(),
        "tasks": _list_running_tasks(limit=10),
        "timeseries": timeseries,
    }
    set_cache(cache_key, payload, ttl=10)
    return payload


@router.get("/metrics/summary", responses=AUTH_ERROR_RESPONSES, summary="Current metrics snapshot")
def metrics_summary(request: Request):
    _require_admin(request)
    return _build_metrics_summary()


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
    from crate.metrics import query_recent, query_historical, query_recent_rolled

    if period == "minute":
        return {"name": name, "period": period, "data": query_recent(name, minutes)}
    if period == "hour" and not start and not end:
        return {"name": name, "period": period, "data": query_recent_rolled(name, minutes=minutes, bucket_minutes=60)}

    return {"name": name, "period": period, "data": query_historical(name, period, start, end)}


@router.get("/metrics/dashboard", responses=AUTH_ERROR_RESPONSES, summary="Bundled system health payload")
def metrics_dashboard(
    request: Request,
    period: str = Query("minute", description="Granularity: minute or hour"),
    minutes: int = Query(60, ge=1, le=2880, description="Minutes of recent data"),
):
    _require_admin(request)
    safe_period = period if period in {"minute", "hour", "day"} else "minute"
    return _build_metrics_dashboard(safe_period, minutes)


@router.get("/llm/status", responses=AUTH_ERROR_RESPONSES, summary="Check LLM provider status")
def llm_status(request: Request):
    _require_admin(request)
    from crate.llm import get_config
    config = get_config()

    # Test connectivity
    available = False
    error = None
    try:
        if config["provider"] == "ollama":
            import requests as req
            resp = req.get(f"{config['ollama_url']}/api/tags", timeout=5)
            available = resp.status_code == 200
            models = [m["name"] for m in resp.json().get("models", [])] if available else []
        else:
            available = True  # Cloud providers assumed available if key is set
            models = []
    except Exception as e:
        error = str(e)
        models = []

    return {
        "available": available,
        "model": config["model"],
        "provider": config["provider"],
        "models": models,
        "error": error,
    }


@router.get("/metrics/system", responses=AUTH_ERROR_RESPONSES, summary="System-level health stats")
def metrics_system(request: Request):
    """Disk usage, DB pool status, analysis progress."""
    _require_admin(request)
    return _build_metrics_system()


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


class DownloadPolicyUpdate(BaseModel):
    window_enabled: bool | None = None
    window_start: str | None = None
    window_end: str | None = None
    max_active_users: int | None = None
    max_active_streams: int | None = None


@router.put("/download-policy", responses=AUTH_ERROR_RESPONSES, summary="Update download policy settings")
def update_download_policy(request: Request, body: DownloadPolicyUpdate):
    _require_admin(request)
    from crate.db.cache import set_setting

    if body.window_enabled is not None:
        set_setting("download_window_enabled", "true" if body.window_enabled else "false")
    if body.window_start is not None:
        set_setting("download_window_start", body.window_start.strip())
    if body.window_end is not None:
        set_setting("download_window_end", body.window_end.strip())
    if body.max_active_users is not None:
        set_setting("download_max_active_users", str(max(0, body.max_active_users)))
    if body.max_active_streams is not None:
        set_setting("download_max_active_streams", str(max(0, body.max_active_streams)))

    return {"ok": True}


@router.get("/users/map", responses=AUTH_ERROR_RESPONSES, summary="Users with geolocation, online and now-playing status")
def users_map(request: Request):
    _require_admin(request)
    from crate.db.auth import list_users_map_rows

    return {"users": list_users_map_rows()}
