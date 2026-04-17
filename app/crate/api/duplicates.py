import mutagen
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.operations import (
    DuplicateAlbumCompareResponse,
    ResolveRequest,
)
from crate.audio import read_tags, get_audio_files
from crate.db import create_task
from crate.api._deps import library_path, extensions, safe_path, COVER_NAMES

router = APIRouter(tags=["duplicates"])

_DUPLICATES_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        422: error_response("The request payload failed validation."),
    },
)


@router.get(
    "/api/duplicates/compare",
    response_model=list[DuplicateAlbumCompareResponse],
    responses=_DUPLICATES_RESPONSES,
    summary="Compare duplicate album directories",
)
def api_duplicates_compare(request: Request, path: list[str] = Query()):
    _require_admin(request)
    if len(path) < 2:
        return JSONResponse({"error": "Need at least 2 paths"}, status_code=400)

    lib = library_path()
    exts = extensions()
    albums = []

    for p in path:
        album_dir = safe_path(lib, p)
        if not album_dir or not album_dir.is_dir():
            continue

        tracks = get_audio_files(album_dir, exts)
        track_list = []
        for t in tracks:
            tags = read_tags(t)
            info = mutagen.File(t)
            bitrate = getattr(info.info, "bitrate", 0) if info else 0
            length = getattr(info.info, "length", 0) if info else 0
            track_list.append({
                "filename": t.name,
                "format": t.suffix.lower(),
                "size_mb": round(t.stat().st_size / (1024**2), 1),
                "bitrate": bitrate // 1000 if bitrate else None,
                "length_sec": round(length) if length else 0,
                "title": tags.get("title", t.stem),
                "tracknumber": tags.get("tracknumber", ""),
            })

        has_cover = any((album_dir / c).exists() for c in COVER_NAMES)
        total_size = sum(t.stat().st_size for t in tracks)
        formats = list({t.suffix.lower() for t in tracks})

        albums.append({
            "path": p,
            "name": album_dir.name,
            "artist": album_dir.parent.name,
            "track_count": len(tracks),
            "total_size_mb": round(total_size / (1024**2)),
            "formats": formats,
            "has_cover": has_cover,
            "tracks": track_list,
        })

    return albums


@router.post(
    "/api/duplicates/resolve",
    response_model=TaskEnqueueResponse,
    responses=_DUPLICATES_RESPONSES,
    summary="Queue duplicate resolution",
)
def api_duplicates_resolve(request: Request, data: ResolveRequest):
    _require_admin(request)
    if not data.keep or not data.remove:
        return JSONResponse({"error": "Need 'keep' and 'remove' paths"}, status_code=400)

    task_id = create_task("resolve_duplicates", {
        "keep": data.keep,
        "remove": data.remove,
    })
    return {"task_id": task_id}
