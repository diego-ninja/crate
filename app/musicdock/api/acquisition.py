"""Unified music acquisition API — Tidal + Soulseek."""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from musicdock import soulseek
from musicdock.api.auth import _require_auth
from musicdock.db import get_setting, create_task, list_tasks

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/acquisition", tags=["acquisition"])


@router.get("/status")
def acquisition_status():
    """Get status of all acquisition sources."""
    tidal_status = {"authenticated": False}
    try:
        from musicdock.tidal import get_auth_status
        tidal_status = get_auth_status()
    except Exception:
        pass

    slsk_status = soulseek.get_status()
    return {"tidal": tidal_status, "soulseek": slsk_status}


@router.post("/search/soulseek")
def start_soulseek_search(body: dict):
    """Start a Soulseek search (non-blocking). Returns search_id to poll."""
    query = body.get("query", "").strip()
    artist = body.get("artist", "").strip()
    album = body.get("album", "").strip()

    if not query and not artist:
        return JSONResponse({"error": "query or artist required"}, status_code=400)

    search_text = query or f"{artist} {album}".strip()
    quality_filter = get_setting("soulseek_quality", "flac")

    # Add FLAC to query if filtering by lossless
    if quality_filter == "flac" and "flac" not in search_text.lower():
        search_text += " FLAC"

    search_id = soulseek.start_search(search_text)
    if not search_id:
        return JSONResponse({"error": "Failed to start search"}, status_code=502)

    return {"search_id": search_id, "query": search_text}


@router.get("/search/soulseek/{search_id}")
def poll_soulseek_search(search_id: str):
    """Poll Soulseek search results (progressive — call every 2-3s)."""
    status = soulseek.get_search_status(search_id)
    quality_filter = get_setting("soulseek_quality", "flac")
    results = soulseek.get_search_results(search_id, quality_filter)
    return {
        "state": status.get("state", "Unknown"),
        "isComplete": status.get("isComplete", False),
        "responseCount": status.get("responseCount", 0),
        "fileCount": status.get("fileCount", 0),
        "results": results,
    }


@router.post("/download")
def acquisition_download(body: dict):
    """Download from the specified source."""
    source = body.get("source", "")
    artist = body.get("artist", "")
    album = body.get("album", "")

    if source == "tidal":
        tidal_id = body.get("tidal_id", "")
        if not tidal_id:
            return JSONResponse({"error": "tidal_id required"}, status_code=400)
        task_id = create_task("tidal_download", {
            "tidal_id": tidal_id,
            "artist": artist,
            "album": album,
            "type": body.get("tidal_type", "album"),
        })
        return {"task_id": task_id, "source": "tidal"}

    elif source == "soulseek":
        username = body.get("username", "")
        files = body.get("files", [])
        find_alternate = body.get("find_alternate", False)

        if not files:
            return JSONResponse({"error": "files required"}, status_code=400)

        file_names = [f.get("filename", "") if isinstance(f, dict) else f for f in files]

        # If explicitly asked to find alternate, skip original peer entirely
        if find_alternate or not username:
            task_id = create_task("soulseek_download", {
                "username": username or "unknown",
                "artist": artist,
                "album": album,
                "files": file_names,
                "file_count": len(files),
                "find_alternate": True,
            })
            return {"task_id": task_id, "source": "soulseek", "finding_alternate": True}

        # Try original peer
        result = soulseek.download_files(username, files)
        enqueued = result.get("enqueued", [])

        if enqueued:
            task_id = create_task("soulseek_download", {
                "username": username,
                "artist": artist,
                "album": album,
                "files": [f.get("filename", "") for f in enqueued],
                "file_count": len(enqueued),
            })
            return {"task_id": task_id, "source": "soulseek", "enqueued": len(enqueued)}

        # Peer rejected — go straight to alternate search
        task_id = create_task("soulseek_download", {
            "username": username,
            "artist": artist,
            "album": album,
            "files": file_names,
            "file_count": len(files),
            "find_alternate": True,
        })
        return {"task_id": task_id, "source": "soulseek", "finding_alternate": True}

    return JSONResponse({"error": "source must be 'tidal' or 'soulseek'"}, status_code=400)


# ── New Releases ──────────────────────────────────────────────────

@router.get("/new-releases")
def api_new_releases(status: str = ""):
    """Get detected new releases."""
    from musicdock.db import get_new_releases
    releases = get_new_releases(status=status)
    return {"releases": releases}


@router.post("/new-releases/{release_id}/download")
def api_download_release(release_id: int):
    """Download a detected new release via Tidal."""
    from musicdock.db import get_new_releases, mark_release_downloading
    releases = get_new_releases()
    release = next((r for r in releases if r["id"] == release_id), None)
    if not release or not release.get("tidal_url"):
        return JSONResponse({"error": "Release not found or no Tidal URL"}, status_code=404)
    mark_release_downloading(release_id)
    task_id = create_task("tidal_download", {
        "url": release["tidal_url"],
        "artist": release["artist_name"],
        "album": release["album_title"],
        "quality": get_setting("tidal_quality", "max"),
        "new_release_id": release_id,
    })
    return {"task_id": task_id}


@router.post("/new-releases/{release_id}/dismiss")
def api_dismiss_release(release_id: int):
    """Dismiss a new release (won't be shown again)."""
    from musicdock.db import mark_release_dismissed
    mark_release_dismissed(release_id)
    return {"ok": True}


@router.post("/new-releases/check")
def api_check_new_releases():
    """Trigger a new release check for all library artists."""
    task_id = create_task("check_new_releases", {})
    return {"task_id": task_id}


@router.get("/queue")
def acquisition_queue():
    """Get unified download queue from all sources."""
    queue = []

    # Tidal downloads from tasks
    tidal_tasks = list_tasks(task_type="tidal_download", limit=20)
    for t in tidal_tasks:
        params = t.get("params", {})
        if isinstance(params, str):
            try: params = json.loads(params)
            except Exception: params = {}
        queue.append({
            "source": "tidal",
            "artist": params.get("artist", ""),
            "album": params.get("album", ""),
            "status": t.get("status", ""),
            "progress": t.get("progress", ""),
            "task_id": t.get("id", ""),
        })

    # Soulseek downloads from slskd
    try:
        slsk_downloads = soulseek.get_downloads()
        for d in slsk_downloads:
            queue.append({
                "source": "soulseek",
                "artist": "",
                "album": d.get("directory", "").replace("\\", "/").split("/")[-1] if d.get("directory") else "",
                "filename": d.get("filename", ""),
                "fullPath": d.get("fullPath", ""),
                "status": d.get("state", ""),
                "progress": d.get("percentComplete", 0),
                "username": d.get("username", ""),
                "speed": d.get("averageSpeed", 0),
            })
    except Exception:
        pass

    return queue


@router.post("/queue/clear-completed")
def clear_completed():
    """Clear completed Soulseek downloads from slskd queue."""
    ok = soulseek.clear_completed_downloads()
    return {"cleared": ok}


@router.post("/queue/clear-errored")
def clear_errored():
    """Clear errored/cancelled Soulseek downloads from slskd queue."""
    ok = soulseek.clear_errored_downloads()
    return {"cleared": ok}


@router.post("/queue/cleanup-incomplete")
def cleanup_incomplete():
    """Create task to clean up incomplete Soulseek album downloads."""
    from musicdock.db import create_task
    task_id = create_task("cleanup_incomplete_downloads", {})
    return {"task_id": task_id}
