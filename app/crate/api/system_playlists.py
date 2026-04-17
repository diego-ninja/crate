from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.playlist_utils import apply_playlist_cover_payload, execute_smart_rules
from crate.api.schemas.common import OkResponse
from crate.api.schemas.curation import (
    CreateSystemPlaylistRequest,
    SystemPlaylistDetailResponse,
    SystemPlaylistGenerateResponse,
    SystemPlaylistSummaryResponse,
    UpdateSystemPlaylistRequest,
)
from crate.playlist_covers import delete_playlist_cover
from crate.db import (
    create_playlist,
    delete_playlist,
    get_playlist,
    get_playlist_followers_count,
    get_playlist_tracks,
    list_system_playlists,
    update_playlist,
)

router = APIRouter(prefix="/api/admin/system-playlists", tags=["admin"])

_SYSTEM_PLAYLIST_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested system playlist could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _serialize_admin_playlist(playlist: dict, *, include_tracks: bool = False) -> dict:
    item = dict(playlist)
    item["follower_count"] = get_playlist_followers_count(item["id"])
    if include_tracks:
        item["tracks"] = get_playlist_tracks(item["id"])
    return item


def _require_system_playlist(playlist_id: int) -> dict:
    playlist = get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if playlist.get("scope") != "system":
        raise HTTPException(status_code=404, detail="System playlist not found")
    return playlist


def _validate_generation_mode(generation_mode: str, smart_rules: dict | None = None) -> str:
    mode = (generation_mode or "static").strip().lower()
    if mode not in {"static", "smart"}:
        raise HTTPException(status_code=422, detail="generation_mode must be 'static' or 'smart'")
    if mode == "smart" and not smart_rules:
        raise HTTPException(status_code=422, detail="smart_rules are required for smart system playlists")
    return mode


@router.get(
    "",
    response_model=list[SystemPlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List admin system playlists",
)
def admin_list_system_playlists(request: Request, curated_only: bool = False, include_inactive: bool = True):
    _require_admin(request)
    playlists = list_system_playlists(
        only_curated=curated_only,
        only_active=not include_inactive,
    )
    return [_serialize_admin_playlist(playlist) for playlist in playlists]


@router.post(
    "",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Create a system playlist",
)
def admin_create_system_playlist(request: Request, body: CreateSystemPlaylistRequest):
    admin = _require_admin(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    mode = _validate_generation_mode(body.generation_mode, body.smart_rules)
    playlist_id = create_playlist(
        name=body.name.strip(),
        description=body.description,
        user_id=None,
        is_smart=mode == "smart",
        smart_rules=body.smart_rules if mode == "smart" else None,
        scope="system",
        generation_mode=mode,
        is_curated=body.is_curated,
        is_active=body.is_active,
        managed_by_user_id=admin.get("id"),
        curation_key=body.curation_key,
        featured_rank=body.featured_rank,
        category=body.category,
    )
    cover_update = apply_playlist_cover_payload(playlist_id, body.cover_data_url)
    if cover_update:
        update_playlist(playlist_id, **cover_update)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.get(
    "/{playlist_id}",
    response_model=SystemPlaylistDetailResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Get a system playlist with tracks",
)
def admin_get_system_playlist(request: Request, playlist_id: int):
    _require_admin(request)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist, include_tracks=True)


@router.put(
    "/{playlist_id}",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Update a system playlist",
)
def admin_update_system_playlist(request: Request, playlist_id: int, body: UpdateSystemPlaylistRequest):
    _require_admin(request)
    playlist = _require_system_playlist(playlist_id)

    next_mode = body.generation_mode or playlist.get("generation_mode") or "static"
    next_rules = body.smart_rules if body.smart_rules is not None else playlist.get("smart_rules")
    mode = _validate_generation_mode(next_mode, next_rules if next_mode == "smart" else None)

    kwargs: dict = {
        "generation_mode": mode,
        "is_smart": mode == "smart",
    }
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="Name is required")
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.cover_data_url is not None:
        kwargs.update(apply_playlist_cover_payload(playlist_id, body.cover_data_url, playlist.get("cover_path")) or {})
    if body.smart_rules is not None or mode == "static":
        kwargs["smart_rules"] = next_rules if mode == "smart" else None
    if body.is_curated is not None:
        kwargs["is_curated"] = body.is_curated
    if body.is_active is not None:
        kwargs["is_active"] = body.is_active
    if body.curation_key is not None:
        kwargs["curation_key"] = body.curation_key
    if body.featured_rank is not None:
        kwargs["featured_rank"] = body.featured_rank
    if body.category is not None:
        kwargs["category"] = body.category

    update_playlist(playlist_id, **kwargs)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.delete(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Delete a system playlist",
)
def admin_delete_system_playlist(request: Request, playlist_id: int):
    _require_admin(request)
    playlist = _require_system_playlist(playlist_id)
    delete_playlist_cover(playlist.get("cover_path"))
    delete_playlist(playlist_id)
    return {"ok": True}


@router.post(
    "/{playlist_id}/activate",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Activate a system playlist",
)
def admin_activate_system_playlist(request: Request, playlist_id: int):
    _require_admin(request)
    _require_system_playlist(playlist_id)
    update_playlist(playlist_id, is_active=True)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.post(
    "/{playlist_id}/deactivate",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Deactivate a system playlist",
)
def admin_deactivate_system_playlist(request: Request, playlist_id: int):
    _require_admin(request)
    _require_system_playlist(playlist_id)
    update_playlist(playlist_id, is_active=False)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.post(
    "/{playlist_id}/generate",
    response_model=SystemPlaylistGenerateResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Regenerate a smart system playlist",
)
def admin_generate_system_playlist(request: Request, playlist_id: int):
    _require_admin(request)
    playlist = _require_system_playlist(playlist_id)
    if playlist.get("generation_mode") != "smart" or not playlist.get("smart_rules"):
        raise HTTPException(status_code=400, detail="Not a smart system playlist")

    tracks = execute_smart_rules(playlist["smart_rules"])
    from crate.db.playlists import replace_playlist_tracks
    replace_playlist_tracks(playlist_id, tracks or [])

    playlist = _require_system_playlist(playlist_id)
    item = _serialize_admin_playlist(playlist, include_tracks=True)
    item["generated_track_count"] = len(tracks)
    return item
