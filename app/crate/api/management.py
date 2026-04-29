from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_admin
from crate.api._deps import album_names_from_entity_uid, album_names_from_id, artist_name_from_entity_uid, artist_name_from_id
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import OkResponse, TaskEnqueueResponse
from crate.api.schemas.management import (
    AdminHealthSnapshotResponse,
    AnalysisStatusResponse,
    ArtistHealthIssuesResponse,
    ArtistRepairResponse,
    AuditLogResponse,
    CheckTypeMutationResponse,
    DeleteRequest,
    EnrichMbidsRequest,
    HealthFixTypeResponse,
    HealthIssuesResponse,
    HealthReportResponse,
    MoveRequest,
    RepairIssuesRequest,
    RepairRequest,
    StorageMigrationRequest,
    StorageV2StatusResponse,
    WipeRequest,
)
from crate.db.admin_health_surface import (
    HEALTH_SURFACE_STREAM_CHANNEL,
    get_cached_health_surface,
    publish_health_surface_signal,
)
from crate.db.audit import get_audit_log
from crate.db.cache_store import get_cache, set_cache
from crate.db.health import dismiss_issue, get_artist_issues, get_issue_counts, get_open_issues, resolve_issue, resolve_issues_by_type
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.management import get_last_analyzed_track, get_last_bliss_track, get_storage_v2_status
from crate.db.repositories.tasks import create_task

router = APIRouter(prefix="/api/manage", tags=["management"])
admin_router = APIRouter(prefix="/api/admin", tags=["management"])

_ANALYSIS_STATUS_CACHE_KEY = "api:manage:analysis-status:v1"
_ANALYSIS_STATUS_TTL = 10

_MANAGEMENT_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested management resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


async def _health_stream(*, check_type: str | None = None, limit: int = 500) -> AsyncIterator[str]:
    yield f"data: {json_dumps(get_cached_health_surface(check_type=check_type, limit=limit))}\n\n"
    redis = None
    pubsub = None
    try:
        import redis.asyncio as aioredis

        redis = aioredis.from_url(_get_redis_url(), decode_responses=True)
        pubsub = redis.pubsub()
        await pubsub.subscribe(HEALTH_SURFACE_STREAM_CHANNEL)
        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(get_cached_health_surface(check_type=check_type, limit=limit, fresh=True))}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_health_surface(check_type=check_type, limit=limit))}\n\n"
            await asyncio.sleep(15)
    finally:
        if pubsub is not None:
            await pubsub.unsubscribe(HEALTH_SURFACE_STREAM_CHANNEL)
        if redis is not None:
            await redis.aclose()


@admin_router.get(
    "/health-snapshot",
    response_model=AdminHealthSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin health snapshot",
)
def api_admin_health_snapshot(request: Request, check_type: str = "", fresh: bool = False, limit: int = 500):
    _require_admin(request)
    normalized = check_type or None
    return get_cached_health_surface(check_type=normalized, limit=limit, fresh=fresh)


@admin_router.get(
    "/health-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin health snapshot updates",
)
async def api_admin_health_stream(request: Request, check_type: str = "", limit: int = 500):
    _require_admin(request)
    normalized = check_type or None
    safe_limit = min(max(limit, 1), 1000)
    return StreamingResponse(
        _health_stream(check_type=normalized, limit=safe_limit),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Health Check & Repair ────────────────────────────────────────

@router.post(
    "/health-check",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue a library health check",
)
def run_health_check(request: Request):
    _require_admin(request)
    task_id = create_task("health_check")
    return {"task_id": task_id}


@router.get(
    "/health-report",
    response_model=HealthReportResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the persisted health report",
)
def get_health_report(request: Request):
    """Get persisted health issues from DB (survives restarts)."""
    _require_admin(request)
    snapshot = get_cached_health_surface()
    return {"issues": snapshot.get("issues", []), "summary": snapshot.get("counts", {}), "total": snapshot.get("total", 0)}


@router.get(
    "/health-issues",
    response_model=HealthIssuesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List open health issues",
)
def list_health_issues(request: Request, check_type: str = ""):
    """Get open health issues, optionally filtered by type."""
    _require_admin(request)
    snapshot = get_cached_health_surface(check_type=check_type or None)
    return {
        "issues": snapshot.get("issues", []),
        "counts": snapshot.get("counts", {}),
        "total": snapshot.get("total", 0),
    }


@router.post(
    "/health-issues/{issue_id}/resolve",
    response_model=OkResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Resolve a single health issue",
)
def api_resolve_issue(request: Request, issue_id: int):
    _require_admin(request)
    resolve_issue(issue_id)
    publish_health_surface_signal()
    return {"ok": True}


@router.post(
    "/health-issues/{issue_id}/dismiss",
    response_model=OkResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Dismiss a single health issue",
)
def api_dismiss_issue(request: Request, issue_id: int):
    _require_admin(request)
    dismiss_issue(issue_id)
    publish_health_surface_signal()
    return {"ok": True}


@router.post(
    "/repair",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue a repair run",
)
def run_repair(request: Request, body: RepairRequest):
    _require_admin(request)
    task_id = create_task("repair", {"dry_run": body.dry_run, "auto_only": body.auto_only})
    return {"task_id": task_id}

@router.post(
    "/repair-issues",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue a repair run for specific issues",
)
def repair_specific_issues(request: Request, body: RepairIssuesRequest):
    """Repair specific issues (individual or batch)."""
    _require_admin(request)
    task_id = create_task("repair", {
        "dry_run": body.dry_run,
        "auto_only": False,
        "issues": body.issues,
    })
    return {"task_id": task_id}


@router.post(
    "/health-issues/resolve-type/{check_type}",
    response_model=CheckTypeMutationResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Resolve all health issues of a given type",
)
def api_resolve_type(request: Request, check_type: str):
    """Resolve all open issues of a given check type."""
    _require_admin(request)
    resolve_issues_by_type(check_type)
    publish_health_surface_signal()
    return {"ok": True, "check_type": check_type}


@router.post(
    "/health-issues/fix-type/{check_type}",
    response_model=HealthFixTypeResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue fixes for all auto-fixable issues of a type",
)
def api_fix_type(request: Request, check_type: str):
    """Auto-fix all fixable issues of a given check type via repair task."""
    _require_admin(request)
    issues = get_open_issues(check_type=check_type)
    fixable = [i for i in issues if i.get("auto_fixable")]
    if not fixable:
        return {"task_id": None, "fixable": 0}
    task_id = create_task("repair", {
        "dry_run": False,
        "auto_only": False,
        "issues": fixable,
    })
    publish_health_surface_signal()
    return {"task_id": task_id, "fixable": len(fixable)}


# ── Per-Artist Health ────────────────────────────────────────────

def get_artist_health_issues(request: Request, name: str):
    """Get open health issues for a specific artist."""
    _require_admin(request)
    issues = get_artist_issues(name)
    return {"artist": name, "issues": issues, "count": len(issues)}


def repair_artist(request: Request, name: str):
    """Repair all auto-fixable issues for a specific artist."""
    _require_admin(request)
    issues = get_artist_issues(name)
    fixable = [i for i in issues if i.get("auto_fixable")]
    if not fixable:
        return {"task_id": None, "count": 0}
    task_id = create_task("repair", {"dry_run": False, "auto_only": False, "issues": fixable})
    return {"task_id": task_id, "count": len(fixable)}


@router.get(
    "/artists/{artist_id}/health-issues",
    response_model=ArtistHealthIssuesResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="List health issues for an artist",
)
def get_artist_health_issues_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return get_artist_health_issues(request, artist_name)


@router.post(
    "/artists/{artist_id}/repair",
    response_model=ArtistRepairResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue repairs for a specific artist",
)
def repair_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return repair_artist(request, artist_name)


@router.post(
    "/artists/by-entity/{artist_entity_uid}/repair",
    response_model=ArtistRepairResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue repairs for a specific artist by entity UID",
)
def repair_artist_by_entity_uid(request: Request, artist_entity_uid: str):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return repair_artist(request, artist_name)


# ── Artist Management ────────────────────────────────────────────

def delete_artist(request: Request, name: str, body: DeleteRequest):
    _require_admin(request)
    if body.mode not in ("db_only", "full"):
        raise HTTPException(status_code=422, detail="mode must be 'db_only' or 'full'")
    task_id = create_task("delete_artist", {"name": name, "mode": body.mode})
    return {"task_id": task_id}


@router.post(
    "/artists/{artist_id}/delete",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue deletion of an artist",
)
def delete_artist_by_id(request: Request, artist_id: int, body: DeleteRequest):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return delete_artist(request, artist_name, body)


@router.post(
    "/artists/by-entity/{artist_entity_uid}/delete",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue deletion of an artist by entity UID",
)
def delete_artist_by_entity_uid(request: Request, artist_entity_uid: str, body: DeleteRequest):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return delete_artist(request, artist_name, body)


def reset_enrichment(request: Request, name: str):
    _require_admin(request)
    task_id = create_task("reset_enrichment", {"artist": name})
    return {"task_id": task_id}


@router.post(
    "/artists/{artist_id}/reset",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue enrichment reset for an artist",
)
def reset_enrichment_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reset_enrichment(request, artist_name)


@router.post(
    "/artists/by-entity/{artist_entity_uid}/reset",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue enrichment reset for an artist by entity UID",
)
def reset_enrichment_by_entity_uid(request: Request, artist_entity_uid: str):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reset_enrichment(request, artist_name)


def move_artist(request: Request, name: str, body: MoveRequest):
    _require_admin(request)
    if not body.new_name.strip():
        raise HTTPException(status_code=422, detail="new_name cannot be empty")
    task_id = create_task("move_artist", {"name": name, "new_name": body.new_name.strip()})
    return {"task_id": task_id}


@router.post(
    "/artists/{artist_id}/move",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue a move/rename for an artist",
)
def move_artist_by_id(request: Request, artist_id: int, body: MoveRequest):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return move_artist(request, artist_name, body)


@router.post(
    "/artists/by-entity/{artist_entity_uid}/move",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue a move/rename for an artist by entity UID",
)
def move_artist_by_entity_uid(request: Request, artist_entity_uid: str, body: MoveRequest):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return move_artist(request, artist_name, body)


# ── Album Management ────────────────────────────────────────────

def delete_album(request: Request, artist: str, album: str, body: DeleteRequest):
    _require_admin(request)
    if body.mode not in ("db_only", "full"):
        raise HTTPException(status_code=422, detail="mode must be 'db_only' or 'full'")
    task_id = create_task("delete_album", {"artist": artist, "album": album, "mode": body.mode})
    return {"task_id": task_id}


@router.post(
    "/albums/{album_id}/delete",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue deletion of an album",
)
def delete_album_by_id(request: Request, album_id: int, body: DeleteRequest):
    album_names = album_names_from_id(album_id)
    if not album_names:
        raise HTTPException(status_code=404, detail="Album not found")
    artist, album = album_names
    return delete_album(request, artist, album, body)


@router.post(
    "/albums/by-entity/{album_entity_uid}/delete",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue deletion of an album by entity UID",
)
def delete_album_by_entity_uid(request: Request, album_entity_uid: str, body: DeleteRequest):
    album_names = album_names_from_entity_uid(album_entity_uid)
    if not album_names:
        raise HTTPException(status_code=404, detail="Album not found")
    artist, album = album_names
    return delete_album(request, artist, album, body)


# ── Library Management ───────────────────────────────────────────

@router.post(
    "/wipe",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue a full library wipe",
)
def wipe_library(request: Request, body: WipeRequest):
    _require_admin(request)
    task_id = create_task("wipe_library", {"rebuild": body.rebuild})
    return {"task_id": task_id}


@router.post(
    "/rebuild",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue a full library rebuild",
)
def rebuild_library(request: Request):
    _require_admin(request)
    task_id = create_task("rebuild_library")
    return {"task_id": task_id}


# ── Audio Analysis (background daemons) ─────────────────────────

@router.get(
    "/analysis-status",
    response_model=AnalysisStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get audio analysis and bliss daemon status",
)
def analysis_status(request: Request):
    """Return current background analysis progress for audio analysis and bliss daemons."""
    _require_admin(request)
    snapshot = get_cached_ops_snapshot().get("analysis")
    if snapshot:
        return snapshot

    cached = get_cache(_ANALYSIS_STATUS_CACHE_KEY)
    if cached:
        return cached

    from crate.analysis_daemon import get_analysis_status

    status = get_analysis_status()
    payload = {**status, "last_analyzed": get_last_analyzed_track(), "last_bliss": get_last_bliss_track()}
    set_cache(_ANALYSIS_STATUS_CACHE_KEY, payload, ttl=_ANALYSIS_STATUS_TTL)
    return payload


@router.post(
    "/analyze-all",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue re-analysis for all tracks",
)
def analyze_all_tracks(request: Request):
    """Reset all tracks to pending so background daemons re-analyze them."""
    _require_admin(request)
    task_id = create_task("analyze_all", {"scope": "all", "what": "both"})
    return {"task_id": task_id}


def reanalyze_artist(request: Request, name: str):
    """Reset analysis state for all tracks of an artist."""
    _require_admin(request)
    task_id = create_task("analyze_tracks", {"artist": name, "what": "both"})
    return {"task_id": task_id}


@router.post(
    "/artists/{artist_id}/reanalyze",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue re-analysis for an artist",
)
def reanalyze_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reanalyze_artist(request, artist_name)


@router.post(
    "/artists/by-entity/{artist_entity_uid}/reanalyze",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue re-analysis for an artist by entity UID",
)
def reanalyze_artist_by_entity_uid(request: Request, artist_entity_uid: str):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reanalyze_artist(request, artist_name)


@router.post(
    "/reanalyze-album/{album_id}",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue re-analysis for an album",
)
def reanalyze_album(request: Request, album_id: int):
    """Reset analysis state for all tracks of an album."""
    _require_admin(request)
    task_id = create_task("analyze_tracks", {"album_id": album_id, "what": "both"})
    return {"task_id": task_id}


@router.post(
    "/reanalyze-album/by-entity/{album_entity_uid}",
    response_model=TaskEnqueueResponse,
    responses=_MANAGEMENT_RESPONSES,
    summary="Queue re-analysis for an album by entity UID",
)
def reanalyze_album_by_entity_uid(request: Request, album_entity_uid: str):
    album_names = album_names_from_entity_uid(album_entity_uid)
    if not album_names:
        raise HTTPException(status_code=404, detail="Album not found")
    from crate.db.repositories.library import get_library_album_by_entity_uid

    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    return reanalyze_album(request, album["id"])


# ── Bliss (song similarity) ──────────────────────────────────────

@router.post(
    "/compute-bliss",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue bliss recomputation for all tracks",
)
def compute_bliss(request: Request):
    """Reset bliss state for all tracks so background daemon recomputes vectors."""
    _require_admin(request)
    task_id = create_task("compute_bliss", {"scope": "all", "what": "bliss"})
    return {"task_id": task_id}


# ── Popularity ───────────────────────────────────────────────────

@router.post(
    "/compute-popularity",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue popularity recomputation",
)
def compute_popularity(request: Request):
    _require_admin(request)
    task_id = create_task("compute_popularity")
    return {"task_id": task_id}


# ── MBID Enrichment ──────────────────────────────────────────────

@router.post(
    "/enrich-mbids",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue MusicBrainz ID enrichment",
)
def enrich_mbids(request: Request, body: EnrichMbidsRequest | None = None):
    _require_admin(request)
    params = {}
    if body:
        if body.artist:
            params["artist"] = body.artist
        if body.min_score is not None:
            params["min_score"] = body.min_score
    task_id = create_task("enrich_mbids", params)
    return {"task_id": task_id}


# ── Audit Log ────────────────────────────────────────────────────

@router.get(
    "/audit-log",
    response_model=AuditLogResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read the audit log",
)
def read_audit_log(request: Request, limit: int = 100, offset: int = 0, action: str | None = None):
    _require_admin(request)
    entries, total = get_audit_log(limit=limit, offset=offset, action=action)
    return {"entries": entries, "total": total, "limit": limit, "offset": offset}


# ── Storage Migration ───────────────────────────────────────────

@router.post(
    "/migrate-storage-v2",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue storage layout migration to V2",
)
def migrate_storage_v2(request: Request, body: StorageMigrationRequest | None = None):
    """Start V2 storage migration. Optionally pass {"artist": "Name"} for single artist."""
    _require_admin(request)
    params = {}
    if body and body.artist:
        params["artist"] = body.artist
    task_id = create_task("migrate_storage_v2", params)
    return {"task_id": task_id}


@router.post(
    "/verify-storage-v2",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue storage layout verification",
)
def verify_storage_v2(request: Request):
    """Verify storage integrity after V2 migration."""
    _require_admin(request)
    task_id = create_task("verify_storage_v2")
    return {"task_id": task_id}


@router.get(
    "/storage-v2-status",
    response_model=StorageV2StatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get storage V2 migration progress",
)
def storage_v2_status(request: Request):
    """Get migration progress: how many artists/albums/tracks are on V2 layout."""
    _require_admin(request)
    return get_storage_v2_status()
