from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from crate.api.auth import _require_auth, _require_admin
from crate.db import (
    create_task, add_tidal_download, get_tidal_downloads,
    update_tidal_download, delete_tidal_download,
    set_monitored_artist, get_monitored_artists, is_artist_monitored,
)
from crate import tidal

router = APIRouter(prefix="/api/tidal", tags=["tidal"])


class DownloadRequest(BaseModel):
    url: str
    quality: str = "max"
    source: str = "search"
    title: str = ""


class BatchDownloadRequest(BaseModel):
    items: list[dict]  # [{url, tidal_id, content_type, title, artist, cover_url, quality, source}]


class QueueUpdateRequest(BaseModel):
    status: str | None = None
    priority: int | None = None


# ── Auth ─────────────────────────────────────────────────────────

@router.get("/status")
def tidal_status(request: Request):
    _require_auth(request)
    return {"authenticated": tidal.is_authenticated()}


@router.post("/auth/login")
async def tidal_login(request: Request):
    """Start Tidal device auth flow. Returns SSE stream with device code + result."""
    _require_admin(request)
    import asyncio
    from starlette.responses import StreamingResponse

    async def _stream():
        for line in tidal.login_flow():
            yield f"data: {line}\n\n"
            await asyncio.sleep(0.1)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/auth/refresh")
def tidal_refresh(request: Request):
    _require_admin(request)
    success = tidal.refresh_token()
    return {"success": success}


@router.post("/auth/logout")
def tidal_logout(request: Request):
    _require_admin(request)
    success = tidal.logout()
    return {"success": success}


# ── Missing from Tidal ────────────────────────────────────────────

@router.get("/missing/{artist:path}")
def tidal_missing(request: Request, artist: str):
    """Find Tidal albums not in the local library for an artist."""
    _require_auth(request)
    if not tidal.is_authenticated():
        return {"albums": [], "authenticated": False}

    import re
    from crate.db import get_library_albums

    result = tidal.search(artist, content_type="albums", limit=50)
    albums = result.get("albums", [])

    # Build set of normalized local album names
    local_albums = get_library_albums(artist)
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())
    local_names = {_norm(a["name"]) for a in local_albums}

    missing = []
    for a in albums:
        title = a.get("title", "")
        tracks = a.get("tracks", 0)
        album_artist = a.get("artist", "")
        if not title:
            continue
        # Must be by the same artist
        if album_artist.lower() != artist.lower():
            continue
        # Skip singles and short EPs (less than 4 tracks)
        if tracks and tracks < 4:
            continue
        if _norm(title) not in local_names:
            missing.append(a)

    return {"albums": missing, "authenticated": True}


@router.post("/download-missing/{artist:path}")
def tidal_download_missing(request: Request, artist: str, body: dict):
    """Download multiple missing albums from Tidal."""
    _require_auth(request)
    album_urls = body.get("albums", [])  # [{url, title}]
    if not album_urls:
        return {"queued": 0}

    from crate.db import create_task_dedup
    queued = 0
    for a in album_urls:
        url = a.get("url", "")
        title = a.get("title", "")
        if not url:
            continue
        task_id = create_task_dedup("tidal_download", {
            "url": url,
            "artist": artist,
            "album": title,
            "quality": body.get("quality", "max"),
            "cover_url": a.get("cover_url", ""),
        })
        if task_id:
            queued += 1

    return {"queued": queued}


# ── Search ───────────────────────────────────────────────────────

@router.get("/search")
def tidal_search(request: Request, q: str = "", type: str = "all", limit: int = 20, offset: int = 0):
    _require_auth(request)
    if len(q.strip()) < 2:
        return {"albums": [], "artists": [], "tracks": []}
    result = tidal.search(q, content_type=type, limit=limit, offset=offset)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


# ── Download ─────────────────────────────────────────────────────

@router.post("/download")
def tidal_download(request: Request, body: DownloadRequest):
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")
    if not body.url.strip():
        raise HTTPException(status_code=422, detail="URL is required")

    # Extract tidal_id from URL
    tidal_id = body.url.strip().rstrip("/").split("/")[-1]

    display_title = body.title or body.url.strip()

    dl_id = add_tidal_download(
        tidal_url=body.url.strip(),
        tidal_id=tidal_id,
        content_type="album",
        title=display_title,
        quality=body.quality,
        status="queued",
        source=body.source,
    )

    task_id = create_task("tidal_download", {
        "url": body.url.strip(),
        "quality": body.quality,
        "download_id": dl_id,
        "artist": display_title.split(" - ")[0] if " - " in display_title else "",
        "album": display_title.split(" - ", 1)[1] if " - " in display_title else display_title,
    })
    update_tidal_download(dl_id, task_id=task_id)
    return {"task_id": task_id, "download_id": dl_id}


@router.post("/download-batch")
def tidal_download_batch(request: Request, body: BatchDownloadRequest):
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")

    queued = []
    for item in body.items:
        url = item.get("url", "")
        if not url:
            continue
        tidal_id = item.get("tidal_id", url.rstrip("/").split("/")[-1])
        dl_id = add_tidal_download(
            tidal_url=url,
            tidal_id=tidal_id,
            content_type=item.get("content_type", "album"),
            title=item.get("title", url),
            artist=item.get("artist"),
            cover_url=item.get("cover_url"),
            quality=item.get("quality", "max"),
            status="queued",
            source=item.get("source", "batch"),
            metadata=item.get("metadata"),
        )
        task_id = create_task("tidal_download", {
            "url": url,
            "quality": item.get("quality", "max"),
            "download_id": dl_id,
        })
        update_tidal_download(dl_id, task_id=task_id)
        queued.append({"download_id": dl_id, "task_id": task_id, "title": item.get("title", "")})

    return {"queued": len(queued), "items": queued}


# ── Queue / Wishlist ─────────────────────────────────────────────

@router.get("/queue")
def get_queue(request: Request, status: str | None = None):
    _require_auth(request)
    return get_tidal_downloads(status=status)


@router.post("/wishlist")
def add_to_wishlist(request: Request, body: dict):
    _require_auth(request)
    url = body.get("url", "")
    tidal_id = body.get("tidal_id", url.rstrip("/").split("/")[-1])
    dl_id = add_tidal_download(
        tidal_url=url,
        tidal_id=tidal_id,
        content_type=body.get("content_type", "album"),
        title=body.get("title", ""),
        artist=body.get("artist"),
        cover_url=body.get("cover_url"),
        quality=body.get("quality", "max"),
        status="wishlist",
        source="wishlist",
        metadata=body.get("metadata"),
    )
    return {"id": dl_id}


@router.put("/queue/{dl_id}")
def update_queue_item(request: Request, dl_id: int, body: QueueUpdateRequest):
    _require_auth(request)
    kwargs = {}
    if body.status is not None:
        kwargs["status"] = body.status
        if body.status == "queued":
            # Wishlist → queued: create download task
            downloads = get_tidal_downloads()
            dl = next((d for d in downloads if d["id"] == dl_id), None)
            if dl:
                task_id = create_task("tidal_download", {
                    "url": dl["tidal_url"],
                    "quality": dl["quality"],
                    "download_id": dl_id,
                })
                kwargs["task_id"] = task_id
    if body.priority is not None:
        kwargs["priority"] = body.priority
    update_tidal_download(dl_id, **kwargs)
    return {"ok": True}


@router.delete("/queue/{dl_id}")
def remove_queue_item(request: Request, dl_id: int):
    _require_auth(request)
    delete_tidal_download(dl_id)
    return {"ok": True}


# ── Artist Discography ───────────────────────────────────────────

@router.get("/artist-discography/{name:path}")
def artist_discography(request: Request, name: str):
    """Cross-reference Tidal discography with local library."""
    _require_auth(request)
    from crate.db import get_library_albums
    from thefuzz import fuzz

    # Search Tidal for artist
    search_result = tidal.search(name, content_type="artists", limit=5)
    if "error" in search_result:
        raise HTTPException(status_code=502, detail=search_result["error"])

    artists = search_result.get("artists", [])
    if not artists:
        return {"artist": name, "albums": [], "error": "Artist not found on Tidal"}

    tidal_artist = artists[0]

    # Get all albums from Tidal for this artist
    album_search = tidal.search(name, content_type="albums", limit=50)
    tidal_albums = album_search.get("albums", [])

    # Get local albums
    local_albums = get_library_albums(name)
    local_names = {a["name"].lower() for a in local_albums}
    local_tag_names = {(a.get("tag_album") or "").lower() for a in local_albums} - {""}

    result_albums = []
    for ta in tidal_albums:
        if ta["artist"].lower() != name.lower():
            continue

        title_lower = ta["title"].lower()
        # Check if we already have it (fuzzy)
        is_local = (
            title_lower in local_names
            or title_lower in local_tag_names
            or any(fuzz.ratio(title_lower, ln) > 85 for ln in local_names | local_tag_names)
        )

        result_albums.append({
            **ta,
            "status": "local" if is_local else "available",
        })

    return {
        "artist": name,
        "tidal_artist": tidal_artist,
        "albums": result_albums,
    }


# ── Match Missing Albums ─────────────────────────────────────────

@router.get("/match-missing/{name:path}")
def match_missing(request: Request, name: str):
    """Match missing albums (from MusicBrainz) with Tidal availability."""
    _require_auth(request)
    from crate.api._deps import library_path, extensions, safe_path
    from crate.missing import find_missing_albums
    from thefuzz import fuzz

    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        raise HTTPException(status_code=404, detail="Artist not found")

    exts = extensions()
    missing_data = find_missing_albums(artist_dir, exts)
    missing = missing_data.get("missing", [])

    if not missing:
        return {"artist": name, "matches": [], "total_missing": 0}

    matches = []
    for album in missing:
        title = album.get("title", "")
        search_result = tidal.search(f"{name} {title}", content_type="albums", limit=5)
        tidal_albums = search_result.get("albums", [])

        best_match = None
        best_score = 0
        for ta in tidal_albums:
            score = fuzz.ratio(title.lower(), ta["title"].lower())
            artist_score = fuzz.ratio(name.lower(), ta["artist"].lower())
            combined = (score + artist_score) // 2
            if combined > best_score:
                best_score = combined
                best_match = ta

        matches.append({
            "missing_title": title,
            "missing_year": album.get("first_release_date", "")[:4],
            "missing_type": album.get("type", ""),
            "tidal_match": best_match if best_score >= 70 else None,
            "match_score": best_score,
        })

    return {
        "artist": name,
        "matches": matches,
        "total_missing": len(missing),
        "matched": sum(1 for m in matches if m["tidal_match"]),
    }


# ── Monitor ──────────────────────────────────────────────────────

@router.post("/monitor/{name:path}")
def toggle_monitor(request: Request, name: str, body: dict | None = None):
    _require_auth(request)
    enabled = body.get("enabled", True) if body else True
    set_monitored_artist(name, enabled=enabled)
    return {"artist": name, "monitored": enabled}


@router.get("/monitored")
def list_monitored(request: Request):
    _require_auth(request)
    return get_monitored_artists()


@router.get("/monitored/{name:path}")
def check_monitored(request: Request, name: str):
    _require_auth(request)
    return {"artist": name, "monitored": is_artist_monitored(name)}
