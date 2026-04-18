from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_admin
from crate.api._deps import get_config
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.operations import (
    FixIssuesResponse,
    FixRequest,
    ScanIssueResponse,
    ScannerStatusResponse,
    ScanRequest,
    ScanStartResponse,
)
from crate.db import create_task, get_task, list_tasks, get_latest_scan

router = APIRouter(tags=["scanner"])

_SCANNER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested scan resource could not be found."),
        409: error_response("A conflicting scan is already in progress."),
        422: error_response("The request payload failed validation."),
    },
)


@router.post(
    "/api/scan",
    response_model=ScanStartResponse,
    responses=_SCANNER_RESPONSES,
    summary="Queue a library scan",
)
def start_scan(request: Request, body: ScanRequest | None = None):
    _require_admin(request)
    running = list_tasks(status="running", task_type="scan", limit=1)
    if running:
        return JSONResponse({"error": "Scan already in progress"}, status_code=409)

    params = {}
    if body and body.only:
        params["only"] = body.only

    task_id = create_task("scan", params)
    return {"status": "started", "task_id": task_id, "only": params.get("only")}


@router.get(
    "/api/status",
    response_model=ScannerStatusResponse,
    responses={
        200: {
            "description": "Current scanner state and latest scan summary.",
        }
    },
    summary="Get public scanner status",
)
def api_status(request: Request):
    # No auth — used by Docker healthcheck and sidebar polling
    pass
    import json as _json

    running = list_tasks(status="running", task_type="scan", limit=1)
    scanning = len(running) > 0

    progress_raw = running[0]["progress"] if running else ""
    try:
        progress = _json.loads(progress_raw) if progress_raw else {}
    except (_json.JSONDecodeError, TypeError):
        progress = {"message": progress_raw} if progress_raw else {}

    latest = get_latest_scan()
    last_scan = latest["scanned_at"] if latest else None
    issue_count = len(latest["issues"]) if latest else 0

    return {
        "scanning": scanning,
        "last_scan": last_scan,
        "issue_count": issue_count,
        "progress": progress,
    }


@router.get(
    "/api/issues",
    response_model=list[ScanIssueResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List issues from the latest scan",
)
def api_issues(request: Request, type: str | None = None):
    _require_admin(request)
    latest = get_latest_scan()
    if not latest:
        return []

    issues = latest["issues"]
    if type:
        issues = [i for i in issues if i.get("type") == type]
    return issues


@router.post(
    "/api/fix",
    response_model=FixIssuesResponse,
    responses=_SCANNER_RESPONSES,
    summary="Dry-run or queue issue fixes from the latest scan",
)
def fix_issues(request: Request, body: FixRequest | None = None):
    _require_admin(request)
    dry_run = body.dry_run if body else True

    running = list_tasks(status="running", task_type="scan", limit=1)
    if running:
        return JSONResponse({"error": "Scan in progress"}, status_code=409)

    latest = get_latest_scan()
    if not latest or not latest["issues"]:
        return JSONResponse({"error": "No issues to fix. Run a scan first."}, status_code=400)

    config = get_config()
    threshold = config.get("confidence_threshold", 90)
    issues = latest["issues"]

    auto = [i for i in issues if i.get("confidence", 0) >= threshold]
    manual = [i for i in issues if i.get("confidence", 0) < threshold]

    if not dry_run:
        task_id = create_task("fix_issues", {"threshold": threshold})
        return {
            "dry_run": False,
            "threshold": threshold,
            "auto_fixable": len(auto),
            "needs_review": len(manual),
            "task_id": task_id,
        }

    return {
        "dry_run": dry_run,
        "threshold": threshold,
        "auto_fixable": len(auto),
        "needs_review": len(manual),
    }
