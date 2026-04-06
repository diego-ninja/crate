from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.api._deps import artist_name_from_id, album_names_from_id
from crate.db import (
    create_task, get_cache, get_audit_log,
    get_open_issues, get_issue_counts, resolve_issue, dismiss_issue,
)

router = APIRouter(prefix="/api/manage", tags=["management"])


class DeleteRequest(BaseModel):
    mode: str = "db_only"  # "db_only" | "full"


class RepairRequest(BaseModel):
    dry_run: bool = True
    auto_only: bool = True


class MoveRequest(BaseModel):
    new_name: str


class WipeRequest(BaseModel):
    rebuild: bool = False


# ── Health Check & Repair ────────────────────────────────────────

@router.post("/health-check")
def run_health_check(request: Request):
    _require_admin(request)
    task_id = create_task("health_check")
    return {"task_id": task_id}


@router.get("/health-report")
def get_health_report(request: Request):
    """Get persisted health issues from DB (survives restarts)."""
    _require_admin(request)
    issues = get_open_issues()
    counts = get_issue_counts()
    return {"issues": issues, "summary": counts, "total": len(issues)}


@router.get("/health-issues")
def list_health_issues(request: Request, check_type: str = ""):
    """Get open health issues, optionally filtered by type."""
    _require_admin(request)
    issues = get_open_issues(check_type=check_type or None)
    counts = get_issue_counts()
    return {"issues": issues, "counts": counts, "total": len(issues)}


@router.post("/health-issues/{issue_id}/resolve")
def api_resolve_issue(request: Request, issue_id: int):
    _require_admin(request)
    resolve_issue(issue_id)
    return {"ok": True}


@router.post("/health-issues/{issue_id}/dismiss")
def api_dismiss_issue(request: Request, issue_id: int):
    _require_admin(request)
    dismiss_issue(issue_id)
    return {"ok": True}


@router.post("/repair")
def run_repair(request: Request, body: RepairRequest):
    _require_admin(request)
    task_id = create_task("repair", {"dry_run": body.dry_run, "auto_only": body.auto_only})
    return {"task_id": task_id}


class RepairIssuesRequest(BaseModel):
    issues: list[dict]
    dry_run: bool = False


@router.post("/repair-issues")
def repair_specific_issues(request: Request, body: RepairIssuesRequest):
    """Repair specific issues (individual or batch)."""
    _require_admin(request)
    task_id = create_task("repair", {
        "dry_run": body.dry_run,
        "auto_only": False,
        "issues": body.issues,
    })
    return {"task_id": task_id}


@router.post("/health-issues/resolve-type/{check_type}")
def api_resolve_type(request: Request, check_type: str):
    """Resolve all open issues of a given check type."""
    _require_admin(request)
    from crate.db import resolve_issues_by_type
    resolve_issues_by_type(check_type)
    return {"ok": True, "check_type": check_type}


@router.post("/health-issues/fix-type/{check_type}")
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
    return {"task_id": task_id, "fixable": len(fixable)}


# ── Per-Artist Health ────────────────────────────────────────────

def get_artist_health_issues(request: Request, name: str):
    """Get open health issues for a specific artist."""
    _require_admin(request)
    from crate.db import get_artist_issues
    issues = get_artist_issues(name)
    return {"artist": name, "issues": issues, "count": len(issues)}


def repair_artist(request: Request, name: str):
    """Repair all auto-fixable issues for a specific artist."""
    _require_admin(request)
    from crate.db import get_artist_issues
    issues = get_artist_issues(name)
    fixable = [i for i in issues if i.get("auto_fixable")]
    if not fixable:
        return {"task_id": None, "count": 0}
    task_id = create_task("repair", {"dry_run": False, "auto_only": False, "issues": fixable})
    return {"task_id": task_id, "count": len(fixable)}


@router.get("/artists/{artist_id}/health-issues")
def get_artist_health_issues_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return get_artist_health_issues(request, artist_name)


@router.post("/artists/{artist_id}/repair")
def repair_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
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


@router.post("/artists/{artist_id}/delete")
def delete_artist_by_id(request: Request, artist_id: int, body: DeleteRequest):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return delete_artist(request, artist_name, body)


def reset_enrichment(request: Request, name: str):
    _require_admin(request)
    task_id = create_task("reset_enrichment", {"artist": name})
    return {"task_id": task_id}


@router.post("/artists/{artist_id}/reset")
def reset_enrichment_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reset_enrichment(request, artist_name)


def move_artist(request: Request, name: str, body: MoveRequest):
    _require_admin(request)
    if not body.new_name.strip():
        raise HTTPException(status_code=422, detail="new_name cannot be empty")
    task_id = create_task("move_artist", {"name": name, "new_name": body.new_name.strip()})
    return {"task_id": task_id}


@router.post("/artists/{artist_id}/move")
def move_artist_by_id(request: Request, artist_id: int, body: MoveRequest):
    artist_name = artist_name_from_id(artist_id)
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


@router.post("/albums/{album_id}/delete")
def delete_album_by_id(request: Request, album_id: int, body: DeleteRequest):
    album_names = album_names_from_id(album_id)
    if not album_names:
        raise HTTPException(status_code=404, detail="Album not found")
    artist, album = album_names
    return delete_album(request, artist, album, body)


# ── Library Management ───────────────────────────────────────────

@router.post("/wipe")
def wipe_library(request: Request, body: WipeRequest):
    _require_admin(request)
    task_id = create_task("wipe_library", {"rebuild": body.rebuild})
    return {"task_id": task_id}


@router.post("/rebuild")
def rebuild_library(request: Request):
    _require_admin(request)
    task_id = create_task("rebuild_library")
    return {"task_id": task_id}


# ── Audio Analysis (background daemons) ─────────────────────────

@router.get("/analysis-status")
def analysis_status(request: Request):
    """Return current background analysis progress for audio analysis and bliss daemons."""
    _require_admin(request)
    from crate.analysis_daemon import get_analysis_status
    status = get_analysis_status()

    # Last analyzed track (for live monitoring)
    from crate.db import get_db_ctx
    last = {}
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT title, artist, album, bpm, audio_key, energy, danceability,
                   mood_json IS NOT NULL as has_mood, updated_at
            FROM library_tracks
            WHERE analysis_state = 'done' AND bpm IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)
        row = cur.fetchone()
        if row:
            last = dict(row)

    last_bliss = {}
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT title, artist, album, updated_at
            FROM library_tracks
            WHERE bliss_state = 'done' AND bliss_vector IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)
        row = cur.fetchone()
        if row:
            last_bliss = dict(row)

    return {**status, "last_analyzed": last, "last_bliss": last_bliss}


@router.post("/analyze-all")
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


@router.post("/artists/{artist_id}/reanalyze")
def reanalyze_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return reanalyze_artist(request, artist_name)


@router.post("/reanalyze-album/{album_id}")
def reanalyze_album(request: Request, album_id: int):
    """Reset analysis state for all tracks of an album."""
    _require_admin(request)
    task_id = create_task("analyze_tracks", {"album_id": album_id, "what": "both"})
    return {"task_id": task_id}


# ── Bliss (song similarity) ──────────────────────────────────────

@router.post("/compute-bliss")
def compute_bliss(request: Request):
    """Reset bliss state for all tracks so background daemon recomputes vectors."""
    _require_admin(request)
    task_id = create_task("compute_bliss", {"scope": "all", "what": "bliss"})
    return {"task_id": task_id}


# ── Popularity ───────────────────────────────────────────────────

@router.post("/compute-popularity")
def compute_popularity(request: Request):
    _require_admin(request)
    task_id = create_task("compute_popularity")
    return {"task_id": task_id}


# ── MBID Enrichment ──────────────────────────────────────────────

@router.post("/enrich-mbids")
def enrich_mbids(request: Request, body: dict | None = None):
    _require_admin(request)
    params = {}
    if body:
        if body.get("artist"):
            params["artist"] = body["artist"]
        if body.get("min_score"):
            params["min_score"] = body["min_score"]
    task_id = create_task("enrich_mbids", params)
    return {"task_id": task_id}


# ── Audit Log ────────────────────────────────────────────────────

@router.get("/audit-log")
def read_audit_log(request: Request, limit: int = 100, offset: int = 0, action: str | None = None):
    _require_admin(request)
    entries, total = get_audit_log(limit=limit, offset=offset, action=action)
    return {"entries": entries, "total": total, "limit": limit, "offset": offset}
