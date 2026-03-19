import shutil
from typing import List

import mutagen
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from librarian.audio import read_tags, get_audio_files
from librarian.api._deps import library_path, extensions, safe_path, COVER_NAMES

router = APIRouter()


class ResolveRequest(BaseModel):
    keep: str
    remove: list[str]


@router.get("/api/duplicates/compare")
def api_duplicates_compare(path: list[str] = Query()):
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


@router.post("/api/duplicates/resolve")
def api_duplicates_resolve(data: ResolveRequest):
    if not data.keep or not data.remove:
        return JSONResponse({"error": "Need 'keep' and 'remove' paths"}, status_code=400)

    lib = library_path()
    trash = lib / ".librarian-trash"
    removed = []

    for path_str in data.remove:
        album_dir = safe_path(lib, path_str)
        if not album_dir or not album_dir.is_dir():
            continue

        dest = trash / album_dir.relative_to(lib)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(album_dir), str(dest))
        removed.append(path_str)

    return {"kept": data.keep, "removed": removed}
