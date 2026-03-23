"""Unified music acquisition API — Tidal + Soulseek."""

import json
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock import soulseek
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
        if not username or not files:
            return JSONResponse({"error": "username and files required"}, status_code=400)

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

        return JSONResponse({"error": "No files enqueued"}, status_code=400)

    return JSONResponse({"error": "source must be 'tidal' or 'soulseek'"}, status_code=400)


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
                "status": d.get("state", ""),
                "progress": d.get("percentComplete", 0),
                "username": d.get("username", ""),
                "speed": d.get("averageSpeed", 0),
            })
    except Exception:
        pass

    return queue
