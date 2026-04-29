from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.api._deps import enrich_radio_tracks as _enrich_radio_tracks
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.radio import RadioResponse
from crate.bliss import (
    generate_album_radio,
    generate_artist_radio,
    generate_playlist_radio,
    generate_track_radio,
    generate_virtual_playlist_radio,
)
from crate.db.repositories.auth import get_user_by_email
from crate.db.cache_store import get_cache, set_cache
from crate.db.repositories.library import (
    get_library_artist_by_id,
    resolve_library_track_reference,
)
from crate.db.queries.radio import (
    get_track_path_by_id,
    get_track_path_by_pattern,
    get_album_for_radio,
    get_playlist_for_radio,
)

router = APIRouter(tags=["radio"])

_RADIO_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The seed resource was not found or no radio data is available yet."),
        422: error_response("The route parameters failed validation."),
    },
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _effective_user_id(user: dict) -> int | None:
    if user.get("id") is not None:
        return user["id"]
    email = user.get("email")
    if not email:
        return None
    existing = get_user_by_email(email)
    return existing["id"] if existing else None


def _sanitize_radio_tracks(rows: list[dict]) -> list[dict]:
    sanitized: list[dict] = []
    for row in rows:
        item = dict(row)
        item.pop("track_storage_id", None)
        item.pop("storage_id", None)
        sanitized.append(item)
    return sanitized


def _resolve_track_path(track_id: int = 0, path: str = "", storage_id: str = "", entity_uid: str = "") -> str | None:
    if track_id:
        return get_track_path_by_id(track_id)

    track = resolve_library_track_reference(
        track_entity_uid=entity_uid or None,
        track_storage_id=storage_id or None,
        track_path=path or None,
    )
    if track and track.get("path"):
        return track["path"]

    if not path:
        return None

    return get_track_path_by_pattern(path, _escape_like(path))


_RADIO_CACHE_TTL = 300  # 5 minutes


def api_artist_radio(request: Request, artist_id: int, limit: int = Query(50, ge=1, le=100)):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    artist = get_library_artist_by_id(artist_id)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")

    artist_name = artist["name"]
    cache_key = f"radio:artist:{effective_user_id or 'anon'}:{artist_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_artist_radio(artist_id, limit=limit, user_id=effective_user_id)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)
    enriched_tracks = _sanitize_radio_tracks(_enrich_radio_tracks(tracks))
    result = {
        "session": {
            "type": "artist",
            "name": f"{artist_name} Radio",
            "seed": {"artist_id": artist_id, "artist_name": artist_name},
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get(
    "/api/artists/{artist_id}/radio",
    response_model=RadioResponse,
    responses=_RADIO_RESPONSES,
    summary="Build artist radio",
    deprecated=True,
)
def api_artist_radio_by_id(request: Request, artist_id: int, limit: int = Query(50, ge=1, le=100)):
    return api_artist_radio(request, artist_id, limit)


@router.get(
    "/api/radio/track",
    response_model=RadioResponse,
    responses=_RADIO_RESPONSES,
    summary="Build track radio",
    deprecated=True,
)
def api_track_radio(
    request: Request,
    track_id: int = 0,
    entity_uid: str = "",
    path: str = "",
    limit: int = Query(50, ge=1, le=100),
):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    legacy_storage_id = request.query_params.get("storage_id", "")
    resolved_path = _resolve_track_path(
        track_id=track_id,
        path=path,
        storage_id=legacy_storage_id,
        entity_uid=entity_uid,
    )
    if not resolved_path:
        raise HTTPException(status_code=404, detail="Track not found")

    cache_key = f"radio:track:{effective_user_id or 'anon'}:{resolved_path}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_track_radio(resolved_path, limit=limit, user_id=effective_user_id)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _sanitize_radio_tracks(_enrich_radio_tracks(tracks))
    seed_track = enriched_tracks[0]
    seed_entity_uid = seed_track.get("track_entity_uid")
    result = {
        "session": {
            "type": "track",
            "name": f"{seed_track.get('title') or 'Track'} Radio",
            "seed": {
                "track_id": seed_track.get("track_id"),
                "track_entity_uid": seed_entity_uid,
                "track_path": seed_track.get("track_path"),
                "title": seed_track.get("title"),
                "artist": seed_track.get("artist"),
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get(
    "/api/radio/album/{album_id}",
    response_model=RadioResponse,
    responses=_RADIO_RESPONSES,
    summary="Build album radio",
    deprecated=True,
)
def api_album_radio(request: Request, album_id: int, limit: int = Query(50, ge=1, le=100)):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    row = get_album_for_radio(album_id)
    if not row:
        raise HTTPException(status_code=404, detail="Album not found")

    cache_key = f"radio:album:{effective_user_id or 'anon'}:{album_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_album_radio(album_id, limit=limit, user_id=effective_user_id)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _sanitize_radio_tracks(_enrich_radio_tracks(tracks))
    result = {
        "session": {
            "type": "album",
            "name": f"{row['name']} Radio",
            "seed": {
                "album_id": album_id,
                "artist": row["artist"],
                "album": row["name"],
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get(
    "/api/radio/playlist/{playlist_id}",
    response_model=RadioResponse,
    responses=_RADIO_RESPONSES,
    summary="Build playlist radio",
    deprecated=True,
)
def api_playlist_radio(request: Request, playlist_id: int, limit: int = Query(50, ge=1, le=100)):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    row = get_playlist_for_radio(playlist_id)
    if not row:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.get("scope") == "system" and not row.get("is_active", False):
        raise HTTPException(status_code=404, detail="Playlist not found")
    if (
        row.get("scope") != "system"
        and row.get("user_id") != effective_user_id
        and user.get("role") != "admin"
    ):
        raise HTTPException(status_code=403, detail="Not your playlist")

    cache_key = f"radio:playlist:{effective_user_id or 'anon'}:{playlist_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_playlist_radio(playlist_id, limit=limit, user_id=effective_user_id)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _sanitize_radio_tracks(_enrich_radio_tracks(tracks))
    result = {
        "session": {
            "type": "playlist",
            "name": f"{row['name']} Radio",
            "seed": {
                "playlist_id": playlist_id,
                "name": row["name"],
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get(
    "/api/radio/home-playlist/{playlist_id}",
    response_model=RadioResponse,
    responses=_RADIO_RESPONSES,
    summary="Build radio from a home playlist",
    deprecated=True,
)
def api_home_playlist_radio(request: Request, playlist_id: str, limit: int = Query(50, ge=1, le=100)):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    from crate.db.home import get_home_playlist

    playlist = get_home_playlist(effective_user_id or user["id"], playlist_id, limit=max(limit, 40))
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    cache_key = f"radio:home-playlist:{effective_user_id or 'anon'}:{playlist_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_virtual_playlist_radio(playlist.get("tracks") or [], limit=limit, user_id=effective_user_id)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _sanitize_radio_tracks(_enrich_radio_tracks(tracks))
    result = {
        "session": {
            "type": "playlist",
            "name": f"{playlist['name']} Radio",
            "seed": {
                "playlist_id": playlist_id,
                "name": playlist["name"],
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


# ── Shaped Radio (v2) — sessions with like/dislike feedback ────────


class RadioStartRequest(BaseModel):
    mode: str = Field(default="seeded", description="seeded | discovery")
    seed_type: str | None = None
    seed_value: str | None = None


class RadioNextRequest(BaseModel):
    session_id: str
    count: int = Field(default=20, ge=1, le=50)


class RadioFeedbackRequest(BaseModel):
    session_id: str
    track_id: int
    action: str = Field(description="like | dislike")


@router.post(
    "/api/radio/start",
    responses=AUTH_ERROR_RESPONSES,
    summary="Start a shaped radio session",
)
def api_radio_start(request: Request, body: RadioStartRequest):
    user = _require_auth(request)
    from crate.radio_engine import start_radio
    result = start_radio(
        user_id=user["id"],
        mode=body.mode,
        seed_type=body.seed_type,
        seed_value=body.seed_value,
    )
    if not result:
        return JSONResponse(
            {"error": "Could not start radio — seed may lack bliss vectors or not enough user data"},
            status_code=422,
        )
    return result


@router.post(
    "/api/radio/next",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get next batch of radio tracks",
)
def api_radio_next(request: Request, body: RadioNextRequest):
    _require_auth(request)
    from crate.radio_engine import next_tracks
    result = next_tracks(body.session_id, body.count)
    if not result:
        return JSONResponse({"error": "Session not found or expired"}, status_code=404)
    return result


@router.post(
    "/api/radio/feedback",
    responses=AUTH_ERROR_RESPONSES,
    summary="Like or dislike a radio track to shape the session",
)
def api_radio_feedback(request: Request, body: RadioFeedbackRequest):
    _require_auth(request)
    from crate.radio_engine import radio_feedback
    result = radio_feedback(body.session_id, body.track_id, body.action)
    if not result:
        return JSONResponse({"error": "Session not found or expired"}, status_code=404)
    return result


@router.get(
    "/api/radio/can-discover",
    responses=AUTH_ERROR_RESPONSES,
    summary="Check if user has enough data for discovery radio",
)
def api_radio_can_discover(request: Request):
    user = _require_auth(request)
    from crate.radio_engine import has_enough_data
    return {"available": has_enough_data(user["id"])}


@router.delete(
    "/api/radio/session/{session_id}",
    responses=AUTH_ERROR_RESPONSES,
    summary="End a radio session",
)
def api_radio_end_session(request: Request, session_id: str):
    _require_auth(request)
    from crate.radio_engine import _delete_session
    if _delete_session(session_id):
        return {"status": "ended"}
    return JSONResponse({"error": "Session not found"}, status_code=404)
