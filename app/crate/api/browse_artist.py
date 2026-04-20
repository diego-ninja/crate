import logging
from typing import Any

import mutagen
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import COVER_NAMES, artist_name_from_id, coerce_date, extensions, library_path, safe_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import ARTIST_PHOTO_NAMES, display_name, fs_artist_detail, fs_build_artists_list, has_library_data
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.browse import (
    ArtistsWithShowsResponse,
    ArtistBrowseListResponse,
    ArtistCheckLibraryRequest,
    ArtistCheckLibraryResponse,
    ArtistDetailResponse,
    ArtistEnqueueResponse,
    ArtistInfoResponse,
    ArtistNetworkResponse,
    ArtistSetlistPlayableResponse,
    CachedShowsResponse,
    ShowsListResponse,
    UpcomingResponse,
    ArtistShowsResponse,
    ArtistTopTrackResponse,
    ArtistTrackTitleResponse,
    BrowseFiltersResponse,
)
from crate.audio import get_audio_files
from crate.db import (
    get_all_artist_issue_counts,
    get_artist_issue_count,
    get_library_albums,
    get_library_artist,
)
from crate.db.queries.browse_artist import (
    check_artists_in_library,
    get_all_artist_genre_map,
    get_artist_all_tracks,
    get_artist_genres_by_name,
    get_artist_list_genres,
    get_artist_refs_by_names_full,
    get_artist_setlist_tracks,
    get_artist_top_genres,
    get_artist_track_titles_with_albums,
    get_artists_count,
    get_artists_page,
    get_browse_filter_countries,
    get_browse_filter_decades,
    get_browse_filter_formats,
    get_browse_filter_genres,
    get_similar_artist_refs,
)
from crate.lastfm import get_artist_info
from crate.storage_layout import resolve_artist_dir

log = logging.getLogger(__name__)

router = APIRouter(tags=["browse"])

_BROWSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested browse resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_IMAGE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary image response.",
            "content": {
                "image/jpeg": {},
                "image/png": {},
                "image/svg+xml": {},
            },
        },
        404: error_response("The requested image was not found."),
    },
)


def _library_artist_ref(name: str) -> dict | None:
    artist = get_library_artist(name)
    if not artist:
        return None
    return {
        "id": artist.get("id"),
        "slug": artist.get("slug"),
        "name": artist.get("name"),
    }


def _lookup_artist_refs(names: list[str]) -> dict[str, dict]:
    return get_artist_refs_by_names_full(names)


def _show_lineup_artists(show: dict, refs_by_name: dict[str, dict]) -> list[dict]:
    lineup = show.get("lineup") if isinstance(show.get("lineup"), list) else None
    names = lineup or ([show.get("artist_name")] if show.get("artist_name") else [])
    artists: list[dict] = []
    for name in names:
        current = {"name": name}
        ref = refs_by_name.get((name or "").lower())
        if ref:
            current["id"] = ref.get("id")
            current["slug"] = ref.get("slug")
        artists.append(current)
    return artists


def _enrich_similar_artists(similar: list[dict]) -> list[dict]:
    names = [item.get("name") for item in similar if item.get("name")]
    if not names:
        return []

    refs = get_similar_artist_refs(names)

    enriched: list[dict] = []
    for item in similar:
        current = dict(item)
        ref = refs.get((current.get("name") or "").lower())
        if ref:
            current.setdefault("id", ref.get("id"))
            current.setdefault("slug", ref.get("slug"))
        enriched.append(current)
    return enriched


def _normalize_song_title(value: str) -> str:
    return (
        (value or "")
        .lower()
        .replace("'", "'")
        .replace("`", "'")
        .replace("\"", "")
        .replace("(", " ")
        .replace(")", " ")
        .replace("[", " ")
        .replace("]", " ")
        .replace("-", " ")
        .replace("_", " ")
        .strip()
    )


def _match_setlist_track(
    song_title: str,
    tracks: list[dict],
    used_ids: set[int],
) -> dict | None:
    normalized_target = " ".join(_normalize_song_title(song_title).split())
    if not normalized_target:
        return None

    def unused(track: dict) -> bool:
        return track.get("id") not in used_ids

    exact = next(
        (
            track
            for track in tracks
            if unused(track) and (track.get("title") or "").lower() == song_title.lower()
        ),
        None,
    )
    if exact:
        return exact

    normalized = next(
        (
            track
            for track in tracks
            if unused(track)
            and " ".join(_normalize_song_title(track.get("title") or "").split()) == normalized_target
        ),
        None,
    )
    if normalized:
        return normalized

    contains = next(
        (
            track
            for track in tracks
            if unused(track)
            and (
                " ".join(_normalize_song_title(track.get("title") or "").split()).startswith(normalized_target)
                or normalized_target.startswith(" ".join(_normalize_song_title(track.get("title") or "").split()))
                or normalized_target in " ".join(_normalize_song_title(track.get("title") or "").split())
            )
        ),
        None,
    )
    return contains


@router.get(
    "/api/browse/filters",
    response_model=BrowseFiltersResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List available browse filters",
)
def api_browse_filters(
    request: Request,
    country: str = "",
    decade: str = "",
    format: str = "",
):
    """Available filter options for the browse page."""
    _require_auth(request)
    genres = get_browse_filter_genres(country=country, decade=decade, format=format)
    countries = get_browse_filter_countries()
    decades = get_browse_filter_decades()
    formats = get_browse_filter_formats()
    return {"genres": genres, "countries": countries, "decades": decades, "formats": formats}


@router.get(
    "/api/artists",
    response_model=ArtistBrowseListResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List artists in the library",
)
def api_artists(
    request: Request,
    q: str = "",
    page: int = 1,
    per_page: int = Query(60, ge=1, le=120),
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

    select_cols = "la.*, COALESCE(la.dir_mtime, EXTRACT(EPOCH FROM la.updated_at)::bigint) AS recent_sort"
    joins = ""
    where_clauses = ["1=1"]
    params: dict = {}

    if genre:
        joins += " JOIN artist_genres ag ON la.name = ag.artist_name JOIN genres g ON ag.genre_id = g.id"
        where_clauses.append("g.name = :genre")
        params["genre"] = genre

    if country:
        where_clauses.append("la.country = :country")
        params["country"] = country

    if decade:
        try:
            decade_start = int(decade.rstrip("s"))
            where_clauses.append("la.formed IS NOT NULL AND length(la.formed) >= 4")
            where_clauses.append("CAST(substring(la.formed, 1, 4) AS INTEGER) BETWEEN :decade_start AND :decade_end")
            params["decade_start"] = decade_start
            params["decade_end"] = decade_start + 9
        except (ValueError, TypeError):
            pass

    if format:
        where_clauses.append("la.primary_format = :format")
        params["format"] = format

    if q:
        where_clauses.append("la.name ILIKE :q")
        params["q"] = f"%{q}%"

    where_sql = " AND ".join(where_clauses)
    sort_map = {
        "name": "la.name ASC",
        "popularity": "la.listeners DESC NULLS LAST",
        "albums": "la.album_count DESC",
        "recent": "recent_sort DESC",
        "size": "la.total_size DESC",
        "tracks": "la.track_count DESC",
    }
    order_sql = sort_map.get(sort, "la.name ASC")

    total = get_artists_count(joins, where_sql, params)
    rows = get_artists_page(select_cols, joins, where_sql, order_sql, params, per_page, (page - 1) * per_page)

    issue_counts = get_all_artist_issue_counts()
    items = []
    for row in rows:
        item = {
            "id": row.get("id"),
            "slug": row.get("slug"),
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
            item["genres"] = get_artist_list_genres(row["name"])
        items.append(item)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.post(
    "/api/artists/check-library",
    response_model=ArtistCheckLibraryResponse,
    responses=_BROWSE_RESPONSES,
    summary="Check which artists already exist in the local library",
)
def api_check_artists_in_library(request: Request, body: ArtistCheckLibraryRequest):
    """Check which artists from a list exist in the local library. Returns a dict of name -> boolean."""
    _require_auth(request)
    names = body.names
    if not names:
        return {}
    found = check_artists_in_library(names)
    return {name: name.lower() in found for name in names}


@router.get(
    "/api/artists/{artist_id}",
    response_model=ArtistDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed artist information",
)
def api_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist(request, artist_name)


@router.get(
    "/api/artists/{artist_id}/background",
    responses=_IMAGE_RESPONSES,
    summary="Get an artist background image",
)
def api_artist_background_by_id(request: Request, artist_id: int, random_pick: bool = Query(False, alias="random")):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return Response(status_code=404)
    return api_artist_background(request, artist_name, random_pick)


@router.get(
    "/api/artists/{artist_id}/top-tracks",
    response_model=list[ArtistTopTrackResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="Get top tracks for an artist",
)
def api_artist_top_tracks(request: Request, artist_id: int, count: int = Query(20, ge=1, le=50)):
    """Top tracks for an artist. Uses Last.fm global popularity to rank,
    matched against tracks in the local library. Falls back to local play
    counts if Last.fm data doesn't match, then to album track order."""
    _require_auth(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse([], status_code=200)

    all_tracks = {r["title"].lower(): r for r in get_artist_all_tracks(artist_name)}

    from crate.lastfm import get_top_tracks
    lastfm_top = get_top_tracks(artist_name, limit=count * 2) or []

    ranked = []
    seen_ids: set[int] = set()
    for lfm in lastfm_top:
        match = all_tracks.get(lfm["title"].lower())
        if match and match["id"] not in seen_ids:
            seen_ids.add(match["id"])
            ranked.append(match)
            if len(ranked) >= count:
                break

    if len(ranked) < count:
        remaining = [t for t in all_tracks.values() if t["id"] not in seen_ids]
        remaining.sort(key=lambda t: (t.get("year") or "0", t.get("track_number") or 0), reverse=True)
        ranked.extend(remaining[:count - len(ranked)])

    def _fmt(r: dict) -> dict:
        return {
            "id": str(r["id"]),
            "track_id": r["id"],
            "title": r["title"],
            "artist": r["artist"],
            "artist_id": r["artist_id"],
            "artist_slug": r["artist_slug"],
            "album": r["album"],
            "album_id": r["album_id"],
            "album_slug": r["album_slug"],
            "duration": r["duration"] or 0,
            "track": r["track_number"] or 0,
            "format": r["format"],
        }

    return [_fmt(r) for r in ranked]


@router.get(
    "/api/artists/{artist_id}/photo",
    responses=_IMAGE_RESPONSES,
    summary="Get an artist photo",
)
def api_artist_photo_by_id(request: Request, artist_id: int, random_pick: bool = Query(False, alias="random")):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return Response(status_code=404)
    return api_artist_photo(request, artist_name, random_pick)


@router.get(
    "/api/artists/{artist_id}/info",
    response_model=ArtistInfoResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get external metadata for an artist",
)
def api_artist_info_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist_info(request, artist_name)


@router.get(
    "/api/artists/{artist_id}/shows",
    response_model=ArtistShowsResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get upcoming shows for an artist",
)
def api_artist_shows_by_id(request: Request, artist_id: int, limit: int = Query(10), country: str = Query("")):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist_shows(request, artist_name, limit, country)


@router.post(
    "/api/artists/{artist_id}/enrich",
    response_model=ArtistEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue artist enrichment",
)
def api_artist_enrich_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist_enrich(request, artist_name)


@router.get(
    "/api/artists/{artist_id}/track-titles",
    response_model=list[ArtistTrackTitleResponse],
    responses=_BROWSE_RESPONSES,
    summary="List track titles for an artist with album references",
)
def api_artist_track_titles_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist_track_titles(request, artist_name)


@router.get(
    "/api/artists/{artist_id}/setlist-playable",
    response_model=ArtistSetlistPlayableResponse,
    responses=_BROWSE_RESPONSES,
    summary="Match a probable setlist against playable local tracks",
)
def api_artist_setlist_playable_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"tracks": []}, status_code=404)
    return api_artist_setlist_playable(request, artist_name)


@router.get(
    "/api/artists/{artist_id}/network",
    response_model=ArtistNetworkResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get the related-artist network for an artist",
)
def api_artist_network_by_id(request: Request, artist_id: int, depth: int = 2):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_artist_network(request, artist_name, depth)


def api_artist_background(request: Request, name: str, random_pick: bool = Query(False, alias="random")):
    """Return artist background image."""
    _require_auth(request)
    import random as _random

    from crate.lastfm import _deezer_artist_image, download_artist_image, get_fanart_all_images, get_fanart_background

    _IMG_CACHE = {"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"}

    lib = library_path()
    artist_row = get_library_artist(name)
    artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=name, existing_only=True)
    if artist_dir and artist_dir.is_dir():
        bg_file = artist_dir / "background.jpg"
        if bg_file.exists():
            return Response(content=bg_file.read_bytes(), media_type="image/jpeg", headers=_IMG_CACHE)

    fanart = get_fanart_all_images(name)
    backgrounds = fanart.get("backgrounds", []) if fanart else []
    if backgrounds:
        url = _random.choice(backgrounds) if random_pick else backgrounds[0]
        image_data = download_artist_image(url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)

    url = get_fanart_background(name)
    if url:
        image_data = download_artist_image(url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)

    from crate.lastfm import get_lastfm_best_background

    lfm_bg = get_lastfm_best_background(name)
    if lfm_bg:
        return Response(content=lfm_bg, media_type="image/jpeg", headers=_IMG_CACHE)

    deezer_url = _deezer_artist_image(name)
    if deezer_url:
        image_data = download_artist_image(deezer_url)
        if image_data:
            return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)

    try:
        from crate.spotify import search_artist as spotify_search

        spotify_artist = spotify_search(name)
        if spotify_artist and spotify_artist.get("images"):
            img_url = spotify_artist["images"][0].get("url") if spotify_artist["images"] else None
            if img_url:
                image_data = download_artist_image(img_url)
                if image_data:
                    return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)
    except Exception:
        pass

    if artist_dir and artist_dir.is_dir():
        for photo_name in ARTIST_PHOTO_NAMES:
            photo = artist_dir / photo_name
            if photo.exists():
                media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
                return Response(content=photo.read_bytes(), media_type=media_type)

    return Response(status_code=404)


def api_artist_photo(request: Request, name: str, random_pick: bool = Query(False, alias="random")):
    _require_auth(request)
    import random as _random

    from crate.lastfm import download_artist_image, get_fanart_all_images, get_best_artist_image

    lib = library_path()
    artist_row = get_library_artist(name)
    artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=name, existing_only=True)
    if not artist_dir or not artist_dir.is_dir():
        return Response(status_code=404)

    for photo_name in ARTIST_PHOTO_NAMES:
        photo = artist_dir / photo_name
        if photo.exists():
            media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
            return Response(
                content=photo.read_bytes(),
                media_type=media_type,
                headers={"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"},
            )

    _IMG_CACHE = {"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"}

    if random_pick:
        fanart = get_fanart_all_images(name)
        thumbs = fanart.get("thumbs", []) if fanart else []
        if thumbs:
            url = _random.choice(thumbs)
            image_data = download_artist_image(url)
            if image_data:
                return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)

    image_data = get_best_artist_image(name)
    if image_data:
        save_path = artist_dir / "artist.jpg"
        try:
            save_path.write_bytes(image_data)
        except OSError:
            pass
        return Response(content=image_data, media_type="image/jpeg", headers=_IMG_CACHE)

    exts = extensions()
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        for cover_name in COVER_NAMES:
            cover = album_dir / cover_name
            if cover.exists():
                media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
                return Response(content=cover.read_bytes(), media_type=media_type, headers=_IMG_CACHE)
        tracks = get_audio_files(album_dir, exts)
        if tracks:
            audio = mutagen.File(tracks[0])
            if audio and hasattr(audio, "pictures") and audio.pictures:
                pic = audio.pictures[0]
                return Response(content=pic.data, media_type=pic.mime, headers=_IMG_CACHE)
            if audio and hasattr(audio, "tags") and audio.tags:
                for key in audio.tags:
                    if isinstance(key, str) and key.startswith("APIC"):
                        pic = audio.tags[key]
                        return Response(content=pic.data, media_type=pic.mime)
        break

    return Response(status_code=404)


def api_artist_info(request: Request, name: str):
    _require_auth(request)
    info = get_artist_info(name)
    if not info:
        return JSONResponse({"error": "Not found on Last.fm"}, status_code=404)
    enriched = dict(info)
    enriched["similar"] = _enrich_similar_artists(info.get("similar") or [])
    return enriched


def api_artist_shows(request: Request, name: str, limit: int = Query(10), country: str = Query("")):
    user = _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows
    from crate.db import get_attending_show_ids
    from crate.ticketmaster import get_upcoming_shows, is_configured
    from crate import setlistfm

    artist_ref = _library_artist_ref(name)

    artist_genres = get_artist_genres_by_name(name, limit=5)

    cached = db_get_shows(artist_name=name, country=country or None, limit=limit)
    probable_setlist = []
    try:
        probable_setlist = (setlistfm.get_probable_setlist(name) or [])[:10]
    except Exception:
        probable_setlist = []
    if cached:
        attending_show_ids = get_attending_show_ids(
            user["id"],
            [show["id"] for show in cached if show.get("id") is not None],
        )
        events = [
            {
                "id": str(show.get("id") or show.get("external_id") or f"{name}-{show.get('date', '')}"),
                "show_id": show.get("id"),
                "artist_name": show.get("artist_name", name),
                "artist_id": artist_ref.get("id") if artist_ref else None,
                "artist_slug": artist_ref.get("slug") if artist_ref else None,
                "date": show.get("date"),
                "local_time": show.get("local_time"),
                "venue": show.get("venue"),
                "address_line1": show.get("address_line1"),
                "city": show.get("city"),
                "region": show.get("region"),
                "postal_code": show.get("postal_code"),
                "country": show.get("country"),
                "country_code": show.get("country_code"),
                "url": show.get("url"),
                "image_url": show.get("image_url"),
                "lineup": show.get("lineup"),
                "latitude": show.get("latitude"),
                "longitude": show.get("longitude"),
                "artist_genres": artist_genres[:3],
                "probable_setlist": probable_setlist,
                "user_attending": show.get("id") in attending_show_ids,
                "artist_listeners": 0,
            }
            for show in cached
        ]
        return {"events": events, "configured": is_configured(), "source": "cache"}

    if not is_configured():
        return {"events": [], "configured": False, "source": "none"}

    events = get_upcoming_shows(name, country_code=country, limit=limit)
    normalized = []
    for show in events:
        normalized.append(
            {
                "id": str(show.get("id") or show.get("external_id") or f"{name}-{show.get('date', '')}"),
                "show_id": show.get("id"),
                "artist_name": show.get("artist_name", name),
                "artist_id": artist_ref.get("id") if artist_ref else None,
                "artist_slug": artist_ref.get("slug") if artist_ref else None,
                "date": show.get("date"),
                "local_time": show.get("local_time"),
                "venue": show.get("venue"),
                "address_line1": show.get("address_line1"),
                "city": show.get("city"),
                "region": show.get("region"),
                "postal_code": show.get("postal_code"),
                "country": show.get("country"),
                "country_code": show.get("country_code"),
                "url": show.get("url"),
                "image_url": show.get("image_url"),
                "lineup": show.get("lineup"),
                "latitude": show.get("latitude"),
                "longitude": show.get("longitude"),
                "artist_genres": artist_genres[:3],
                "probable_setlist": probable_setlist,
                "user_attending": False,
                "artist_listeners": 0,
            }
        )
    return {"events": normalized, "configured": True, "source": "live"}


@router.get(
    "/api/shows/artists-with-shows",
    response_model=ArtistsWithShowsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List artists that currently have cached shows",
)
def api_artists_with_shows(request: Request):
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows

    shows = db_get_shows()
    artist_names = sorted({show["artist_name"] for show in shows})
    return {"artists": artist_names}


@router.get(
    "/api/shows/cached",
    response_model=CachedShowsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List cached upcoming shows",
)
def api_cached_shows(request: Request, limit: int = Query(50)):
    _require_auth(request)
    from crate.db import get_upcoming_shows as db_get_shows

    shows = db_get_shows(limit=limit)
    genre_map = get_all_artist_genre_map()

    refs_by_name = _lookup_artist_refs(
        [
            artist_name
            for show in shows
            for artist_name in ([show.get("artist_name")] + list(show.get("lineup") or []))
            if artist_name
        ]
    )
    events = []
    for show in shows:
        artist_ref = refs_by_name.get((show.get("artist_name") or "").lower())
        events.append(
            {
                **show,
                "artist_id": artist_ref.get("id") if artist_ref else None,
                "artist_slug": artist_ref.get("slug") if artist_ref else None,
                "lineup_artists": _show_lineup_artists(show, refs_by_name),
                "artist_genres": genre_map.get(show["artist_name"], [])[:3],
                "artist_listeners": 0,
            }
        )
    return {"events": events}


@router.get(
    "/api/shows",
    response_model=ShowsListResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List upcoming shows with available filters",
)
def api_shows_list(request: Request, city: str = "", country: str = ""):
    _require_auth(request)
    from crate.db import get_show_cities, get_show_countries, get_upcoming_shows as db_get_shows

    shows = db_get_shows(city=city or None, country=country or None)
    refs_by_name = _lookup_artist_refs(
        [
            artist_name
            for show in shows
            for artist_name in ([show.get("artist_name")] + list(show.get("lineup") or []))
            if artist_name
        ]
    )
    enriched_shows = []
    for show in shows:
        artist_ref = refs_by_name.get((show.get("artist_name") or "").lower())
        enriched_shows.append(
            {
                **show,
                "artist_id": artist_ref.get("id") if artist_ref else None,
                "artist_slug": artist_ref.get("slug") if artist_ref else None,
                "lineup_artists": _show_lineup_artists(show, refs_by_name),
            }
        )
    return {"shows": enriched_shows, "filters": {"cities": get_show_cities(), "countries": get_show_countries()}}


def api_artist_enrich(request: Request, name: str):
    _require_auth(request)
    from crate.content import queue_process_new_content_if_needed

    task_id = queue_process_new_content_if_needed(name, force=True)
    return {"status": "queued", "task_id": task_id}


def api_artist_track_titles(request: Request, name: str):
    _require_auth(request)
    rows = get_artist_track_titles_with_albums(name)
    return [
        {
            "title": row["title"],
            "album": row["album"],
            "album_id": row.get("album_id"),
            "album_slug": row.get("album_slug"),
            "path": row["path"],
        }
        for row in rows
    ]


def api_artist_setlist_playable(request: Request, name: str):
    _require_auth(request)
    from crate import setlistfm

    probable_setlist = setlistfm.get_probable_setlist(name) or []
    if not probable_setlist:
        return {"tracks": []}

    artist_row = get_library_artist(name)
    artist_id = artist_row["id"] if artist_row else None
    artist_slug = artist_row.get("slug") if artist_row else None

    library_tracks = get_artist_setlist_tracks(name)

    used_ids: set[int] = set()
    matched_tracks: list[dict] = []
    for song in probable_setlist:
        match = _match_setlist_track(song.get("title", ""), library_tracks, used_ids)
        if not match:
            continue
        used_ids.add(match["id"])
        matched_tracks.append(
            {
                "library_track_id": match["id"],
                "track_storage_id": match.get("track_storage_id"),
                "title": match.get("title", ""),
                "artist": name,
                "artist_id": artist_id,
                "artist_slug": artist_slug,
                "album": match.get("album", ""),
                "album_id": match.get("album_id"),
                "album_slug": match.get("album_slug"),
                "path": match.get("path", ""),
                "duration": match.get("duration"),
                "setlist_title": song.get("title", ""),
                "position": song.get("position"),
            }
        )

    return {"tracks": matched_tracks}


@router.get(
    "/api/upcoming",
    response_model=UpcomingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List upcoming releases and shows",
)
def api_upcoming(request: Request):
    from datetime import datetime, timezone

    from crate.db import get_new_releases, get_upcoming_shows as db_get_shows

    _require_auth(request)
    items = []
    today = datetime.now(timezone.utc).date()

    releases = get_new_releases(limit=50)
    for release in releases:
        if release.get("status") == "dismissed":
            continue
        if release.get("artist_name", "").lower() in ("various artists", "v/a"):
            continue
        scheduled_date = coerce_date(release.get("release_date"))
        fallback_date = scheduled_date or coerce_date(release.get("detected_at"))
        items.append(
            {
                "type": "release",
                "date": fallback_date.isoformat() if fallback_date else "",
                "artist": release.get("artist_name", ""),
                "artist_id": release.get("artist_id"),
                "artist_slug": release.get("artist_slug"),
                "title": release.get("album_title", ""),
                "album_id": release.get("album_id"),
                "album_slug": release.get("album_slug"),
                "subtitle": release.get("release_type") or "Album",
                "cover_url": release.get("cover_url"),
                "status": release.get("status", "detected"),
                "tidal_url": release.get("tidal_url"),
                "release_id": release.get("id"),
                "is_upcoming": bool(scheduled_date and scheduled_date >= today),
            }
        )

    shows = db_get_shows(limit=1000)
    refs_by_name = _lookup_artist_refs(
        [
            artist_name
            for show in shows
            for artist_name in ([show.get("artist_name")] + list(show.get("lineup") or []))
            if artist_name
        ]
    )
    genre_map = get_all_artist_genre_map()

    for show in shows:
        artist = show["artist_name"]
        artist_ref = refs_by_name.get((artist or "").lower())
        show_date = coerce_date(show.get("date"))
        items.append(
            {
                "type": "show",
                "date": show_date.isoformat() if show_date else "",
                "time": show.get("local_time"),
                "artist": artist,
                "artist_id": artist_ref.get("id") if artist_ref else None,
                "artist_slug": artist_ref.get("slug") if artist_ref else None,
                "title": show.get("venue") or "",
                "subtitle": f"{show.get('city', '')}, {show.get('country', '')}".strip(", "),
                "cover_url": show.get("image_url"),
                "status": show.get("status", "onsale"),
                "url": show.get("url"),
                "venue": show.get("venue"),
                "address_line1": show.get("address_line1"),
                "city": show.get("city"),
                "region": show.get("region"),
                "postal_code": show.get("postal_code"),
                "country": show.get("country"),
                "country_code": show.get("country_code"),
                "latitude": show.get("latitude"),
                "longitude": show.get("longitude"),
                "lineup": show.get("lineup"),
                "lineup_artists": _show_lineup_artists(show, refs_by_name),
                "genres": genre_map.get(artist, [])[:3],
                "is_upcoming": True,
            }
        )

    items.sort(key=lambda item: item.get("date") or "9999-12-31")
    return {"items": items}


def api_artist_network(request: Request, name: str, depth: int = 2):
    _require_auth(request)
    from crate.db import get_artist_network

    return get_artist_network(name, depth=min(depth, 3), limit_per_level=15)


@router.get(
    "/api/network/external-artist",
    response_model=ArtistNetworkResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get the related-artist network for a free-form artist name",
)
def api_artist_network_by_name(request: Request, name: str = Query(""), depth: int = 2):
    if not name.strip():
        return JSONResponse({"error": "name required"}, status_code=400)
    return api_artist_network(request, name, depth)


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

    top_genres = get_artist_top_genres(canonical)

    albums = []
    for album in albums_data:
        albums.append(
            {
                "id": album["id"],
                "slug": album.get("slug"),
                "name": album["name"],
                "display_name": display_name(album["name"]),
                "tracks": album["track_count"],
                "formats": album.get("formats", []),
                "size_mb": round(album["total_size"] / (1024**2)) if album["total_size"] else 0,
                "year": album.get("year", ""),
                "has_cover": bool(album.get("has_cover")),
                "musicbrainz_albumid": album.get("musicbrainz_albumid"),
            }
        )

    from crate.storage_layout import looks_like_storage_id
    folder_name = artist.get("folder_name") or ""
    is_v2 = bool(folder_name and looks_like_storage_id(folder_name))

    return {
        "id": artist.get("id"),
        "slug": artist.get("slug"),
        "name": canonical,
        "albums": albums,
        "total_tracks": artist["track_count"],
        "total_size_mb": round(artist["total_size"] / (1024**2)) if artist["total_size"] else 0,
        "primary_format": artist.get("primary_format"),
        "genres": top_genres,
        "issue_count": get_artist_issue_count(canonical),
        "is_v2": is_v2,
    }
