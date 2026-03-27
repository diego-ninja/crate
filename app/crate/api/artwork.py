import logging
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crate.api.auth import _require_auth, _require_admin
from crate.artwork import scan_missing_covers, extract_embedded_cover, save_cover
from crate.audio import get_audio_files
from crate.api._deps import library_path, extensions, safe_path
from crate.db import create_task

log = logging.getLogger(__name__)

router = APIRouter()


class FetchRequest(BaseModel):
    mbid: str
    path: str | None = None


class ExtractRequest(BaseModel):
    path: str


@router.get("/api/artwork/missing")
def api_artwork_missing(request: Request):
    """List albums missing cover art with details."""
    _require_auth(request)
    import re
    from crate.db import get_db_ctx
    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT name, artist, year, musicbrainz_albumid, path "
            "FROM library_albums WHERE has_cover = 0 OR has_cover IS NULL "
            "ORDER BY artist, year"
        )
        albums = []
        for r in cur.fetchall():
            albums.append({
                "name": r["name"],
                "display_name": year_re.sub("", r["name"]),
                "artist": r["artist"],
                "year": r.get("year", ""),
                "mbid": r.get("musicbrainz_albumid"),
                "path": r.get("path", ""),
            })
    return {"missing_count": len(albums), "albums": albums}


@router.post("/api/artwork/scan")
def api_artwork_scan(request: Request, body: dict | None = None):
    """Queue a full scan for missing covers with source search. Returns task_id for SSE streaming."""
    _require_admin(request)
    auto_apply = body.get("auto_apply", False) if body else False
    task_id = create_task("scan_missing_covers", {"auto_apply": auto_apply})
    return {"task_id": task_id}


@router.post("/api/artwork/apply")
def api_artwork_apply(request: Request, body: dict):
    """Apply a specific cover to an album."""
    _require_admin(request)
    task_id = create_task("apply_cover", body)
    return {"task_id": task_id}


@router.post("/api/artwork/fetch")
def api_artwork_fetch(request: Request, data: FetchRequest):
    """Queue a task to fetch cover art from CAA."""
    _require_admin(request)
    if not data.mbid:
        return JSONResponse({"error": "No MBID provided"}, status_code=400)
    task_id = create_task("fetch_cover", {"mbid": data.mbid, "path": data.path})
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artwork/extract")
def api_artwork_extract(request: Request, data: ExtractRequest):
    """Extract embedded cover — fast enough to run inline."""
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, data.path)
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Album not found"}, status_code=404)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    if not tracks:
        return JSONResponse({"error": "No tracks found"}, status_code=404)

    image = extract_embedded_cover(tracks[0])
    if not image:
        return JSONResponse({"error": "No embedded cover found"}, status_code=404)

    save_cover(album_dir, image)
    return {"status": "saved", "path": str(album_dir / "cover.jpg")}


@router.post("/api/artwork/fetch-artist/{name}")
def api_artwork_fetch_artist(request: Request, name: str):
    """Queue a task to fetch covers for all albums by an artist."""
    _require_admin(request)
    task_id = create_task("fetch_artist_covers", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artwork/fetch-all")
def api_artwork_fetch_all(request: Request):
    """Queue a task to fetch all missing covers."""
    _require_admin(request)
    task_id = create_task("fetch_artwork_all")
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artwork/upload-cover/{artist:path}/{album:path}")
async def api_upload_cover(request: Request, artist: str, album: str, file: UploadFile = File(...)):
    """Upload a cover image for an album. Saved to staging, worker copies to album dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "cover", "artist": artist, "album": album,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artwork/upload-artist-photo/{name:path}")
async def api_upload_artist_photo(request: Request, name: str, file: UploadFile = File(...)):
    """Upload artist photo. Worker saves to artist dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "artist_photo", "artist": name,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artwork/upload-background/{name:path}")
async def api_upload_background(request: Request, name: str, file: UploadFile = File(...)):
    """Upload artist background. Worker saves to artist dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "background", "artist": name,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}
