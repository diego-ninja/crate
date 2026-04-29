from fastapi import APIRouter, Request, HTTPException

from crate.api.auth import _require_auth, _require_admin
from crate.api._deps import artist_name_from_entity_uid, artist_name_from_id
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import OkResponse
from crate.api.schemas.tidal import (
    BatchDownloadRequest,
    BatchDownloadResponse,
    CheckMonitoredResponse,
    DownloadRequest,
    MatchMissingResponse,
    MonitorRequest,
    MonitorToggleResponse,
    MonitoredArtistResponse,
    QueueUpdateRequest,
    TidalAuthMutationResponse,
    TidalDiscographyResponse,
    TidalDownloadMissingRequest,
    TidalDownloadMissingResponse,
    TidalDownloadResponse,
    TidalMissingResponse,
    TidalQueueItemResponse,
    TidalSearchResponse,
    TidalStatusResponse,
    WishlistRequest,
    WishlistResponse,
)
from crate.db.repositories.library import get_album_quality_map, get_library_albums
from crate.db.repositories.tasks import create_task_dedup, find_active_task_by_type_params
from crate.db.tidal import (
    add_tidal_download,
    delete_tidal_download,
    get_monitored_artists,
    get_tidal_downloads,
    is_artist_monitored,
    set_monitored_artist,
    update_tidal_download,
)
from crate.acquisition_tasks import build_tidal_download_params, infer_tidal_entity_type, tidal_download_dedup_key
from crate import tidal

router = APIRouter(prefix="/api/tidal", tags=["tidal"])

_TIDAL_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        401: error_response("Tidal authentication is required."),
        404: error_response("The requested Tidal resource could not be found."),
        422: error_response("The request payload failed validation."),
        502: error_response("The upstream Tidal API request failed."),
    },
)

_TIDAL_SSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Server-sent events stream for the Tidal device login flow.",
            "content": {
                "text/event-stream": {},
            },
        },
        422: error_response("The request payload failed validation."),
    },
)


# ── Auth ─────────────────────────────────────────────────────────

@router.get(
    "/status",
    response_model=TidalStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get Tidal authentication status",
)
def tidal_status(request: Request):
    _require_auth(request)
    return {"authenticated": tidal.is_authenticated()}


@router.post(
    "/auth/login",
    responses=_TIDAL_SSE_RESPONSES,
    summary="Start the Tidal device login flow",
)
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


@router.post(
    "/auth/refresh",
    response_model=TidalAuthMutationResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Refresh the Tidal auth token",
)
def tidal_refresh(request: Request):
    _require_admin(request)
    success = tidal.refresh_token()
    return {"success": success}


@router.post(
    "/auth/logout",
    response_model=TidalAuthMutationResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Log out from Tidal",
)
def tidal_logout(request: Request):
    _require_admin(request)
    success = tidal.logout()
    return {"success": success}


# ── Missing from Tidal ────────────────────────────────────────────

def tidal_missing(request: Request, artist: str):
    """Find Tidal albums not in the local library for an artist."""
    _require_auth(request)
    if not tidal.is_authenticated():
        return {"albums": [], "authenticated": False}

    import re

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


@router.get(
    "/missing/artists/{artist_id}",
    response_model=TidalMissingResponse,
    responses=_TIDAL_RESPONSES,
    summary="List Tidal albums missing from the local library",
)
def tidal_missing_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return tidal_missing(request, artist_name)


@router.get(
    "/missing/artists/by-entity/{artist_entity_uid}",
    response_model=TidalMissingResponse,
    responses=_TIDAL_RESPONSES,
    summary="List Tidal albums missing from the local library by artist entity UID",
)
def tidal_missing_by_entity_uid(request: Request, artist_entity_uid: str):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return tidal_missing(request, artist_name)


def tidal_download_missing(request: Request, artist: str, body: TidalDownloadMissingRequest):
    """Download multiple missing albums from Tidal."""
    _require_auth(request)
    if not body.albums:
        return {"queued": 0}

    queued = 0
    for album in body.albums:
        url = album.url
        title = album.title
        if not url:
            continue
        task_params = build_tidal_download_params(
            url=url,
            quality=body.quality,
            content_type=album.content_type if hasattr(album, "content_type") else None,
            artist=artist,
            album=title,
            cover_url=album.cover_url,
        )
        task_id = create_task_dedup("tidal_download", task_params, dedup_key=tidal_download_dedup_key(task_params))
        if task_id:
            queued += 1

    return {"queued": queued}


@router.post(
    "/download-missing/artists/{artist_id}",
    response_model=TidalDownloadMissingResponse,
    responses=_TIDAL_RESPONSES,
    summary="Queue downloads for multiple missing Tidal albums",
)
def tidal_download_missing_by_id(request: Request, artist_id: int, body: TidalDownloadMissingRequest):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return tidal_download_missing(request, artist_name, body)


@router.post(
    "/download-missing/artists/by-entity/{artist_entity_uid}",
    response_model=TidalDownloadMissingResponse,
    responses=_TIDAL_RESPONSES,
    summary="Queue downloads for multiple missing Tidal albums by artist entity UID",
)
def tidal_download_missing_by_entity_uid(request: Request, artist_entity_uid: str, body: TidalDownloadMissingRequest):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return tidal_download_missing(request, artist_name, body)


# ── Search ───────────────────────────────────────────────────────

@router.get(
    "/search",
    response_model=TidalSearchResponse,
    responses=_TIDAL_RESPONSES,
    summary="Search the Tidal catalog",
)
def tidal_search(request: Request, q: str = "", type: str = "all", limit: int = 20, offset: int = 0):
    _require_auth(request)
    if len(q.strip()) < 2:
        return {"albums": [], "artists": [], "tracks": []}
    result = tidal.search(q, content_type=type, limit=limit, offset=offset)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


# ── Artist Browse ────────────────────────────────────────────────

@router.get(
    "/artists/{tidal_artist_id}/albums",
    responses=_TIDAL_RESPONSES,
    summary="Get all albums for a Tidal artist",
)
def tidal_artist_albums(request: Request, tidal_artist_id: str):
    """Browse albums for a Tidal artist. Marks local status and quality upgrades."""
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")

    albums = tidal.get_artist_albums(tidal_artist_id)
    if not albums:
        return {"albums": [], "artist_id": tidal_artist_id}

    artist_name = albums[0].get("artist", "") if albums else ""
    if artist_name:
        from thefuzz import fuzz

        local_albums = get_library_albums(artist_name)

        # Get representative quality per album (max bit_depth/sample_rate from tracks)
        album_ids = [a["id"] for a in local_albums if a.get("id")]
        album_quality = get_album_quality_map(album_ids, include_format=True) if album_ids else {}

        # Build lookup: normalized name → (album row, quality)
        local_by_name: dict[str, tuple[dict, dict]] = {}
        for la in local_albums:
            q = album_quality.get(la["id"], {})
            local_by_name[la["name"].lower()] = (la, q)
            tag = (la.get("tag_album") or "").lower()
            if tag:
                local_by_name[tag] = (la, q)

        for album in albums:
            title_lower = album["title"].lower()
            local_match = local_by_name.get(title_lower)
            if not local_match:
                for ln, pair in local_by_name.items():
                    if fuzz.ratio(title_lower, ln) > 85:
                        local_match = pair
                        break

            if local_match:
                la, lq = local_match
                album["status"] = "local"
                album["local_quality"] = lq
                album["local_album_id"] = la["id"]
            else:
                album["status"] = "available"
    else:
        for album in albums:
            album["status"] = "available"

    return {"albums": albums, "artist_id": tidal_artist_id, "artist_name": artist_name}


@router.get(
    "/artists/{tidal_artist_id}",
    responses=_TIDAL_RESPONSES,
    summary="Get Tidal artist info",
)
def tidal_artist_info(request: Request, tidal_artist_id: str):
    """Get basic info for a Tidal artist."""
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")

    albums = tidal.get_artist_albums(tidal_artist_id, limit=1)
    if not albums:
        raise HTTPException(status_code=404, detail="Artist not found on Tidal")

    artist_name = albums[0].get("artist", "")
    return {
        "id": tidal_artist_id,
        "name": artist_name,
    }


@router.get(
    "/albums/{tidal_album_id}/tracks",
    responses=_TIDAL_RESPONSES,
    summary="Get tracks for a Tidal album",
)
def tidal_album_tracks(request: Request, tidal_album_id: str):
    """List tracks in a Tidal album."""
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")

    tracks = tidal.get_album_tracks(tidal_album_id)
    return {"tracks": tracks, "album_id": tidal_album_id}


# ── Download ─────────────────────────────────────────────────────

@router.post(
    "/download",
    response_model=TidalDownloadResponse,
    responses=_TIDAL_RESPONSES,
    summary="Queue a Tidal download",
)
def tidal_download(request: Request, body: DownloadRequest):
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")
    if not body.url.strip():
        raise HTTPException(status_code=422, detail="URL is required")

    # Extract tidal_id from URL
    clean_url = body.url.strip()
    tidal_id = clean_url.rstrip("/").split("/")[-1]
    content_type = infer_tidal_entity_type(clean_url)

    display_title = body.title or clean_url
    artist_hint = ""
    album_hint = display_title
    if content_type == "artist":
        artist_hint = display_title
        album_hint = display_title
    elif " - " in display_title:
        artist_hint = display_title.split(" - ", 1)[0]
        album_hint = display_title.split(" - ", 1)[1]

    dl_id = add_tidal_download(
        tidal_url=clean_url,
        tidal_id=tidal_id,
        content_type=content_type,
        title=display_title,
        artist=artist_hint or None,
        quality=body.quality,
        status="queued",
        source=body.source,
    )

    task_params = build_tidal_download_params(
        url=clean_url,
        quality=body.quality,
        download_id=dl_id,
        content_type=content_type,
        artist=artist_hint,
        album=album_hint,
        upgrade_album_id=body.upgrade_album_id,
    )
    task_id = create_task_dedup("tidal_download", task_params, dedup_key=tidal_download_dedup_key(task_params))
    if not task_id:
        task_id = find_active_task_by_type_params(
            "tidal_download",
            task_params,
            dedup_key=tidal_download_dedup_key(task_params),
        )
    update_tidal_download(dl_id, task_id=task_id)
    return {"task_id": task_id, "download_id": dl_id}


@router.post(
    "/download-batch",
    response_model=BatchDownloadResponse,
    responses=_TIDAL_RESPONSES,
    summary="Queue multiple Tidal downloads",
)
def tidal_download_batch(request: Request, body: BatchDownloadRequest):
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")

    queued = []
    for item in body.items:
        url = item.url
        if not url:
            continue
        tidal_id = item.tidal_id or url.rstrip("/").split("/")[-1]
        content_type = item.content_type or "album"
        title = item.title or url
        quality = item.quality or "max"
        source = item.source or "batch"
        dl_id = add_tidal_download(
            tidal_url=url,
            tidal_id=tidal_id,
            content_type=content_type,
            title=title,
            artist=item.artist,
            cover_url=item.cover_url,
            quality=quality,
            status="queued",
            source=source,
            metadata=item.metadata,
        )
        task_params = build_tidal_download_params(
            url=url,
            quality=quality,
            download_id=dl_id,
            content_type=item.content_type or infer_tidal_entity_type(url),
            artist=item.artist or "",
            album=title,
            cover_url=item.cover_url or "",
        )
        task_id = create_task_dedup("tidal_download", task_params, dedup_key=tidal_download_dedup_key(task_params))
        if not task_id:
            task_id = find_active_task_by_type_params(
                "tidal_download",
                task_params,
                dedup_key=tidal_download_dedup_key(task_params),
            )
        update_tidal_download(dl_id, task_id=task_id)
        queued.append({"download_id": dl_id, "task_id": task_id, "title": item.title})

    return {"queued": len(queued), "items": queued}


# ── Queue / Wishlist ─────────────────────────────────────────────

@router.get(
    "/queue",
    response_model=list[TidalQueueItemResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List the Tidal download queue",
)
def get_queue(request: Request, status: str | None = None):
    _require_auth(request)
    return get_tidal_downloads(status=status)


@router.post(
    "/wishlist",
    response_model=WishlistResponse,
    responses=_TIDAL_RESPONSES,
    summary="Add an item to the Tidal wishlist",
)
def add_to_wishlist(request: Request, body: WishlistRequest):
    _require_auth(request)
    url = body.url
    tidal_id = body.tidal_id or url.rstrip("/").split("/")[-1]
    dl_id = add_tidal_download(
        tidal_url=url,
        tidal_id=tidal_id,
        content_type=body.content_type,
        title=body.title,
        artist=body.artist,
        cover_url=body.cover_url,
        quality=body.quality,
        status="wishlist",
        source="wishlist",
        metadata=body.metadata,
    )
    return {"id": dl_id}


@router.put(
    "/queue/{dl_id}",
    response_model=OkResponse,
    responses=_TIDAL_RESPONSES,
    summary="Update a Tidal queue item",
)
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
                task_params = build_tidal_download_params(
                    url=dl["tidal_url"],
                    quality=dl["quality"],
                    download_id=dl_id,
                    content_type=dl.get("content_type"),
                    artist=dl.get("artist") or "",
                    album=dl.get("title") or "",
                    cover_url=dl.get("cover_url") or "",
                )
                task_id = create_task_dedup("tidal_download", task_params, dedup_key=tidal_download_dedup_key(task_params))
                if not task_id:
                    task_id = find_active_task_by_type_params(
                        "tidal_download",
                        task_params,
                        dedup_key=tidal_download_dedup_key(task_params),
                    )
                kwargs["task_id"] = task_id
    if body.priority is not None:
        kwargs["priority"] = body.priority
    update_tidal_download(dl_id, **kwargs)
    return {"ok": True}


@router.delete(
    "/queue/{dl_id}",
    response_model=OkResponse,
    responses=_TIDAL_RESPONSES,
    summary="Remove a Tidal queue item",
)
def remove_queue_item(request: Request, dl_id: int):
    _require_auth(request)
    delete_tidal_download(dl_id)
    return {"ok": True}


# ── Artist Discography ───────────────────────────────────────────

def artist_discography(request: Request, name: str):
    """Cross-reference Tidal discography with local library."""
    _require_auth(request)
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


@router.get(
    "/artists/{artist_id}/discography",
    response_model=TidalDiscographyResponse,
    responses=_TIDAL_RESPONSES,
    summary="Cross-reference Tidal discography with the local library",
)
def artist_discography_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return artist_discography(request, artist_name)


# ── Match Missing Albums ─────────────────────────────────────────

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


@router.get(
    "/artists/{artist_id}/match-missing",
    response_model=MatchMissingResponse,
    responses=_TIDAL_RESPONSES,
    summary="Match missing albums with Tidal availability",
)
def match_missing_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return match_missing(request, artist_name)


# ── Monitor ──────────────────────────────────────────────────────

def toggle_monitor(request: Request, name: str, body: MonitorRequest | None = None):
    _require_auth(request)
    enabled = body.enabled if body else True
    set_monitored_artist(name, enabled=enabled)
    return {"artist": name, "monitored": enabled}


@router.post(
    "/artists/{artist_id}/monitor",
    response_model=MonitorToggleResponse,
    responses=_TIDAL_RESPONSES,
    summary="Enable or disable Tidal monitoring for an artist",
)
def toggle_monitor_by_id(request: Request, artist_id: int, body: MonitorRequest | None = None):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return toggle_monitor(request, artist_name, body)


@router.get(
    "/monitored",
    response_model=list[MonitoredArtistResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List monitored Tidal artists",
)
def list_monitored(request: Request):
    _require_auth(request)
    return get_monitored_artists()


def check_monitored(request: Request, name: str):
    _require_auth(request)
    return {"artist": name, "monitored": is_artist_monitored(name)}


@router.get(
    "/artists/{artist_id}/monitored",
    response_model=CheckMonitoredResponse,
    responses=_TIDAL_RESPONSES,
    summary="Check whether an artist is monitored on Tidal",
)
def check_monitored_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return check_monitored(request, artist_name)
