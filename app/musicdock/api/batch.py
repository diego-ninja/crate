from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.artwork import fetch_cover_from_caa, save_cover
from musicdock.matcher import match_album, apply_match
from musicdock.api._deps import library_path, extensions, safe_path

router = APIRouter()


class BatchAlbumItem(BaseModel):
    artist: str
    album: str


class BatchRetagRequest(BaseModel):
    albums: list[BatchAlbumItem]


class BatchCoverItem(BaseModel):
    mbid: str | None = None
    path: str


class BatchFetchCoversRequest(BaseModel):
    albums: list[BatchCoverItem]


@router.post("/api/batch/retag")
def api_batch_retag(data: BatchRetagRequest):
    lib = library_path()
    exts = extensions()
    results = []

    for item in data.albums:
        album_dir = safe_path(lib, f"{item.artist}/{item.album}")
        if not album_dir or not album_dir.is_dir():
            results.append({"artist": item.artist, "album": item.album, "error": "Not found"})
            continue

        candidates = match_album(album_dir, exts)
        if not candidates:
            results.append({"artist": item.artist, "album": item.album, "error": "No MB match"})
            continue

        best = candidates[0]
        if best["match_score"] < 60:
            results.append({"artist": item.artist, "album": item.album, "error": f"Low score: {best['match_score']}"})
            continue

        result = apply_match(album_dir, exts, best)
        result["artist"] = item.artist
        result["album"] = item.album
        result["match_score"] = best["match_score"]
        results.append(result)

    return results


@router.post("/api/batch/fetch-covers")
def api_batch_fetch_covers(data: BatchFetchCoversRequest):
    lib = library_path()
    results = []

    for item in data.albums:
        if not item.mbid:
            results.append({"path": item.path, "error": "No MBID"})
            continue

        album_dir = safe_path(lib, item.path)
        if not album_dir or not album_dir.is_dir():
            results.append({"path": item.path, "error": "Not found"})
            continue

        image = fetch_cover_from_caa(item.mbid)
        if image:
            save_cover(album_dir, image)
            results.append({"path": item.path, "status": "fetched"})
        else:
            results.append({"path": item.path, "error": "Not found on CAA"})

    return results
