from io import BytesIO
from pathlib import Path

import mutagen
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from librarian.audio import read_tags, get_audio_files
from librarian.api._deps import library_path, extensions, safe_path, COVER_NAMES, exclude_dirs
from librarian.db import get_cache, set_cache
from librarian.lastfm import get_artist_info, download_artist_image

router = APIRouter()

ARTIST_PHOTO_NAMES = ["artist.jpg", "artist.png", "photo.jpg"]


_ARTISTS_CACHE_TTL = 300  # 5 minutes


def _build_artists_list() -> list[dict]:
    """Build full artists list (expensive). Cached in SQLite."""
    cached = get_cache("artists_list", max_age_seconds=_ARTISTS_CACHE_TTL)
    if cached:
        return cached["artists"]

    lib = library_path()
    exts = extensions()
    excluded = exclude_dirs()
    artists = []

    for d in sorted(lib.iterdir()):
        if not d.is_dir() or d.name.startswith(".") or d.name.startswith("_") or d.name in excluded:
            continue

        album_count = 0
        track_count = 0
        total_size = 0
        fmt_counts: dict[str, int] = {}

        for album_dir in d.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            album_count += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    track_count += 1
                    ext = f.suffix.lower()
                    fmt_counts[ext] = fmt_counts.get(ext, 0) + 1
                    total_size += f.stat().st_size

        primary_format = max(fmt_counts, key=fmt_counts.get) if fmt_counts else None
        has_photo = any((d / p).exists() for p in ARTIST_PHOTO_NAMES)

        artists.append({
            "name": d.name,
            "albums": album_count,
            "tracks": track_count,
            "total_size_mb": round(total_size / (1024 ** 2)),
            "formats": list(fmt_counts.keys()),
            "primary_format": primary_format,
            "has_photo": has_photo,
        })

    set_cache("artists_list", {"artists": artists})
    return artists


@router.get("/api/artists")
def api_artists(
    q: str = "",
    page: int = 1,
    per_page: int = 60,
    sort: str = "name",
):
    artists = _build_artists_list()

    q_lower = q.lower()
    if q_lower:
        artists = [a for a in artists if q_lower in a["name"].lower()]

    if sort == "albums":
        artists.sort(key=lambda a: a["albums"], reverse=True)
    elif sort == "size":
        artists.sort(key=lambda a: a["total_size_mb"], reverse=True)
    else:
        artists.sort(key=lambda a: a["name"].lower())

    total = len(artists)
    start = (page - 1) * per_page
    end = start + per_page

    return {"items": artists[start:end], "total": total, "page": page, "per_page": per_page}


@router.get("/api/artist/{name}/background")
def api_artist_background(name: str):
    """Return artist background image URL (1920x1080 panoramic from fanart.tv)."""
    from librarian.lastfm import get_fanart_background, download_artist_image
    url = get_fanart_background(name)
    if not url:
        return Response(status_code=404)
    image_data = download_artist_image(url)
    if not image_data:
        return Response(status_code=404)
    return Response(content=image_data, media_type="image/jpeg")


@router.get("/api/artist/{name}/photo")
def api_artist_photo(name: str):
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return Response(status_code=404)

    for photo_name in ARTIST_PHOTO_NAMES:
        photo = artist_dir / photo_name
        if photo.exists():
            media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
            return Response(content=photo.read_bytes(), media_type=media_type)

    # Fallback: first album's cover
    exts = extensions()
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue

        for c in COVER_NAMES:
            cover = album_dir / c
            if cover.exists():
                media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
                return Response(content=cover.read_bytes(), media_type=media_type)

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
        break

    # Fallback: fanart.tv / Last.fm
    from librarian.lastfm import get_best_artist_image
    image_data = get_best_artist_image(name)
    if image_data:
        save_path = artist_dir / "artist.jpg"
        try:
            save_path.write_bytes(image_data)
        except OSError:
            pass  # read-only filesystem
        return Response(content=image_data, media_type="image/jpeg")

    return Response(status_code=404)


@router.get("/api/artist/{name}/info")
def api_artist_info(name: str):
    info = get_artist_info(name)
    if not info:
        return JSONResponse({"error": "Not found on Last.fm"}, status_code=404)
    return info


@router.get("/api/artist/{name:path}")
def api_artist(name: str):
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    albums = []
    total_tracks = 0
    total_size = 0
    all_fmt_counts: dict[str, int] = {}
    genre_counts: dict[str, int] = {}

    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue

        tracks = get_audio_files(album_dir, exts)
        formats = list({t.suffix.lower() for t in tracks})
        album_size = sum(t.stat().st_size for t in tracks)
        has_cover = any((album_dir / c).exists() for c in COVER_NAMES)

        total_tracks += len(tracks)
        total_size += album_size

        for t in tracks:
            ext = t.suffix.lower()
            all_fmt_counts[ext] = all_fmt_counts.get(ext, 0) + 1

        year = ""
        if tracks:
            tags = read_tags(tracks[0])
            year = tags.get("date", "")[:4]
            genre = tags.get("genre", "")
            if genre:
                genre_counts[genre] = genre_counts.get(genre, 0) + 1

        albums.append({
            "name": album_dir.name,
            "tracks": len(tracks),
            "formats": formats,
            "size_mb": round(album_size / (1024 ** 2)),
            "year": year,
            "has_cover": has_cover,
        })

    primary_format = max(all_fmt_counts, key=all_fmt_counts.get) if all_fmt_counts else None
    top_genres = [g for g, _ in sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)[:5]]

    return {
        "name": name,
        "albums": albums,
        "total_tracks": total_tracks,
        "total_size_mb": round(total_size / (1024 ** 2)),
        "primary_format": primary_format,
        "genres": top_genres,
    }


@router.get("/api/album/{artist:path}/{album:path}")
def api_album(artist: str, album: str):
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    has_cover = any((album_dir / c).exists() for c in COVER_NAMES)
    cover_file = None
    for c in COVER_NAMES:
        if (album_dir / c).exists():
            cover_file = c
            break

    track_list = []
    album_tags = {}

    for t in tracks:
        tags = read_tags(t)
        info = mutagen.File(t)
        bitrate = getattr(info.info, "bitrate", 0)
        length = getattr(info.info, "length", 0)

        track_list.append({
            "filename": t.name,
            "format": t.suffix.lower(),
            "size_mb": round(t.stat().st_size / (1024**2), 1),
            "bitrate": bitrate // 1000 if bitrate else None,
            "length_sec": round(length) if length else 0,
            "tags": tags,
        })

        if not album_tags and tags.get("album"):
            album_tags = {
                "artist": tags.get("albumartist") or tags.get("artist", ""),
                "album": tags.get("album", ""),
                "year": tags.get("date", "")[:4],
                "genre": tags.get("genre", "") if "genre" in tags else "",
                "musicbrainz_albumid": tags.get("musicbrainz_albumid"),
            }

    total_size = sum(t.stat().st_size for t in tracks)
    total_length = sum(tr["length_sec"] for tr in track_list)

    return {
        "artist": artist,
        "name": album,
        "path": str(album_dir),
        "track_count": len(tracks),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": has_cover,
        "cover_file": cover_file,
        "tracks": track_list,
        "album_tags": album_tags,
    }


@router.get("/api/cover/{artist:path}/{album:path}")
def api_cover(artist: str, album: str):
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return Response(status_code=404)

    for c in COVER_NAMES:
        cover = album_dir / c
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


@router.get("/api/search")
def api_search(q: str = ""):
    q_lower = q.lower().strip()
    if len(q_lower) < 2:
        return {"artists": [], "albums": []}

    lib = library_path()
    excluded = exclude_dirs()
    artists = []
    albums = []

    for artist_dir in sorted(lib.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith(".") or artist_dir.name.startswith("_") or artist_dir.name in excluded:
            continue

        if q_lower in artist_dir.name.lower():
            artists.append({"name": artist_dir.name})

        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            if q_lower in album_dir.name.lower() or q_lower in artist_dir.name.lower():
                albums.append({
                    "artist": artist_dir.name,
                    "name": album_dir.name,
                })

        if len(artists) > 20 and len(albums) > 50:
            break

    return {
        "artists": artists[:20],
        "albums": albums[:50],
    }
