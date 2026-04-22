"""Admin-only endpoints for metrics, worker logs, and health summary."""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

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
    import os
    import shutil

    # Disk usage
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

    # DB pool
    db_pool = {}
    try:
        from crate.db.engine import _engine
        if _engine:
            pool = _engine.pool
            db_pool = {
                "size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
                "total": pool.checkedin() + pool.checkedout(),
            }
    except Exception:
        pass

    # Analysis progress
    analysis = {}
    try:
        from crate.analysis_daemon import get_analysis_status
        analysis = get_analysis_status()
    except Exception:
        pass

    # System load
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

    return {"disk": disk, "db_pool": db_pool, "analysis": analysis, "load": load}


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
    from crate.db.tx import transaction_scope
    from crate.db.cache import get_cache
    from sqlalchemy import text

    with transaction_scope() as session:
        users = session.execute(text("""
            SELECT u.id, u.name, u.email, u.avatar, u.city, u.country, u.latitude, u.longitude,
                   u.created_at,
                   MAX(s.last_seen_at) AS last_seen_at,
                   CASE WHEN MAX(s.last_seen_at) > NOW() - interval '5 minutes' THEN TRUE ELSE FALSE END AS online
            FROM users u
            LEFT JOIN sessions s ON s.user_id = u.id
            WHERE u.latitude IS NOT NULL AND u.longitude IS NOT NULL
            GROUP BY u.id
        """)).mappings().all()

    result = []
    for u in users:
        now_playing = get_cache(f"now_playing:{u['id']}", max_age_seconds=120)
        result.append({
            "id": u["id"],
            "name": u["name"] or u["email"].split("@")[0],
            "email": u["email"],
            "avatar": u["avatar"],
            "city": u["city"],
            "country": u["country"],
            "latitude": float(u["latitude"]),
            "longitude": float(u["longitude"]),
            "online": bool(u["online"]),
            "now_playing": {
                "title": now_playing.get("title"),
                "artist": now_playing.get("artist"),
                "album": now_playing.get("album"),
            } if now_playing else None,
        })

    return {"users": result}
