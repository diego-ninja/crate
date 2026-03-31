import logging

import mutagen
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import COVER_NAMES, extensions, library_path, safe_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import ARTIST_PHOTO_NAMES, display_name, fs_artist_detail, fs_build_artists_list, has_library_data
from crate.audio import get_audio_files
from crate.db import (
    get_all_artist_issue_counts,
    get_artist_issue_count,
    get_db_ctx,
    get_library_albums,
    get_library_artist,
)
from crate.lastfm import get_artist_info

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/browse/filters")
def api_browse_filters(request: Request):
    """Available filter options for the browse page."""
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS cnt
            FROM genres g JOIN artist_genres ag ON g.id = ag.genre_id
            GROUP BY g.name HAVING COUNT(DISTINCT ag.artist_name) >= 1
            ORDER BY cnt DESC LIMIT 50
            """
        )
        genres = [{"name": row["name"], "count": row["cnt"]} for row in cur.fetchall()]

        cur.execute(
            """
            SELECT country, COUNT(*) AS cnt FROM library_artists
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
            """
        )
        countries = [{"name": row["country"], "count": row["cnt"]} for row in cur.fetchall()]

        cur.execute(
            """
            SELECT DISTINCT formed FROM library_artists
            WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
            """
        )
        decades_set = set()
        for row in cur.fetchall():
            try:
                decade = f"{int(row['formed'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        decades = sorted(decades_set)

        cur.execute(
            """
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
            """
        )
        formats = [{"name": row["format"], "count": row["cnt"]} for row in cur.fetchall()]

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
    if not has_library_data():
        artists = fs_build_artists_list()
        q_lower = q.lower()
        if q_lower:
            artists = [artist for artist in artists if q_lower in artist["name"].lower()]
        if sort == "albums":
            artists.sort(key=lambda artist: artist["albums"], reverse=True)
        elif sort == "size":
            artists.sort(key=lambda artist: artist["total_size_mb"], reverse=True)
        else:
            artists.sort(key=lambda artist: artist["name"].lower())
        total = len(artists)
        start = (page - 1) * per_page
        return {"items": artists[start : start + per_page], "total": total, "page": page, "per_page": per_page}

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
    for row in rows:
        item = {
            "name": row["name"],
            "albums": row["album_count"],
            "tracks": row["track_count"],
            "total_size_mb": round(row["total_size"] / (1024**2)) if row["total_size"] else 0,
            "formats": row.get("formats_json") if isinstance(row.get("formats_json"), list) else [],
            "primary_format": row.get("primary_format"),
            "has_photo": bool(row.get("has_photo")),
            "has_issues": bool(issue_counts.get(row["name"], 0)),
        }
        if view == "list":
            item["listeners"] = row.get("listeners") or 0
            item["track_count"] = row["track_count"]
            item["total_size_mb"] = round(row["total_size"] / (1024**2)) if row["total_size"] else 0
            with get_db_ctx() as cur2:
                cur2.execute(
                    "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                    "WHERE ag.artist_name = %s ORDER BY ag.weight DESC LIMIT 5",
                    (row["name"],),
                )
                item["genres"] = [genre_row["name"] for genre_row in cur2.fetchall()]
        items.append(item)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/api/artist/{name}/background")
def api_artist_background(request: Request, name: str, random_pick: bool = Query(False, alias="random")):
    """Return artist background image."""
    _require_auth(request)
    import random as _random

    from crate.lastfm import _deezer_artist_image, download_artist_image, get_fanart_all_images, get_fanart_background

    lib = library_path()
    artist_dir = safe_path(lib, name)
    if artist_dir and artist_dir.is_dir():
        bg_file = artist_dir / "background.jpg"
        if bg_file.exists():
            return Response(content=bg_file.read_bytes(), media_type="image/jpeg")

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

    from crate.lastfm import get_lastfm_best_background

    lfm_bg = get_lastfm_best_background(name)
    if lfm_bg:
        return Response(content=lfm_bg, media_type="image/jpeg")

    deezer_url = _deezer_artist_image(name)
    if deezer_url:
        image_data = download_artist_image(deezer_url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg")

    try:
        from crate.spotify import search_artist as spotify_search

        spotify_artist = spotify_search(name)
        if spotify_artist and spotify_artist.get("images"):
            img_url = spotify_artist["images"][0].get("url") if spotify_artist["images"] else None
            if img_url:
                image_data = download_artist_image(img_url)
                if image_data:
                    return Response(content=image_data, media_type="image/jpeg")
    except Exception:
        pass

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

    from crate.lastfm import download_artist_image, get_fanart_all_images, get_best_artist_image

    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return Response(status_code=404)

    for photo_name in ARTIST_PHOTO_NAMES:
        photo = artist_dir / photo_name
        if photo.exists():
            media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
            return Response(content=photo.read_bytes(), media_type=media_type)

    if random_pick:
        fanart = get_fanart_all_images(name)
        thumbs = fanart.get("thumbs", []) if fanart else []
        if thumbs:
            url = _random.choice(thumbs)
            image_data = download_artist_image(url)
            if image_data:
                return Response(content=image_data, media_type="image/jpeg")

    image_data = get_best_artist_image(name)
    if image_data:
        save_path = artist_dir / "artist.jpg"
        try:
            save_path.write_bytes(image_data)
        except OSError:
            pass
        return Response(content=image_data, media_type="image/jpeg")

    exts = extensions()
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        for cover_name in COVER_NAMES:
            cover = album_dir / cover_name
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
    _require_auth(request)
    from crate.ticketmaster import get_upcoming_shows, is_configured

    if not is_configured():
        return {"events": [], "configured": False}
    events = get_upcoming_shows(name, country_code=country, limit=limit)
    return {"events": events, "configured": True}


@router.get("/api/shows/artists-with-shows")
def api_artists_with_shows(request: Request):
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows

    shows = db_get_shows()
    artist_names = sorted({show["artist_name"] for show in shows})
    return {"artists": artist_names}


@router.get("/api/shows/cached")
def api_cached_shows(request: Request, limit: int = Query(50)):
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows

    shows = db_get_shows(limit=limit)
    genre_map = {}
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id ORDER BY ag.weight DESC
            """
        )
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])

    events = []
    for show in shows:
        events.append({**show, "artist_genres": genre_map.get(show["artist_name"], [])[:3], "artist_listeners": 0})
    return {"events": events}


@router.get("/api/shows")
def api_shows_list(request: Request, city: str = "", country: str = ""):
    _require_auth(request)
    from crate.db import get_show_cities, get_show_countries, get_upcoming_shows as db_get_shows

    shows = db_get_shows(city=city or None, country=country or None)
    return {"shows": shows, "filters": {"cities": get_show_cities(), "countries": get_show_countries()}}


@router.post("/api/artist/{name}/enrich")
def api_artist_enrich(request: Request, name: str):
    _require_auth(request)
    from crate.db import create_task_dedup

    task_id = create_task_dedup("process_new_content", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.get("/api/artist/{name}/track-titles")
def api_artist_track_titles(request: Request, name: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT t.title, t.path, a.name AS album "
            "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
            "WHERE a.artist = %s ORDER BY t.title",
            (name,),
        )
        rows = cur.fetchall()
    return [{"title": row["title"], "album": row["album"], "path": row["path"]} for row in rows]


@router.get("/api/upcoming")
def api_upcoming(request: Request):
    from datetime import datetime, timezone

    from crate.db import get_new_releases, get_upcoming_shows as db_get_shows

    _require_auth(request)
    items = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    releases = get_new_releases(limit=50)
    for release in releases:
        if release.get("status") == "dismissed":
            continue
        if release.get("artist_name", "").lower() in ("various artists", "v/a"):
            continue
        items.append(
            {
                "type": "release",
                "date": release.get("release_date") or (release.get("detected_at") or "")[:10],
                "artist": release.get("artist_name", ""),
                "title": release.get("album_title", ""),
                "subtitle": release.get("release_type") or "Album",
                "cover_url": release.get("cover_url"),
                "status": release.get("status", "detected"),
                "tidal_url": release.get("tidal_url"),
                "release_id": release.get("id"),
                "is_upcoming": bool(release.get("release_date") and release["release_date"] >= today),
            }
        )

    shows = db_get_shows(limit=1000)
    genre_map = {}
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            ORDER BY ag.weight DESC
            """
        )
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])

    for show in shows:
        artist = show["artist_name"]
        items.append(
            {
                "type": "show",
                "date": show["date"],
                "time": show.get("local_time"),
                "artist": artist,
                "title": show.get("venue") or "",
                "subtitle": f"{show.get('city', '')}, {show.get('country', '')}".strip(", "),
                "cover_url": show.get("image_url"),
                "status": show.get("status", "onsale"),
                "url": show.get("url"),
                "venue": show.get("venue"),
                "city": show.get("city"),
                "country": show.get("country"),
                "country_code": show.get("country_code"),
                "latitude": show.get("latitude"),
                "longitude": show.get("longitude"),
                "lineup": show.get("lineup"),
                "genres": genre_map.get(artist, [])[:3],
                "is_upcoming": True,
            }
        )

    items.sort(key=lambda item: item.get("date") or "9999")
    return {"items": items}


@router.get("/api/artist/{name}/network")
def api_artist_network(request: Request, name: str, depth: int = 2):
    _require_auth(request)
    from crate.db import get_artist_network

    return get_artist_network(name, depth=min(depth, 3), limit_per_level=15)


@router.get("/api/artist/{name:path}")
def api_artist(request: Request, name: str):
    _require_auth(request)
    if not has_library_data():
        result = fs_artist_detail(name)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    artist = get_library_artist(name)
    if not artist:
        result = fs_artist_detail(name)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    canonical = artist["name"]
    albums_data = get_library_albums(canonical)

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.artist_name = %s ORDER BY ag.weight DESC",
            (canonical,),
        )
        top_genres = [row["name"] for row in cur.fetchall()]

    albums = []
    for album in albums_data:
        albums.append(
            {
                "id": album["id"],
                "name": album["name"],
                "display_name": display_name(album["name"]),
                "tracks": album["track_count"],
                "formats": album.get("formats", []),
                "size_mb": round(album["total_size"] / (1024**2)) if album["total_size"] else 0,
                "year": album.get("year", ""),
                "has_cover": bool(album.get("has_cover")),
            }
        )

    return {
        "name": canonical,
        "albums": albums,
        "total_tracks": artist["track_count"],
        "total_size_mb": round(artist["total_size"] / (1024**2)) if artist["total_size"] else 0,
        "primary_format": artist.get("primary_format"),
        "genres": top_genres,
        "issue_count": get_artist_issue_count(canonical),
    }
