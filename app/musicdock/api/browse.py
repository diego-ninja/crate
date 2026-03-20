from io import BytesIO
from pathlib import Path

import mutagen
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from musicdock.audio import read_tags, get_audio_files
from musicdock.api._deps import library_path, extensions, safe_path, COVER_NAMES, exclude_dirs
from musicdock.db import (
    get_library_artists, get_library_artist, get_library_albums,
    get_library_album, get_library_tracks, get_library_track_count,
    get_db_ctx,
)
from musicdock.lastfm import get_artist_info, get_best_artist_image

router = APIRouter()

ARTIST_PHOTO_NAMES = ["artist.jpg", "artist.png", "photo.jpg"]


def _has_library_data() -> bool:
    return get_library_track_count() > 0


# ── Filesystem fallbacks (used when DB is empty) ─────────────────


def _fs_build_artists_list() -> list[dict]:
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
    return artists


def _fs_artist_detail(name: str) -> dict | None:
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return None

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


def _fs_album_detail(artist: str, album: str) -> dict | None:
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return None

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


def _fs_search(q: str) -> dict:
    lib = library_path()
    excluded = exclude_dirs()
    artists = []
    albums = []
    q_lower = q.lower().strip()

    for artist_dir in sorted(lib.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith(".") or artist_dir.name.startswith("_") or artist_dir.name in excluded:
            continue
        if q_lower in artist_dir.name.lower():
            artists.append({"name": artist_dir.name})
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            if q_lower in album_dir.name.lower() or q_lower in artist_dir.name.lower():
                albums.append({"artist": artist_dir.name, "name": album_dir.name})
        if len(artists) > 20 and len(albums) > 50:
            break

    return {"artists": artists[:20], "albums": albums[:50]}


# ── API endpoints ────────────────────────────────────────────────


@router.get("/api/artists")
def api_artists(
    q: str = "",
    page: int = 1,
    per_page: int = 60,
    sort: str = "name",
):
    if not _has_library_data():
        # Fallback to filesystem
        artists = _fs_build_artists_list()
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
        return {"items": artists[start:start + per_page], "total": total, "page": page, "per_page": per_page}

    sort_map = {"name": "name", "albums": "albums", "size": "size", "recent": "updated", "tracks": "tracks"}
    db_sort = sort_map.get(sort, "name")
    rows, total = get_library_artists(q=q or None, sort=db_sort, page=page, per_page=per_page)

    items = []
    for r in rows:
        items.append({
            "name": r["name"],
            "albums": r["album_count"],
            "tracks": r["track_count"],
            "total_size_mb": round(r["total_size"] / (1024 ** 2)) if r["total_size"] else 0,
            "formats": r.get("formats", []),
            "primary_format": r.get("primary_format"),
            "has_photo": bool(r.get("has_photo")),
        })

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/api/artist/{name}/background")
def api_artist_background(name: str, random_pick: bool = Query(False, alias="random")):
    """Return artist background image (1920x1080 panoramic from fanart.tv)."""
    import random as _random
    from musicdock.lastfm import get_fanart_all_images, get_fanart_background, download_artist_image

    fanart = get_fanart_all_images(name)
    backgrounds = fanart.get("backgrounds", []) if fanart else []

    if backgrounds:
        url = _random.choice(backgrounds) if random_pick else backgrounds[0]
    else:
        url = get_fanart_background(name)

    if not url:
        return Response(status_code=404)
    image_data = download_artist_image(url)
    if not image_data:
        return Response(status_code=404)
    return Response(content=image_data, media_type="image/jpeg")


@router.get("/api/artist/{name}/photo")
def api_artist_photo(name: str, random_pick: bool = Query(False, alias="random")):
    import random as _random
    from musicdock.lastfm import get_fanart_all_images, download_artist_image

    # When random=true, pick from fanart.tv thumbs directly
    if random_pick:
        fanart = get_fanart_all_images(name)
        thumbs = fanart.get("thumbs", []) if fanart else []
        if thumbs:
            url = _random.choice(thumbs)
            image_data = download_artist_image(url)
            if image_data:
                return Response(content=image_data, media_type="image/jpeg")

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
    from musicdock.lastfm import get_best_artist_image
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


@router.post("/api/artist/{name}/enrich")
def api_artist_enrich(name: str):
    """Queue a full enrichment task for an artist (async via worker)."""
    from musicdock.db import create_task as _create_task
    task_id = _create_task("enrich_artist", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.get("/api/artist/{name:path}")
def api_artist(name: str):
    if not _has_library_data():
        result = _fs_artist_detail(name)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    artist = get_library_artist(name)
    if not artist:
        # Try filesystem fallback for artists not yet synced
        result = _fs_artist_detail(name)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    albums_data = get_library_albums(name)

    # Get genres from tracks
    genres: dict[str, int] = {}
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT genre, COUNT(*) as cnt FROM library_tracks WHERE artist = %s AND genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY cnt DESC LIMIT 5",
            (name,),
        )
        genre_rows = cur.fetchall()
    for row in genre_rows:
        genres[row["genre"]] = row["cnt"]
    top_genres = list(genres.keys())

    albums = []
    for a in albums_data:
        albums.append({
            "name": a["name"],
            "tracks": a["track_count"],
            "formats": a.get("formats", []),
            "size_mb": round(a["total_size"] / (1024 ** 2)) if a["total_size"] else 0,
            "year": a.get("year", ""),
            "has_cover": bool(a.get("has_cover")),
        })

    return {
        "name": name,
        "albums": albums,
        "total_tracks": artist["track_count"],
        "total_size_mb": round(artist["total_size"] / (1024 ** 2)) if artist["total_size"] else 0,
        "primary_format": artist.get("primary_format"),
        "genres": top_genres,
    }


@router.get("/api/album/{artist:path}/{album:path}")
def api_album(artist: str, album: str):
    if not _has_library_data():
        result = _fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    album_data = get_library_album(artist, album)
    if not album_data:
        # Fallback to filesystem for albums not yet synced
        result = _fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    tracks_data = get_library_tracks(album_data["id"])

    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    has_cover = album_data.get("has_cover", False)
    cover_file = None
    if album_dir and album_dir.is_dir():
        for c in COVER_NAMES:
            if (album_dir / c).exists():
                cover_file = c
                break

    track_list = []
    album_tags = {}
    for t in tracks_data:
        track_list.append({
            "filename": t["filename"],
            "format": t.get("format", ""),
            "size_mb": round(t["size"] / (1024**2), 1) if t.get("size") else 0,
            "bitrate": t.get("bitrate") // 1000 if t.get("bitrate") else None,
            "length_sec": round(t["duration"]) if t.get("duration") else 0,
            "tags": {
                "title": t.get("title", ""),
                "artist": t.get("artist", ""),
                "album": t.get("album", ""),
                "albumartist": t.get("albumartist", ""),
                "tracknumber": str(t.get("track_number", "")),
                "discnumber": str(t.get("disc_number", "")),
                "date": t.get("year", ""),
                "genre": t.get("genre", ""),
                "musicbrainz_albumid": t.get("musicbrainz_albumid", ""),
                "musicbrainz_trackid": t.get("musicbrainz_trackid", ""),
            },
        })
        if not album_tags and t.get("album"):
            album_tags = {
                "artist": t.get("albumartist") or t.get("artist", ""),
                "album": t.get("album", ""),
                "year": t.get("year", "")[:4] if t.get("year") else "",
                "genre": t.get("genre", ""),
                "musicbrainz_albumid": t.get("musicbrainz_albumid"),
            }

    total_size = sum(t.get("size", 0) or 0 for t in tracks_data)
    total_length = sum(tr["length_sec"] for tr in track_list)

    return {
        "artist": artist,
        "name": album,
        "path": album_data.get("path", ""),
        "track_count": len(tracks_data),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": bool(has_cover),
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
    q_stripped = q.strip()
    if len(q_stripped) < 2:
        return {"artists": [], "albums": []}

    if not _has_library_data():
        return _fs_search(q_stripped)

    like = f"%{q_stripped}%"
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT name FROM library_artists WHERE name ILIKE %s LIMIT 20",
            (like,),
        )
        artist_rows = cur.fetchall()
        cur.execute(
            "SELECT artist, name FROM library_albums WHERE name ILIKE %s OR artist ILIKE %s LIMIT 50",
            (like, like),
        )
        album_rows = cur.fetchall()

    artists = [{"name": r["name"]} for r in artist_rows]
    albums = [{"artist": r["artist"], "name": r["name"]} for r in album_rows]

    return {"artists": artists, "albums": albums}
