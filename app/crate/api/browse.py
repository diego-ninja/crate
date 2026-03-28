from io import BytesIO
from pathlib import Path

import mutagen
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from crate.api.auth import _require_auth
from crate.audio import read_tags, get_audio_files
from crate.api._deps import library_path, extensions, safe_path, COVER_NAMES, exclude_dirs
from crate.db import (
    get_library_artists, get_library_artist, get_library_albums,
    get_library_album, get_library_tracks, get_library_track_count,
    get_db_ctx, get_cache, set_cache,
    get_artist_issue_count, get_all_artist_issue_counts,
)
from crate.lastfm import get_artist_info, get_best_artist_image

import logging
import re as _re

log = logging.getLogger(__name__)

router = APIRouter()

ARTIST_PHOTO_NAMES = ["artist.jpg", "artist.png", "photo.jpg"]

_YEAR_PREFIX_RE = _re.compile(r"^\d{4}\s*[-–]\s*")


def _display_name(folder_name: str) -> str:
    """Strip year prefix from album folder name for display (e.g. '2024 - Album' -> 'Album')."""
    return _YEAR_PREFIX_RE.sub("", folder_name)


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
    album_dir = _find_album_dir(lib, artist, album)
    if not album_dir:
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
            "path": str(t.relative_to(lib)),
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


@router.get("/api/browse/filters")
def api_browse_filters(request: Request):
    """Available filter options for the browse page."""
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS cnt
            FROM genres g JOIN artist_genres ag ON g.id = ag.genre_id
            GROUP BY g.name HAVING COUNT(DISTINCT ag.artist_name) >= 1
            ORDER BY cnt DESC LIMIT 50
        """)
        genres = [{"name": r["name"], "count": r["cnt"]} for r in cur.fetchall()]

        cur.execute("""
            SELECT country, COUNT(*) AS cnt FROM library_artists
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
        """)
        countries = [{"name": r["country"], "count": r["cnt"]} for r in cur.fetchall()]

        cur.execute("""
            SELECT DISTINCT formed FROM library_artists
            WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
        """)
        decades_set = set()
        for r in cur.fetchall():
            try:
                decade = f"{int(r['formed'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        decades = sorted(decades_set)

        cur.execute("""
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
        """)
        formats = [{"name": r["format"], "count": r["cnt"]} for r in cur.fetchall()]

    return {"genres": genres, "countries": countries, "decades": decades, "formats": formats}


@router.get("/api/artists")
def api_artists(
    request: Request,
    q: str = "",
    page: int = 1,
    per_page: int = 60,
    sort: str = "name",
    genre: str = "",
    country: str = "",
    decade: str = "",
    format: str = "",
    view: str = "grid",
):
    _require_auth(request)
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

    # Build filtered query with optional JOINs
    select_cols = "la.*"
    joins = ""
    where_clauses = ["1=1"]
    params: list = []

    if genre:
        joins += " JOIN artist_genres ag ON la.name = ag.artist_name JOIN genres g ON ag.genre_id = g.id"
        where_clauses.append("g.name = %s")
        params.append(genre)

    if country:
        where_clauses.append("la.country = %s")
        params.append(country)

    if decade:
        # decade is like "2010s" -> formed between 2010 and 2019
        try:
            decade_start = int(decade.rstrip("s"))
            where_clauses.append("la.formed IS NOT NULL AND length(la.formed) >= 4")
            where_clauses.append("CAST(substring(la.formed, 1, 4) AS INTEGER) BETWEEN %s AND %s")
            params.extend([decade_start, decade_start + 9])
        except (ValueError, TypeError):
            pass

    if format:
        where_clauses.append("la.primary_format = %s")
        params.append(format)

    if q:
        where_clauses.append("la.name ILIKE %s")
        params.append(f"%{q}%")

    where_sql = " AND ".join(where_clauses)

    sort_map = {
        "name": "la.name ASC",
        "popularity": "la.listeners DESC NULLS LAST",
        "albums": "la.album_count DESC",
        "recent": "la.dir_mtime DESC NULLS LAST",
        "size": "la.total_size DESC",
        "tracks": "la.track_count DESC",
    }
    order_sql = sort_map.get(sort, "la.name ASC")

    with get_db_ctx() as cur:
        count_sql = f"SELECT COUNT(DISTINCT la.name) AS cnt FROM library_artists la {joins} WHERE {where_sql}"
        cur.execute(count_sql, params)
        total = cur.fetchone()["cnt"]

        query_sql = (
            f"SELECT DISTINCT {select_cols} FROM library_artists la {joins} "
            f"WHERE {where_sql} ORDER BY {order_sql} LIMIT %s OFFSET %s"
        )
        cur.execute(query_sql, params + [per_page, (page - 1) * per_page])
        rows = cur.fetchall()

    issue_counts = get_all_artist_issue_counts()

    items = []
    for r in rows:
        item = {
            "name": r["name"],
            "albums": r["album_count"],
            "tracks": r["track_count"],
            "total_size_mb": round(r["total_size"] / (1024 ** 2)) if r["total_size"] else 0,
            "formats": r.get("formats_json") if isinstance(r.get("formats_json"), list) else [],
            "primary_format": r.get("primary_format"),
            "has_photo": bool(r.get("has_photo")),
            "has_issues": bool(issue_counts.get(r["name"], 0)),
        }
        if view == "list":
            item["listeners"] = r.get("listeners") or 0
            item["track_count"] = r["track_count"]
            item["total_size_mb"] = round(r["total_size"] / (1024 ** 2)) if r["total_size"] else 0
            with get_db_ctx() as cur2:
                cur2.execute(
                    "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                    "WHERE ag.artist_name = %s ORDER BY ag.weight DESC LIMIT 5",
                    (r["name"],),
                )
                item["genres"] = [gr["name"] for gr in cur2.fetchall()]
        items.append(item)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/api/artist/{name}/background")
def api_artist_background(request: Request, name: str, random_pick: bool = Query(False, alias="random")):
    """Return artist background image. Tries: manual upload > fanart.tv > Deezer > Spotify > artist photo."""
    _require_auth(request)
    import random as _random
    from crate.lastfm import get_fanart_all_images, get_fanart_background, download_artist_image, _deezer_artist_image

    # 0. Manual upload on disk (highest priority)
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if artist_dir and artist_dir.is_dir():
        bg_file = artist_dir / "background.jpg"
        if bg_file.exists():
            return Response(content=bg_file.read_bytes(), media_type="image/jpeg")

    # 1. Fanart.tv backgrounds (best: 1920x1080 panoramic)
    fanart = get_fanart_all_images(name)
    backgrounds = fanart.get("backgrounds", []) if fanart else []
    if backgrounds:
        url = _random.choice(backgrounds) if random_pick else backgrounds[0]
        image_data = download_artist_image(url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg")

    url = get_fanart_background(name)
    if url:
        image_data = download_artist_image(url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg")

    # 2. Last.fm user images (scraped, scored by aspect ratio)
    from crate.lastfm import get_lastfm_best_background
    lfm_bg = get_lastfm_best_background(name)
    if lfm_bg:
        return Response(content=lfm_bg, media_type="image/jpeg")

    # 3. Deezer artist image (square but works as bg with object-cover)
    deezer_url = _deezer_artist_image(name)
    if deezer_url:
        image_data = download_artist_image(deezer_url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg")

    # 4. Spotify artist image
    try:
        from crate.spotify import search_artist as spotify_search
        sp = spotify_search(name)
        if sp and sp.get("images"):
            img_url = sp["images"][0].get("url") if sp["images"] else None
            if img_url:
                image_data = download_artist_image(img_url)
                if image_data:
                    return Response(content=image_data, media_type="image/jpeg")
    except Exception:
        pass

    # 5. Artist photo on disk (last resort)
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if artist_dir and artist_dir.is_dir():
        for photo_name in ARTIST_PHOTO_NAMES:
            photo = artist_dir / photo_name
            if photo.exists():
                media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
                return Response(content=photo.read_bytes(), media_type=media_type)

    return Response(status_code=404)


@router.get("/api/artist/{name}/photo")
def api_artist_photo(request: Request, name: str, random_pick: bool = Query(False, alias="random")):
    _require_auth(request)
    import random as _random
    from crate.lastfm import get_fanart_all_images, download_artist_image

    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return Response(status_code=404)

    # 0. Photo on disk (highest priority — includes manual uploads)
    for photo_name in ARTIST_PHOTO_NAMES:
        photo = artist_dir / photo_name
        if photo.exists():
            media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
            return Response(content=photo.read_bytes(), media_type=media_type)

    # 1. Fanart.tv thumbs (random pick)
    if random_pick:
        fanart = get_fanart_all_images(name)
        thumbs = fanart.get("thumbs", []) if fanart else []
        if thumbs:
            url = _random.choice(thumbs)
            image_data = download_artist_image(url)
            if image_data:
                return Response(content=image_data, media_type="image/jpeg")

    # 2. Try fetching from fanart.tv / Deezer / Spotify / Last.fm
    from crate.lastfm import get_best_artist_image
    image_data = get_best_artist_image(name)
    if image_data:
        save_path = artist_dir / "artist.jpg"
        try:
            save_path.write_bytes(image_data)
        except OSError:
            pass  # read-only filesystem
        return Response(content=image_data, media_type="image/jpeg")

    # 3. Last resort: first album's cover
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

    return Response(status_code=404)


@router.get("/api/artist/{name}/info")
def api_artist_info(request: Request, name: str):
    _require_auth(request)
    info = get_artist_info(name)
    if not info:
        return JSONResponse({"error": "Not found on Last.fm"}, status_code=404)
    return info


@router.get("/api/artist/{name}/shows")
def api_artist_shows(request: Request, name: str, limit: int = Query(10), country: str = Query("")):
    """Get upcoming shows for an artist from Ticketmaster."""
    _require_auth(request)
    from crate.ticketmaster import get_upcoming_shows, is_configured
    if not is_configured():
        return {"events": [], "configured": False}
    events = get_upcoming_shows(name, country_code=country, limit=limit)
    return {"events": events, "configured": True}


@router.get("/api/shows/artists-with-shows")
def api_artists_with_shows(request: Request):
    """Return names of artists that have upcoming shows in DB."""
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows
    shows = db_get_shows()
    artist_names = sorted({s["artist_name"] for s in shows})
    return {"artists": artist_names}


@router.get("/api/shows/cached")
def api_cached_shows(request: Request, limit: int = Query(50)):
    """Get upcoming shows from DB. For dashboard widgets and Shows map page."""
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows
    shows = db_get_shows(limit=limit)
    # Enrich with genres
    genre_map = {}
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id ORDER BY ag.weight DESC
        """)
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])

    events = []
    for s in shows:
        events.append({
            **s,
            "artist_genres": genre_map.get(s["artist_name"], [])[:3],
            "artist_listeners": 0,
        })
    return {"events": events}


@router.get("/api/shows")
def api_shows_list(request: Request, city: str = "", country: str = ""):
    """Get upcoming shows from DB with filters."""
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows, get_show_cities, get_show_countries
    shows = db_get_shows(city=city or None, country=country or None)
    return {
        "shows": shows,
        "filters": {
            "cities": get_show_cities(),
            "countries": get_show_countries(),
        },
    }


@router.post("/api/artist/{name}/enrich")
def api_artist_enrich(request: Request, name: str):
    """Queue a full enrichment task for an artist (async via worker)."""
    _require_auth(request)
    from crate.db import create_task_dedup
    task_id = create_task_dedup("process_new_content", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.get("/api/artist/{name}/track-titles")
def api_artist_track_titles(request: Request, name: str):
    """Return all track titles for an artist (lightweight, for setlist matching)."""
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT t.title, t.path, a.name AS album "
            "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
            "WHERE a.artist = %s ORDER BY t.title",
            (name,),
        )
        rows = cur.fetchall()
    return [{"title": r["title"], "album": r["album"], "path": r["path"]} for r in rows]


@router.get("/api/upcoming")
def api_upcoming(request: Request):
    """Unified upcoming events: shows + releases, sorted by date."""
    from datetime import datetime, timezone
    from crate.db import get_new_releases, get_upcoming_shows as db_get_shows
    _require_auth(request)
    items = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. Releases from DB
    releases = get_new_releases(limit=50)
    for r in releases:
        if r.get("status") == "dismissed":
            continue
        if r.get("artist_name", "").lower() in ("various artists", "v/a"):
            continue
        items.append({
            "type": "release",
            "date": r.get("release_date") or (r.get("detected_at") or "")[:10],
            "artist": r.get("artist_name", ""),
            "title": r.get("album_title", ""),
            "subtitle": r.get("release_type") or "Album",
            "cover_url": r.get("cover_url"),
            "status": r.get("status", "detected"),
            "tidal_url": r.get("tidal_url"),
            "release_id": r.get("id"),
            "is_upcoming": bool(r.get("release_date") and r["release_date"] >= today),
        })

    # 2. Shows from DB (not cache)
    shows = db_get_shows(limit=1000)
    # Get artist genres for enrichment
    genre_map = {}
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            ORDER BY ag.weight DESC
        """)
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])

    for s in shows:
        artist = s["artist_name"]
        items.append({
            "type": "show",
            "date": s["date"],
            "time": s.get("local_time"),
            "artist": artist,
            "title": s.get("venue") or "",
            "subtitle": f"{s.get('city', '')}, {s.get('country', '')}".strip(", "),
            "cover_url": s.get("image_url"),
            "status": s.get("status", "onsale"),
            "url": s.get("url"),
            "venue": s.get("venue"),
            "city": s.get("city"),
            "country": s.get("country"),
            "country_code": s.get("country_code"),
            "latitude": s.get("latitude"),
            "longitude": s.get("longitude"),
            "lineup": s.get("lineup"),
            "genres": genre_map.get(artist, [])[:3],
            "is_upcoming": True,
        })

    items.sort(key=lambda x: x.get("date") or "9999")
    return {"items": items}


@router.get("/api/artist/{name}/network")
def api_artist_network(request: Request, name: str, depth: int = 2):
    """Return pre-computed artist similarity network (nodes + links) for ForceGraph2D."""
    _require_auth(request)
    from crate.db import get_artist_network
    return get_artist_network(name, depth=min(depth, 3), limit_per_level=15)


@router.get("/api/artist/{name:path}")
def api_artist(request: Request, name: str):
    _require_auth(request)
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

    # Use canonical name from DB for all subsequent queries
    canonical = artist["name"]
    albums_data = get_library_albums(canonical)

    # Get genres from normalized artist_genres table
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.artist_name = %s ORDER BY ag.weight DESC",
            (canonical,),
        )
        top_genres = [r["name"] for r in cur.fetchall()]

    albums = []
    for a in albums_data:
        albums.append({
            "name": a["name"],
            "display_name": _display_name(a["name"]),
            "tracks": a["track_count"],
            "formats": a.get("formats", []),
            "size_mb": round(a["total_size"] / (1024 ** 2)) if a["total_size"] else 0,
            "year": a.get("year", ""),
            "has_cover": bool(a.get("has_cover")),
        })

    return {
        "name": canonical,
        "albums": albums,
        "total_tracks": artist["track_count"],
        "total_size_mb": round(artist["total_size"] / (1024 ** 2)) if artist["total_size"] else 0,
        "primary_format": artist.get("primary_format"),
        "genres": top_genres,
        "issue_count": get_artist_issue_count(canonical),
    }


@router.get("/api/album/{artist:path}/{album:path}/related")
def api_related_albums(request: Request, artist: str, album: str, limit: int = 15):
    """Find related albums: same artist, same genre+decade, similar audio profile."""
    _require_auth(request)
    related = []
    seen = set()

    current = _find_album_row(artist, album)
    if not current:
        return []

    album_id = current["id"]

    with get_db_ctx() as cur:
        year = current["year"][:4] if current.get("year") and len(current.get("year", "")) >= 4 else None
        seen.add(album_id)

        # Get current album genres
        cur.execute(
            "SELECT genre_id FROM album_genres WHERE album_id = %s", (album_id,)
        )
        genre_ids = [r["genre_id"] for r in cur.fetchall()]

        # 1. Same artist, other albums
        cur.execute(
            "SELECT id, name, artist, year, track_count, has_cover FROM library_albums "
            "WHERE artist = %s AND id != %s ORDER BY year",
            (artist, album_id),
        )
        for r in cur.fetchall():
            if r["id"] not in seen:
                seen.add(r["id"])
                related.append({**dict(r), "reason": "same_artist"})

        # 2. Same genre + similar decade
        if genre_ids and year:
            year_int = int(year)
            placeholders = ",".join(["%s"] * len(genre_ids))
            cur.execute(f"""
                SELECT DISTINCT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover
                FROM library_albums a
                JOIN album_genres ag ON a.id = ag.album_id
                WHERE ag.genre_id IN ({placeholders})
                AND a.artist != %s
                AND a.year IS NOT NULL AND length(a.year) >= 4
                AND CAST(substring(a.year, 1, 4) AS INTEGER) BETWEEN %s AND %s
                ORDER BY RANDOM() LIMIT 10
            """, (*genre_ids, artist, year_int - 5, year_int + 5))
            for r in cur.fetchall():
                if r["id"] not in seen:
                    seen.add(r["id"])
                    related.append({**dict(r), "reason": "genre_decade"})

        # 3. Similar audio profile
        cur.execute("""
            SELECT AVG(energy) AS e, AVG(danceability) AS d, AVG(valence) AS v
            FROM library_tracks WHERE album_id = %s AND energy IS NOT NULL
        """, (album_id,))
        audio = cur.fetchone()
        if audio and audio["e"] is not None:
            cur.execute("""
                SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                    ABS(AVG(t.energy) - %s) + ABS(AVG(t.danceability) - %s) + ABS(AVG(t.valence) - %s) AS dist
                FROM library_albums a
                JOIN library_tracks t ON t.album_id = a.id
                WHERE t.energy IS NOT NULL AND a.id != %s AND a.artist != %s
                GROUP BY a.id, a.name, a.artist, a.year, a.track_count, a.has_cover
                ORDER BY dist ASC LIMIT 8
            """, (audio["e"], audio["d"], audio["v"], album_id, artist))
            for r in cur.fetchall():
                if r["id"] not in seen:
                    seen.add(r["id"])
                    related.append({**dict(r), "reason": "audio_similar"})

    # Add display_name
    import re
    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    for r in related:
        r["display_name"] = year_re.sub("", r["name"])

    return related[:limit]


@router.get("/api/album/{artist:path}/{album:path}")
def api_album(request: Request, artist: str, album: str):
    _require_auth(request)
    if not _has_library_data():
        result = _fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    album_data = _find_album_row(artist, album)
    if not album_data:
        # Fallback to filesystem for albums not yet synced
        result = _fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    tracks_data = get_library_tracks(album_data["id"])

    lib = library_path()
    album_dir = _find_album_dir(lib, artist, album)
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
            "id": t["id"],
            "filename": t["filename"],
            "format": t.get("format", ""),
            "size_mb": round(t["size"] / (1024**2), 1) if t.get("size") else 0,
            "bitrate": t.get("bitrate") // 1000 if t.get("bitrate") else None,
            "length_sec": round(t["duration"]) if t.get("duration") else 0,
            "rating": t.get("rating", 0) or 0,
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
            "path": str(Path(t["path"]).relative_to(lib)) if t.get("path") else "",
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

    # Get normalized genres from album_genres table
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM album_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.album_id = %s ORDER BY ag.weight DESC",
            (album_data["id"],),
        )
        album_genres = [r["name"] for r in cur.fetchall()]

    # Override genre in album_tags with normalized genres
    if album_genres:
        album_tags["genre"] = ", ".join(album_genres)

    return {
        "artist": artist,
        "name": album,
        "display_name": _display_name(album),
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


def _find_album_row(artist: str, album: str) -> dict | None:
    """Find album in DB, handling year-prefixed names, clean names, and case differences."""
    with get_db_ctx() as cur:
        # Exact match (case-insensitive)
        cur.execute("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND LOWER(name) = LOWER(%s) LIMIT 1", (artist, album))
        row = cur.fetchone()
        if row:
            return dict(row)
        # Match by name ending (e.g. album="Slip" matches "1993 - Slip")
        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND name ILIKE %s LIMIT 1",
            (artist, f"% - {album}"),
        )
        row = cur.fetchone()
        if row:
            return dict(row)
        # Match by stripped year prefix
        cur.execute("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s)", (artist,))
        for r in cur.fetchall():
            if _display_name(r["name"]) == album:
                return dict(r)
    return None


def _find_album_dir(lib: Path, artist: str, album: str) -> Path | None:
    """Find album directory, supporting both 2-level and 3-level (Artist/Year/Album) structures."""
    # Direct path: Artist/Album
    direct = safe_path(lib, f"{artist}/{album}")
    if direct and direct.is_dir():
        return direct
    # 3-level: Artist/Year/Album — search year subdirs
    artist_dir = safe_path(lib, artist)
    if artist_dir and artist_dir.is_dir():
        for sub in artist_dir.iterdir():
            if sub.is_dir() and sub.name.isdigit() and len(sub.name) == 4:
                candidate = sub / album
                if candidate.is_dir():
                    return candidate
    # DB lookup as last resort
    album_data = get_library_album(artist, album)
    if album_data and album_data.get("path"):
        p = Path(album_data["path"])
        if p.is_dir():
            return p
    return None


@router.get("/api/cover/{artist:path}/{album:path}")
def api_cover(artist: str, album: str):
    lib = library_path()
    album_dir = _find_album_dir(lib, artist, album)
    if not album_dir:
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
def api_search(request: Request, q: str = ""):
    _require_auth(request)
    q_stripped = q.strip()
    if len(q_stripped) < 2:
        return {"artists": [], "albums": []}

    if not _has_library_data():
        result = _fs_search(q_stripped)
        result["tracks"] = []
        return result

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
        cur.execute(
            "SELECT t.title, t.artist, a.name AS album FROM library_tracks t "
            "JOIN library_albums a ON t.album_id = a.id "
            "WHERE t.title ILIKE %s LIMIT 20",
            (like,),
        )
        track_rows = cur.fetchall()

    artists = [{"name": r["name"]} for r in artist_rows]
    albums = [{"artist": r["artist"], "name": r["name"]} for r in album_rows]
    tracks = [{"title": r["title"], "artist": r["artist"], "album": r["album"]} for r in track_rows]

    return {"artists": artists, "albums": albums, "tracks": tracks}


@router.get("/api/favorites")
def api_favorites_list(request: Request):
    """Get all local favorites."""
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT item_type, item_id, navidrome_id, created_at FROM favorites ORDER BY created_at DESC")
        items = [dict(r) for r in cur.fetchall()]
    return {"items": items}


@router.post("/api/favorites/add")
def api_favorites_add(request: Request, body: dict):
    """Add to favorites (local + Navidrome if available)."""
    _require_auth(request)
    from datetime import datetime, timezone
    item_id = body.get("item_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return Response(status_code=400)
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO favorites (item_type, item_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (item_type, item_id, now),
        )
    # Also star in Navidrome if it looks like a Navidrome ID (UUID format, no slashes)
    if "/" not in item_id and len(item_id) < 40:
        try:
            from crate import navidrome
            navidrome.star(item_id, item_type)
        except Exception:
            pass
    return {"ok": True}


@router.post("/api/favorites/remove")
def api_favorites_remove(request: Request, body: dict):
    """Remove from favorites (local + Navidrome)."""
    _require_auth(request)
    item_id = body.get("item_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return Response(status_code=400)
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM favorites WHERE item_id = %s AND item_type = %s", (item_id, item_type))
    if "/" not in item_id and len(item_id) < 40:
        try:
            from crate import navidrome
            navidrome.unstar(item_id, item_type)
        except Exception:
            pass
    return {"ok": True}


@router.post("/api/track/rate")
def api_rate_track(request: Request, body: dict):
    _require_auth(request)
    from crate.db import set_track_rating
    rating = body.get("rating", 0)
    track_id = body.get("track_id")
    track_path = body.get("path")

    if not isinstance(rating, int) or not 0 <= rating <= 5:
        return JSONResponse({"error": "Rating must be 0-5"}, status_code=400)

    if not track_id and track_path:
        with get_db_ctx() as cur:
            cur.execute("SELECT id FROM library_tracks WHERE path LIKE %s LIMIT 1", (f"%{track_path}",))
            row = cur.fetchone()
            track_id = row["id"] if row else None

    if not track_id:
        return JSONResponse({"error": "Track not found"}, status_code=404)

    set_track_rating(track_id, rating)

    # Sync to Navidrome if available
    try:
        from crate.navidrome import set_navidrome_rating
        set_navidrome_rating(track_id, rating)
    except Exception:
        pass  # Navidrome sync is best-effort

    return {"ok": True, "rating": rating}


@router.get("/api/track-info/{filepath:path}")
def api_track_info(request: Request, filepath: str):
    """Get audio metadata for a single track (BPM, key, energy etc.)."""
    _require_auth(request)
    # Strip /music/ prefix if present
    if filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):]
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT title, artist, album, bpm, audio_key, audio_scale, energy, "
            "danceability, valence, acousticness, instrumentalness, loudness, "
            "dynamic_range, lastfm_listeners, lastfm_playcount, popularity, rating "
            "FROM library_tracks WHERE path LIKE %s LIMIT 1",
            (f"%{filepath}",),
        )
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return dict(row)


@router.get("/api/discover/completeness")
def api_discover_completeness(request: Request):
    """Per-artist discography completeness vs MusicBrainz."""
    _require_auth(request)
    cache_key = "discover:completeness"
    cached = get_cache(cache_key, max_age_seconds=3600)
    if cached:
        return cached

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT name, mbid, album_count, has_photo, listeners
            FROM library_artists
            WHERE mbid IS NOT NULL AND mbid != ''
            ORDER BY name
        """)
        artists = [dict(r) for r in cur.fetchall()]

    # For each artist with MBID, get MB album count from cache
    import musicbrainzngs
    musicbrainzngs.set_useragent("grooveyard", "0.1", "https://github.com/grooveyard")

    results = []
    for a in artists:
        try:
            mb_data = get_cache(f"mb:albums:{a['mbid']}", max_age_seconds=86400 * 7)
            if not mb_data:
                # Validate MBID points to the right artist
                try:
                    mb_artist = musicbrainzngs.get_artist_by_id(a["mbid"])["artist"]
                    mb_name = mb_artist.get("name", "")
                    from thefuzz import fuzz
                    if fuzz.ratio(a["name"].lower(), mb_name.lower()) < 70:
                        log.warning("MBID mismatch: %s -> %s (expected %s), skipping", a["mbid"], mb_name, a["name"])
                        continue
                except Exception:
                    pass

                result = musicbrainzngs.browse_release_groups(artist=a["mbid"], release_type=["album"], limit=100)
                mb_albums = result.get("release-group-list", [])
                mb_data = {
                    "count": result.get("release-group-count", len(mb_albums)),
                    "albums": [{"title": rg.get("title", ""), "type": rg.get("primary-type", ""),
                               "year": rg.get("first-release-date", "")[:4] if rg.get("first-release-date") else ""}
                              for rg in mb_albums]
                }
                set_cache(f"mb:albums:{a['mbid']}", mb_data, ttl=604800)

            mb_count = mb_data["count"]
            local_count = a["album_count"] or 0
            pct = round(local_count / mb_count * 100) if mb_count > 0 else 100

            # Find missing (titles in MB not in local)
            with get_db_ctx() as cur:
                cur.execute("SELECT name FROM library_albums WHERE artist = %s", (a["name"],))
                local_names = {r["name"].lower() for r in cur.fetchall()}
                # Also strip year prefix for comparison
                year_re = _YEAR_PREFIX_RE
                local_clean = {year_re.sub("", n).lower() for n in local_names}

            missing = [alb for alb in mb_data["albums"]
                       if alb["title"].lower() not in local_names and alb["title"].lower() not in local_clean]

            results.append({
                "artist": a["name"],
                "has_photo": bool(a["has_photo"]),
                "listeners": a.get("listeners", 0),
                "local_count": local_count,
                "mb_count": mb_count,
                "pct": min(pct, 100),
                "missing": missing[:10],
            })
        except Exception:
            pass

    results.sort(key=lambda x: x["pct"])
    set_cache(cache_key, results, ttl=3600)
    return results


@router.get("/api/stream/{filepath:path}")
def api_stream_file(request: Request, filepath: str):
    """Stream an audio file directly from the library (fallback when Navidrome is unavailable)."""
    _require_auth(request)
    from fastapi.responses import FileResponse
    lib = library_path()
    # Strip library prefix if path is absolute (DB stores /music/Artist/Album/file)
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    file_path = safe_path(lib, filepath)
    if not file_path or not file_path.is_file():
        return Response(status_code=404)

    ext = file_path.suffix.lower()
    media_types = {
        ".flac": "audio/flac",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus",
        ".wav": "audio/wav",
    }
    return FileResponse(
        path=str(file_path),
        media_type=media_types.get(ext, "audio/mpeg"),
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/api/artist-radio/{name:path}")
def api_artist_radio(request: Request, name: str, limit: int = 50):
    """Generate an Artist Radio playlist using bliss song similarity."""
    _require_auth(request)
    from crate.bliss import generate_artist_radio
    tracks = generate_artist_radio(name, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No bliss data available. Run 'Compute Bliss' first."}, status_code=404)
    return tracks


@router.get("/api/similar-tracks")
def api_similar_tracks_query(request: Request, path: str = "", track_id: int = 0, limit: int = 20):
    """Find similar tracks using multi-signal scoring (query param version, avoids route conflicts)."""
    _require_auth(request)
    from crate.bliss import get_similar_from_db

    if track_id:
        with get_db_ctx() as cur:
            cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
            row = cur.fetchone()
            if row:
                path = row["path"]

    if not path:
        raise HTTPException(status_code=400, detail="path or track_id required")

    results = get_similar_from_db(path, limit=limit)
    return {"tracks": results}


@router.get("/api/similar-tracks/{filepath:path}")
def api_similar_tracks(request: Request, filepath: str, limit: int = 20):
    """Find tracks similar to the given track using bliss vectors."""
    _require_auth(request)
    from crate.bliss import get_similar_from_db
    lib = library_path()
    full_path = safe_path(lib, filepath)
    if not full_path or not full_path.is_file():
        return JSONResponse({"error": "Track not found"}, status_code=404)
    similar = get_similar_from_db(str(full_path), limit=limit)
    return {"tracks": similar}


@router.get("/api/download/track/{filepath:path}")
def api_download_track(request: Request, filepath: str):
    """Download a single audio file."""
    _require_auth(request)
    from fastapi.responses import FileResponse
    lib = library_path()
    file_path = safe_path(lib, filepath)
    if not file_path or not file_path.is_file():
        return Response(status_code=404)

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/octet-stream",
    )


@router.get("/api/download/album/{artist:path}/{album:path}")
def api_download_album(request: Request, artist: str, album: str):
    """Download an entire album as a ZIP file."""
    _require_auth(request)
    import zipfile
    import tempfile
    from fastapi.responses import FileResponse

    lib = library_path()
    album_dir = _find_album_dir(lib, artist, album)
    if not album_dir:
        return Response(status_code=404)

    # Create zip in temp
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()

    exts = extensions()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as zf:
        for f in sorted(album_dir.iterdir()):
            if f.is_file() and (f.suffix.lower() in exts or f.name.lower() in ("cover.jpg", "cover.png", "folder.jpg", "front.jpg")):
                zf.write(str(f), f.name)

    safe_name = f"{artist} - {album}.zip".replace("/", "-")
    return FileResponse(
        path=tmp.name,
        filename=safe_name,
        media_type="application/zip",
        background=None,  # Don't delete before sending
    )
