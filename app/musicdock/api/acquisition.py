"""Unified music acquisition API — Tidal + Soulseek."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock import soulseek
from musicdock.db import get_setting, create_task, list_tasks

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/acquisition", tags=["acquisition"])


@router.get("/status")
def acquisition_status():
    """Get status of all acquisition sources."""
    # Tidal
    tidal_status = {"authenticated": False}
    try:
        from musicdock.tidal import get_auth_status
        tidal_status = get_auth_status()
    except Exception:
        pass

    # Soulseek
    slsk_status = soulseek.get_status()

    return {
        "tidal": tidal_status,
        "soulseek": slsk_status,
    }


@router.post("/search")
def acquisition_search(body: dict):
    """Unified search across Tidal and Soulseek."""
    query = body.get("query", "").strip()
    artist = body.get("artist", "").strip()
    album = body.get("album", "").strip()

    if not query and not (artist and album):
        return JSONResponse({"error": "query or artist+album required"}, status_code=400)

    search_text = query or f"{artist} {album}"
    results = {"tidal": [], "soulseek": [], "query": search_text}

    quality_filter = get_setting("soulseek_quality", "flac")

    # Search in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {}

        # Tidal search
        try:
            from musicdock.tidal import search as tidal_search
            futures["tidal"] = executor.submit(tidal_search, search_text)
        except Exception:
            pass

        # Soulseek search
        if soulseek.get_status().get("loggedIn"):
            futures["soulseek"] = executor.submit(
                soulseek.search_album, artist or search_text, album or "", quality_filter
            )

        for source, future in futures.items():
            try:
                data = future.result(timeout=20)
                if source == "tidal":
                    results["tidal"] = data if isinstance(data, dict) else {"results": data}
                elif source == "soulseek":
                    results["soulseek"] = data if isinstance(data, list) else []
            except Exception as e:
                log.debug("Search failed for %s: %s", source, e)

    return results


@router.post("/download")
def acquisition_download(body: dict):
    """Download from the best or specified source."""
    source = body.get("source", "")  # "tidal" or "soulseek"
    artist = body.get("artist", "")
    album = body.get("album", "")

    if source == "tidal":
        # Use existing tidal download
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

        # Queue download via slskd
        result = soulseek.download_files(username, files)
        enqueued = result.get("enqueued", [])

        # Create a task to monitor and process when complete
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
            try:
                params = json.loads(params)
            except Exception:
                params = {}
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
