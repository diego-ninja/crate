from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.artwork import scan_missing_covers, fetch_cover_from_caa, extract_embedded_cover, save_cover
from musicdock.audio import get_audio_files
from musicdock.api._deps import library_path, extensions, safe_path

router = APIRouter()


class FetchRequest(BaseModel):
    mbid: str
    path: str | None = None


class ExtractRequest(BaseModel):
    path: str


@router.get("/api/artwork/missing")
def api_artwork_missing():
    lib = library_path()
    exts = extensions()
    missing = scan_missing_covers(lib, exts)
    return missing


@router.post("/api/artwork/fetch")
def api_artwork_fetch(data: FetchRequest):
    if not data.mbid:
        return JSONResponse({"error": "No MBID provided"}, status_code=400)

    lib = library_path()
    album_dir = safe_path(lib, data.path) if data.path else None

    image = fetch_cover_from_caa(data.mbid)
    if not image:
        return JSONResponse({"error": "No cover found on CAA"}, status_code=404)

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        return {"status": "saved", "path": str(album_dir / "cover.jpg")}

    return JSONResponse({"error": "Album directory not found"}, status_code=404)


@router.post("/api/artwork/extract")
def api_artwork_extract(data: ExtractRequest):
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


@router.post("/api/artwork/fetch-all")
def api_artwork_fetch_all():
    lib = library_path()
    exts = extensions()
    missing = scan_missing_covers(lib, exts)

    fetched = 0
    failed = 0
    for album in missing:
        mbid = album.get("mbid")
        if not mbid:
            continue
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    return {"fetched": fetched, "failed": failed, "total": len(missing)}
