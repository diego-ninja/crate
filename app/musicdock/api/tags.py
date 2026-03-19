import mutagen
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.audio import get_audio_files
from musicdock.api._deps import library_path, extensions, safe_path

router = APIRouter()


class AlbumTagsUpdate(BaseModel):
    artist: str | None = None
    albumartist: str | None = None
    album: str | None = None
    date: str | None = None
    genre: str | None = None
    tracks: dict[str, dict[str, str]] = {}


class TrackTagsUpdate(BaseModel):
    model_config = {"extra": "allow"}


@router.put("/api/tags/{artist:path}/{album:path}")
def api_update_tags(artist: str, album: str, data: AlbumTagsUpdate):
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    updated = 0
    errors = []

    album_fields = {}
    for field in ["artist", "albumartist", "album", "date", "genre"]:
        val = getattr(data, field, None)
        if val is not None:
            album_fields[field] = val

    track_tags = data.tracks

    for track in tracks:
        try:
            audio = mutagen.File(track, easy=True)
            if audio is None:
                continue

            for key, val in album_fields.items():
                audio[key] = val

            if track.name in track_tags:
                for key, val in track_tags[track.name].items():
                    audio[key] = val

            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": track.name, "error": str(e)})

    return {"updated": updated, "errors": errors}


@router.put("/api/tags/track/{filepath:path}")
def api_update_track_tags(filepath: str, data: TrackTagsUpdate):
    lib = library_path()
    track_path = safe_path(lib, filepath)
    if not track_path or not track_path.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)

    tag_data = data.model_dump()

    try:
        audio = mutagen.File(track_path, easy=True)
        if audio is None:
            return JSONResponse({"error": "Cannot read file"}, status_code=400)

        for key, val in tag_data.items():
            audio[key] = val

        audio.save()
        return {"status": "ok", "file": track_path.name}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
