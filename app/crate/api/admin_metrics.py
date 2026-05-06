"""Admin-only endpoints for metrics, worker logs, and health summary."""

from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.api.schemas.operations import AdminLogsSnapshotResponse
from crate.db.admin_logs_surface import LOGS_SURFACE_STREAM_CHANNEL, get_cached_logs_surface

router = APIRouter(prefix="/api/admin", tags=["admin-metrics"])

_DASHBOARD_TIMESERIES = {
    "api.latency": "api.request.latency",
    "api.requests": "api.request.count",
    "api.errors": "api.request.errors",
    "api.slow": "api.request.slow",
    "stream.requests": "stream.requests",
    "stream.transcode.duration": "stream.transcode.duration",
    "stream.transcode.completed": "stream.transcode.completed",
    "stream.transcode.failed": "stream.transcode.failed",
    "home.compute.ms": "home.compute.ms",
    "home.endpoint_compute.ms": "home.endpoint_compute.ms",
    "worker.queue.depth": "worker.queue.depth",
    "worker.task.duration": "worker.task.duration",
    "worker.queue.wait": "worker.queue.wait",
    "worker.resource.deferred": "worker.resource.deferred",
    "worker.resource.defer_seconds": "worker.resource.defer_seconds",
    "worker.resource.load_ratio": "worker.resource.load_ratio",
    "worker.resource.iowait_percent": "worker.resource.iowait_percent",
    "worker.resource.swap_used_percent": "worker.resource.swap_used_percent",
}

_SUMMARY_METRICS = {
    "api_latency": ("api.request.latency", 5),
    "api_requests": ("api.request.count", 5),
    "api_errors": ("api.request.errors", 5),
    "api_slow": ("api.request.slow", 5),
    "stream_requests": ("stream.requests", 5),
    "stream_latency": ("stream.latency", 5),
    "stream_concurrent": ("stream.concurrent", 5),
    "stream_transcode_duration": ("stream.transcode.duration", 60),
    "stream_transcode_completed": ("stream.transcode.completed", 60),
    "stream_transcode_failed": ("stream.transcode.failed", 60),
    "home_cache_hit": ("home.cache.hit", 15),
    "home_cache_miss": ("home.cache.miss", 15),
    "home_cache_waited": ("home.cache.waited", 15),
    "home_cache_coalesced": ("home.cache.coalesced", 15),
    "home_cache_stale_fallback": ("home.cache.stale_fallback", 15),
    "home_compute_ms": ("home.compute.ms", 15),
    "home_endpoint_cache_hit": ("home.endpoint_cache.hit", 15),
    "home_endpoint_cache_miss": ("home.endpoint_cache.miss", 15),
    "home_endpoint_compute_ms": ("home.endpoint_compute.ms", 15),
    "worker_resource_deferred": ("worker.resource.deferred", 60),
    "worker_resource_defer_seconds": ("worker.resource.defer_seconds", 60),
    "worker_resource_load_ratio": ("worker.resource.load_ratio", 60),
    "worker_resource_iowait_percent": ("worker.resource.iowait_percent", 60),
    "worker_resource_swap_used_percent": ("worker.resource.swap_used_percent", 60),
    "media_worker_completed": ("media_worker.package.completed", 60),
    "media_worker_failed": ("media_worker.package.failed", 60),
    "media_worker_duration": ("media_worker.package.duration", 60),
    "media_worker_bytes": ("media_worker.package.bytes", 60),
    "media_worker_admission_denied": ("media_worker.admission.denied", 60),
    "media_worker_cache_pruned": ("media_worker.cache.pruned", 60),
    "media_worker_cache_bytes_removed": ("media_worker.cache.bytes_removed", 60),
}

def _build_metrics_summary() -> dict:
    from crate.metrics import query_summaries

    return query_summaries(_SUMMARY_METRICS)


def _build_metrics_system() -> dict:
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

    resource_pressure = {}
    try:
        from crate.db.cache_store import get_cache
        from crate.resource_governor import evaluate_maintenance_window, evaluate_resources

        decision = evaluate_resources(label="admin metrics", listener_sensitive=True)
        resource_pressure = decision.to_dict()
        window_decision = evaluate_maintenance_window(task_type="library_pipeline")
        if window_decision.window:
            resource_pressure["window"] = window_decision.window
        if not window_decision.allowed:
            resource_pressure["allowed"] = False
            resource_pressure["reason"] = (
                window_decision.reason
                if decision.allowed
                else f"{window_decision.reason}, {decision.reason}"
            )
            resource_pressure["defer_seconds"] = max(
                int(resource_pressure.get("defer_seconds") or 0),
                window_decision.defer_seconds,
            )
        last_defer = get_cache("resource_pressure", max_age_seconds=600)
        if isinstance(last_defer, dict) and not last_defer.get("allowed", True):
            resource_pressure["last_defer"] = last_defer
    except Exception:
        resource_pressure = {}

    media_worker = {}
    try:
        from crate.media_worker_progress import get_media_worker_runtime

        media_worker = get_media_worker_runtime(limit=5)
    except Exception:
        media_worker = {}

    return {
        "disk": disk,
        "db_pool": db_pool,
        "db_pools": db_pools,
        "analysis": analysis,
        "load": load,
        "resource_pressure": resource_pressure,
        "media_worker": media_worker,
    }


def _list_running_tasks(limit: int = 10) -> list[dict]:
    from crate.db.queries.tasks import list_tasks

    return list_tasks(status="running", limit=limit)


def _build_playback_delivery() -> dict:
    try:
        from crate.config import load_config
        from crate.db.queries.streaming_admin import get_playback_delivery_snapshot
        from crate.worker_handlers.playback import get_stream_transcode_runtime

        payload = get_playback_delivery_snapshot(limit=5)
        payload["runtime"] = get_stream_transcode_runtime(load_config())
        return payload
    except Exception:
        return {
            "stats": {
                "tracks": 0,
                "lossless_tracks": 0,
                "hires_tracks": 0,
                "variants": 0,
                "variant_tracks": 0,
                "ready": 0,
                "pending": 0,
                "running": 0,
                "failed": 0,
                "missing": 0,
                "ready_tracks": 0,
                "cached_bytes": 0,
                "ready_source_bytes": 0,
                "estimated_saved_bytes": 0,
                "coverage_percent": 0,
                "avg_prepare_seconds": None,
            },
            "runtime": {"active": 0, "limit": 1, "slots": []},
            "recent_variants": [],
        }


def _build_metrics_dashboard(period: str, minutes: int) -> dict:
    from crate.db.cache_store import get_cache, set_cache
    from crate.metrics import query_historical, query_recent, query_recent_rolled, query_route_latency

    cache_key = f"admin:metrics:dashboard:{period}:{minutes}"
    cached = get_cache(cache_key, max_age_seconds=10)
    if cached is not None:
        return cached

    timeseries: dict[str, list[dict]] = {}
    for response_name, metric_name in _DASHBOARD_TIMESERIES.items():
        if period == "minute":
            timeseries[response_name] = query_recent(metric_name, minutes)
        elif period == "hour":
            timeseries[response_name] = query_recent_rolled(metric_name, minutes=minutes, bucket_minutes=60)
        else:
            timeseries[response_name] = query_historical(metric_name, period)

    payload = {
        "summary": _build_metrics_summary(),
        "system": _build_metrics_system(),
        "tasks": _list_running_tasks(limit=10),
        "playback_delivery": _build_playback_delivery(),
        "route_latency": query_route_latency(minutes=min(minutes, 60), limit=20),
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

    metric_name = _DASHBOARD_TIMESERIES.get(name, name)

    if period == "minute":
        return {"name": name, "period": period, "data": query_recent(metric_name, minutes)}
    if period == "hour" and not start and not end:
        return {
            "name": name,
            "period": period,
            "data": query_recent_rolled(metric_name, minutes=minutes, bucket_minutes=60),
        }

    return {"name": name, "period": period, "data": query_historical(metric_name, period, start, end)}


@router.get("/metrics/routes", responses=AUTH_ERROR_RESPONSES, summary="Recent API route latency")
def metrics_routes(
    request: Request,
    minutes: int = Query(15, ge=1, le=240, description="Recent minutes to aggregate"),
    limit: int = Query(20, ge=1, le=100, description="Maximum routes to return"),
    target: str | None = Query(None, description="Optional target filter, e.g. api"),
):
    _require_admin(request)
    from crate.metrics import query_route_latency

    return {
        "minutes": minutes,
        "limit": limit,
        "target": target,
        "routes": query_route_latency(minutes=minutes, limit=limit, target=target),
    }


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


@router.get(
    "/logs-snapshot",
    response_model=AdminLogsSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin logs snapshot",
)
def admin_logs_snapshot(request: Request, fresh: bool = False, limit: int = Query(100, ge=1, le=200)):
    _require_admin(request)
    return get_cached_logs_surface(limit=limit, fresh=fresh)


async def _admin_logs_stream(limit: int) -> AsyncIterator[str]:
    yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
    pubsub = None
    try:
        pubsub = await open_pubsub(LOGS_SURFACE_STREAM_CHANNEL)
        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
            await asyncio.sleep(15)
    finally:
        if pubsub is not None:
            await close_pubsub(pubsub, LOGS_SURFACE_STREAM_CHANNEL)


@router.get(
    "/logs-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin logs snapshot updates",
)
async def admin_logs_stream(request: Request, limit: int = Query(100, ge=1, le=200)):
    _require_admin(request)
    return StreamingResponse(
        _admin_logs_stream(limit),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/download-policy", responses=AUTH_ERROR_RESPONSES, summary="Download policy status and suggested limits")
def admin_download_policy(request: Request):
    _require_admin(request)
    from crate.db.cache_settings import get_setting
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
    from crate.db.cache_settings import set_setting

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
    from crate.db.repositories.auth import list_users_map_rows

    return {"users": list_users_map_rows()}
