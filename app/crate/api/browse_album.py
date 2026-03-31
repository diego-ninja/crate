from pathlib import Path

import mutagen
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import COVER_NAMES, extensions, library_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import display_name, find_album_dir, find_album_row, fs_album_detail, has_library_data
from crate.audio import get_audio_files
from crate.db import get_db_ctx, get_library_tracks

router = APIRouter()


@router.get("/api/album/{artist:path}/{album:path}/related")
def api_related_albums(request: Request, artist: str, album: str, limit: int = 15):
    """Find related albums: same artist, same genre+decade, similar audio profile."""
    _require_auth(request)
    related = []
    seen = set()

    current = find_album_row(artist, album)
    if not current:
        return []

    album_id = current["id"]

    with get_db_ctx() as cur:
        year = current["year"][:4] if current.get("year") and len(current.get("year", "")) >= 4 else None
        seen.add(album_id)

        cur.execute("SELECT genre_id FROM album_genres WHERE album_id = %s", (album_id,))
        genre_ids = [row["genre_id"] for row in cur.fetchall()]

        cur.execute(
            "SELECT id, name, artist, year, track_count, has_cover FROM library_albums "
            "WHERE artist = %s AND id != %s ORDER BY year",
            (artist, album_id),
        )
        for row in cur.fetchall():
            if row["id"] not in seen:
                seen.add(row["id"])
                related.append({**dict(row), "reason": "same_artist"})

        if genre_ids and year:
            year_int = int(year)
            placeholders = ",".join(["%s"] * len(genre_ids))
            cur.execute(
                f"""
                SELECT DISTINCT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover
                FROM library_albums a
                JOIN album_genres ag ON a.id = ag.album_id
                WHERE ag.genre_id IN ({placeholders})
                AND a.artist != %s
                AND a.year IS NOT NULL AND length(a.year) >= 4
                AND CAST(substring(a.year, 1, 4) AS INTEGER) BETWEEN %s AND %s
                ORDER BY RANDOM() LIMIT 10
                """,
                (*genre_ids, artist, year_int - 5, year_int + 5),
            )
            for row in cur.fetchall():
                if row["id"] not in seen:
                    seen.add(row["id"])
                    related.append({**dict(row), "reason": "genre_decade"})

        cur.execute(
            """
            SELECT AVG(energy) AS e, AVG(danceability) AS d, AVG(valence) AS v
            FROM library_tracks WHERE album_id = %s AND energy IS NOT NULL
            """,
            (album_id,),
        )
        audio = cur.fetchone()
        if audio and audio["e"] is not None:
            cur.execute(
                """
                SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                    ABS(AVG(t.energy) - %s) + ABS(AVG(t.danceability) - %s) + ABS(AVG(t.valence) - %s) AS dist
                FROM library_albums a
                JOIN library_tracks t ON t.album_id = a.id
                WHERE t.energy IS NOT NULL AND a.id != %s AND a.artist != %s
                GROUP BY a.id, a.name, a.artist, a.year, a.track_count, a.has_cover
                ORDER BY dist ASC LIMIT 8
                """,
                (audio["e"], audio["d"], audio["v"], album_id, artist),
            )
            for row in cur.fetchall():
                if row["id"] not in seen:
                    seen.add(row["id"])
                    related.append({**dict(row), "reason": "audio_similar"})

    import re

    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    for row in related:
        row["display_name"] = year_re.sub("", row["name"])

    return related[:limit]


@router.get("/api/album/{artist:path}/{album:path}")
def api_album(request: Request, artist: str, album: str):
    _require_auth(request)
    if not has_library_data():
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    album_data = find_album_row(artist, album)
    if not album_data:
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    tracks_data = get_library_tracks(album_data["id"])
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    has_cover = album_data.get("has_cover", False)
    cover_file = None
    if album_dir and album_dir.is_dir():
        for cover_name in COVER_NAMES:
            if (album_dir / cover_name).exists():
                cover_file = cover_name
                break

    track_list = []
    album_tags = {}
    for track in tracks_data:
        track_list.append(
            {
                "id": track["id"],
                "filename": track["filename"],
                "format": track.get("format", ""),
                "size_mb": round(track["size"] / (1024**2), 1) if track.get("size") else 0,
                "bitrate": track.get("bitrate") // 1000 if track.get("bitrate") else None,
                "length_sec": round(track["duration"]) if track.get("duration") else 0,
                "rating": track.get("rating", 0) or 0,
                "tags": {
                    "title": track.get("title", ""),
                    "artist": track.get("artist", ""),
                    "album": track.get("album", ""),
                    "albumartist": track.get("albumartist", ""),
                    "tracknumber": str(track.get("track_number", "")),
                    "discnumber": str(track.get("disc_number", "")),
                    "date": track.get("year", ""),
                    "genre": track.get("genre", ""),
                    "musicbrainz_albumid": track.get("musicbrainz_albumid", ""),
                    "musicbrainz_trackid": track.get("musicbrainz_trackid", ""),
                },
                "path": str(Path(track["path"]).relative_to(lib)) if track.get("path") else "",
            }
        )
        if not album_tags and track.get("album"):
            album_tags = {
                "artist": track.get("albumartist") or track.get("artist", ""),
                "album": track.get("album", ""),
                "year": track.get("year", "")[:4] if track.get("year") else "",
                "genre": track.get("genre", ""),
                "musicbrainz_albumid": track.get("musicbrainz_albumid"),
            }

    total_size = sum(track.get("size", 0) or 0 for track in tracks_data)
    total_length = sum(track["length_sec"] for track in track_list)

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM album_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.album_id = %s ORDER BY ag.weight DESC",
            (album_data["id"],),
        )
        album_genres = [row["name"] for row in cur.fetchall()]

    if album_genres:
        album_tags["genre"] = ", ".join(album_genres)

    return {
        "id": album_data["id"],
        "artist": artist,
        "name": album,
        "display_name": display_name(album),
        "path": album_data.get("path", ""),
        "track_count": len(tracks_data),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": bool(has_cover),
        "cover_file": cover_file,
        "tracks": track_list,
        "album_tags": album_tags,
        "genres": album_genres,
    }


@router.get("/api/cover/{artist:path}/{album:path}")
def api_cover(artist: str, album: str):
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return Response(status_code=404)

    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.exists():
            media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
            return Response(content=cover.read_bytes(), media_type=media_type)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    if tracks:
        audio = mutagen.File(tracks[0])
        if audio and hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            return Response(content=pic.data, media_type=pic.mime)
        if audio and hasattr(audio, "tags") and audio.tags:
            for key in audio.tags:
                if key.startswith("APIC"):
                    pic = audio.tags[key]
                    return Response(content=pic.data, media_type=pic.mime)

    return Response(status_code=404)


@router.get("/api/download/album/{artist:path}/{album:path}")
def api_download_album(request: Request, artist: str, album: str):
    """Download an entire album as a ZIP file."""
    _require_auth(request)
    import tempfile
    import zipfile

    from fastapi.responses import FileResponse

    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return Response(status_code=404)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()

    exts = extensions()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as zip_file:
        for file_path in sorted(album_dir.iterdir()):
            if file_path.is_file() and (
                file_path.suffix.lower() in exts
                or file_path.name.lower() in ("cover.jpg", "cover.png", "folder.jpg", "front.jpg")
            ):
                zip_file.write(str(file_path), file_path.name)

    safe_name = f"{artist} - {album}.zip".replace("/", "-")
    return FileResponse(path=tmp.name, filename=safe_name, media_type="application/zip", background=None)
