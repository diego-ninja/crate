from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.curation import (
    CuratedFollowMutationResponse,
    CuratedFollowStatusResponse,
    CuratedPlaylistDetailResponse,
    CuratedPlaylistSummaryResponse,
)
from crate.api.schemas.common import OkResponse
from crate.db import (
    follow_playlist,
    get_followed_system_playlists,
    get_playlist,
    get_playlist_followers_count,
    get_playlist_tracks,
    is_playlist_followed,
    list_system_playlists,
    unfollow_playlist,
)

router = APIRouter(prefix="/api/curation", tags=["curation"])

_CURATION_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested curated playlist could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _serialize_playlist(playlist: dict, *, user_id: int, include_tracks: bool = False) -> dict:
    item = dict(playlist)
    item["follower_count"] = get_playlist_followers_count(item["id"])
    item["is_followed"] = bool(item.get("is_followed")) or is_playlist_followed(user_id, item["id"])
    if include_tracks:
        item["tracks"] = get_playlist_tracks(item["id"])
    return item


def _require_public_system_playlist(playlist_id: int) -> dict:
    playlist = get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if playlist.get("scope") != "system" or not playlist.get("is_active", False):
        raise HTTPException(status_code=404, detail="System playlist not found")
    return playlist


@router.get(
    "/playlists",
    response_model=list[CuratedPlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List curated system playlists",
)
def curated_playlists(request: Request, category: str | None = None):
    user = _require_auth(request)
    playlists = list_system_playlists(
        only_curated=False,
        only_active=True,
        category=category,
        user_id=user["id"],
    )
    return [_serialize_playlist(playlist, user_id=user["id"]) for playlist in playlists]


@router.get(
    "/playlists/category/{category}",
    response_model=list[CuratedPlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List curated playlists in a category",
)
def curated_playlists_by_category(request: Request, category: str):
    user = _require_auth(request)
    playlists = list_system_playlists(
        only_curated=False,
        only_active=True,
        category=category,
        user_id=user["id"],
    )
    return [_serialize_playlist(playlist, user_id=user["id"]) for playlist in playlists]


@router.get(
    "/playlists/{playlist_id}",
    response_model=CuratedPlaylistDetailResponse,
    responses=_CURATION_RESPONSES,
    summary="Get a curated playlist with tracks",
)
def curated_playlist_detail(request: Request, playlist_id: int):
    user = _require_auth(request)
    playlist = _require_public_system_playlist(playlist_id)
    return _serialize_playlist(playlist, user_id=user["id"], include_tracks=True)


@router.post(
    "/playlists/{playlist_id}/follow",
    response_model=CuratedFollowMutationResponse,
    responses=_CURATION_RESPONSES,
    summary="Follow a curated playlist",
)
def curated_follow(request: Request, playlist_id: int):
    user = _require_auth(request)
    _require_public_system_playlist(playlist_id)
    added = follow_playlist(user["id"], playlist_id)
    return {"ok": True, "followed": added}


@router.delete(
    "/playlists/{playlist_id}/follow",
    response_model=OkResponse,
    responses=_CURATION_RESPONSES,
    summary="Unfollow a curated playlist",
)
def curated_unfollow(request: Request, playlist_id: int):
    user = _require_auth(request)
    _require_public_system_playlist(playlist_id)
    removed = unfollow_playlist(user["id"], playlist_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Playlist not followed")
    return {"ok": True}


@router.get(
    "/playlists/{playlist_id}/follow",
    response_model=CuratedFollowStatusResponse,
    responses=_CURATION_RESPONSES,
    summary="Get curated playlist follow status",
)
def curated_follow_status(request: Request, playlist_id: int):
    user = _require_auth(request)
    _require_public_system_playlist(playlist_id)
    return {"is_followed": is_playlist_followed(user["id"], playlist_id)}


@router.get(
    "/followed",
    response_model=list[CuratedPlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List followed curated playlists",
)
def curated_followed(request: Request):
    user = _require_auth(request)
    playlists = get_followed_system_playlists(user["id"])
    return [_serialize_playlist(playlist, user_id=user["id"]) for playlist in playlists]
