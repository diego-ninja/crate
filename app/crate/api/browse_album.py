from pathlib import Path

import mutagen
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import COVER_NAMES, extensions, library_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import display_name, find_album_dir, find_album_row, fs_album_detail, has_library_data
from crate.audio import get_audio_files
from crate.db import get_db_ctx, get_library_album_by_id, get_library_artist, get_library_tracks

router = APIRouter()


@router.get("/api/albums/{album_id}/related")
def api_related_albums_by_id(request: Request, album_id: int, limit: int = 15):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_related_albums(request, album["artist"], album["name"], limit)


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
            "SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, "
            "a.year, a.track_count, a.has_cover "
            "FROM library_albums a LEFT JOIN library_artists ar ON ar.name = a.artist "
            "WHERE a.artist = %s AND a.id != %s ORDER BY a.year",
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
                SELECT DISTINCT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
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
                SELECT a.id, a.slug, a.name, a.artist, ar.id AS artist_id, ar.slug AS artist_slug,
                    a.year, a.track_count, a.has_cover,
                    ABS(AVG(t.energy) - %s) + ABS(AVG(t.danceability) - %s) + ABS(AVG(t.valence) - %s) AS dist
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                JOIN library_tracks t ON t.album_id = a.id
                WHERE t.energy IS NOT NULL AND a.id != %s AND a.artist != %s
                GROUP BY a.id, a.slug, a.name, a.artist, ar.id, ar.slug, a.year, a.track_count, a.has_cover
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
        "slug": album_data.get("slug"),
        "artist_id": artist_row["id"] if (artist_row := get_library_artist(artist)) else None,
        "artist_slug": artist_row["slug"] if artist_row else None,
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


@router.get("/api/albums/{album_id}")
def api_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, album["artist"], album["name"])


def _placeholder_cover(seed: str) -> Response:
    """Return a deterministic SVG placeholder so <img> never 404s."""
    # Pick a hue from the seed string
    h = sum(ord(c) for c in (seed or "?")) % 360
    initial = (seed.strip()[:1] or "?").upper()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="hsl({h},45%,28%)"/>'
        f'<stop offset="100%" stop-color="hsl({(h + 30) % 360},35%,15%)"/>'
        f'</linearGradient></defs>'
        f'<rect width="200" height="200" fill="url(#g)"/>'
        f'<text x="100" y="118" font-family="sans-serif" font-size="86" '
        f'font-weight="700" fill="rgba(255,255,255,0.42)" text-anchor="middle">{initial}</text>'
        f'</svg>'
    )
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _extract_embedded_cover(audio_file: Path) -> tuple[bytes, str] | None:
    """Return (data, mime) for the first embedded cover in ``audio_file``.

    Handles FLAC (``audio.pictures``), Ogg/Opus (METADATA_BLOCK_PICTURE) and
    ID3-tagged files (MP3/AIFF with APIC frames) without blowing up on the
    tuple-vs-string iteration difference between ``VComment`` and ``ID3``.
    """
    try:
        audio = mutagen.File(audio_file)
    except Exception:
        return None
    if audio is None:
        return None

    # FLAC / Ogg / Opus expose pictures directly.
    pictures = getattr(audio, "pictures", None)
    if pictures:
        pic = pictures[0]
        return pic.data, pic.mime

    tags = getattr(audio, "tags", None)
    if not tags:
        return None

    # ID3 (MP3, AIFF, WAV) — tags iterates as string frame keys and indexing
    # returns the frame object. FLAC VComment iterates as (key, value) tuples
    # where the value is a plain text string, so APIC never lives there.
    try:
        keys = list(tags.keys()) if hasattr(tags, "keys") else list(tags)
    except Exception:
        return None
    for key in keys:
        if not isinstance(key, str) or not key.startswith("APIC"):
            continue
        frame = tags.get(key) if hasattr(tags, "get") else tags[key]
        data = getattr(frame, "data", None)
        mime = getattr(frame, "mime", None) or "image/jpeg"
        if data:
            return data, mime
    return None


def api_cover(artist: str, album: str, album_dir: Path | None = None):
    lib = library_path()
    # Prefer the caller-supplied canonical directory (from api_cover_by_id)
    # so we don't get fooled by a loose duplicate folder under /Artist/Album
    # that shadows the real /Artist/YYYY/Album entry in the DB.
    if album_dir is None or not album_dir.is_dir():
        album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return _placeholder_cover(album or artist)

    _IMG_CACHE = {"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"}

    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.exists():
            media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
            return Response(content=cover.read_bytes(), media_type=media_type, headers=_IMG_CACHE)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    for track in tracks:
        extracted = _extract_embedded_cover(track)
        if extracted:
            data, mime = extracted
            return Response(content=data, media_type=mime, headers=_IMG_CACHE)

    return _placeholder_cover(album or artist)


@router.get("/api/albums/{album_id}/cover")
def api_cover_by_id(album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return _placeholder_cover("?")
    stored_path = album.get("path")
    album_dir = Path(stored_path) if stored_path else None
    return api_cover(album["artist"], album["name"], album_dir=album_dir)


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


@router.get("/api/albums/{album_id}/download")
def api_download_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return Response(status_code=404)
    return api_download_album(request, album["artist"], album["name"])
