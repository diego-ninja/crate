from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.playlist_utils import apply_playlist_cover_payload, execute_smart_rules
from crate.api.schemas.common import OkResponse
from crate.api.schemas.playlists import (
    AddTracksRequest,
    CreatePlaylistRequest,
    PlaylistCreateResponse,
    PlaylistDetailResponse,
    PlaylistFilterOptionsResponse,
    PlaylistGenerateResponse,
    PlaylistInviteAcceptResponse,
    PlaylistInviteRequest,
    PlaylistInviteResponse,
    PlaylistMemberRequest,
    PlaylistMemberResponse,
    PlaylistMembersMutationResponse,
    PlaylistSummaryResponse,
    PlaylistTracksAddedResponse,
    ReorderRequest,
    UpdatePlaylistRequest,
)
from crate.playlist_covers import delete_playlist_cover, playlist_cover_abspath
from crate.db import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    remove_playlist_track, reorder_playlist,
    can_view_playlist, can_edit_playlist, is_playlist_owner,
    get_playlist_members, add_playlist_member, remove_playlist_member,
    create_playlist_invite, consume_playlist_invite,
)

router = APIRouter(prefix="/api/playlists", tags=["playlists"])

_PLAYLIST_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested playlist resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_PLAYLIST_COVER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Playlist cover image.",
            "content": {
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: error_response("The requested playlist cover could not be found."),
    },
)


# ── Filter options ───────────────────────────────────────────────

@router.get(
    "/filter-options",
    response_model=PlaylistFilterOptionsResponse,
    responses={
        200: {
            "description": "Available smart-playlist filter values.",
        }
    },
    summary="List available smart-playlist filter options",
)
def filter_options():
    """Return available values for smart playlist filters."""
    from crate.db import get_all_genres
    from crate.db.playlists import get_playlist_filter_options
    genres = [g["name"] for g in get_all_genres()]
    opts = get_playlist_filter_options()
    return {"genres": genres, **opts}


# ── CRUD ─────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=list[PlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List playlists visible to the current user",
)
def list_playlists(request: Request):
    user = _require_auth(request)
    playlists = get_playlists(user_id=user["id"])
    return playlists


@router.post(
    "",
    response_model=PlaylistCreateResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Create a playlist",
)
def create(request: Request, body: CreatePlaylistRequest):
    user = _require_auth(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    playlist_id = create_playlist(
        name=body.name.strip(),
        description=body.description,
        user_id=user["id"],
        is_smart=body.is_smart,
        smart_rules=body.smart_rules,
        visibility=body.visibility,
        is_collaborative=body.is_collaborative,
    )
    cover_update = apply_playlist_cover_payload(playlist_id, body.cover_data_url)
    if cover_update:
        update_playlist(playlist_id, **cover_update)
    return {"id": playlist_id}


@router.get(
    "/{playlist_id}",
    response_model=PlaylistDetailResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Get a playlist with tracks and members",
)
def get_one(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_view_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Playlist is private")
    tracks = get_playlist_tracks(playlist_id)
    pl["tracks"] = tracks
    pl["members"] = get_playlist_members(playlist_id)
    return pl


@router.put(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Update a playlist",
)
def update(request: Request, playlist_id: int, body: UpdatePlaylistRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.cover_data_url is not None:
        kwargs.update(apply_playlist_cover_payload(playlist_id, body.cover_data_url, pl.get("cover_path")) or {})
    if body.smart_rules is not None:
        kwargs["smart_rules"] = body.smart_rules
    if body.visibility is not None:
        if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
            raise HTTPException(status_code=403, detail="Only the owner can change playlist visibility")
        kwargs["visibility"] = body.visibility
    if body.is_collaborative is not None:
        if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
            raise HTTPException(status_code=403, detail="Only the owner can change playlist collaboration")
        kwargs["is_collaborative"] = body.is_collaborative
    if kwargs:
        update_playlist(playlist_id, **kwargs)
    return {"ok": True}


@router.delete(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Delete a playlist",
)
def delete(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can delete this playlist")
    delete_playlist_cover(pl.get("cover_path"))
    delete_playlist(playlist_id)
    return {"ok": True}


@router.get(
    "/{playlist_id}/cover",
    responses=_PLAYLIST_COVER_RESPONSES,
    summary="Fetch the cover image for a playlist",
)
def get_cover(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_view_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Playlist is private")
    cover_path = playlist_cover_abspath(pl.get("cover_path"))
    if not cover_path or not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    return FileResponse(cover_path)


# ── Tracks ───────────────────────────────────────────────────────

@router.post(
    "/{playlist_id}/tracks",
    response_model=PlaylistTracksAddedResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Add tracks to a playlist",
)
def add_tracks(request: Request, playlist_id: int, body: AddTracksRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    if not body.tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    add_playlist_tracks(playlist_id, body.tracks)
    return {"ok": True, "added": len(body.tracks)}


@router.delete(
    "/{playlist_id}/tracks/{position}",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Remove a track from a playlist by position",
)
def remove_track(request: Request, playlist_id: int, position: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    remove_playlist_track(playlist_id, position)
    return {"ok": True}


@router.post(
    "/{playlist_id}/reorder",
    response_model=OkResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Reorder playlist tracks",
)
def reorder(request: Request, playlist_id: int, body: ReorderRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    reorder_playlist(playlist_id, body.track_ids)
    return {"ok": True}


# ── Smart playlist generation ───────────────────────────────────

@router.post(
    "/{playlist_id}/generate",
    response_model=PlaylistGenerateResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Generate tracks for a smart playlist",
)
def generate_smart(request: Request, playlist_id: int):
    """Re-generate tracks for a smart playlist based on its rules."""
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl or not pl.get("is_smart") or not pl.get("smart_rules"):
        raise HTTPException(status_code=400, detail="Not a smart playlist or no rules defined")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")

    rules = pl["smart_rules"]
    tracks = execute_smart_rules(rules)

    from crate.db.playlists import replace_playlist_tracks
    replace_playlist_tracks(playlist_id, tracks or [])

    return {"ok": True, "track_count": len(tracks)}


@router.get(
    "/{playlist_id}/members",
    response_model=list[PlaylistMemberResponse],
    responses=_PLAYLIST_RESPONSES,
    summary="List playlist members",
)
def members(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_view_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Playlist is private")
    return get_playlist_members(playlist_id)


@router.post(
    "/{playlist_id}/members",
    response_model=PlaylistMembersMutationResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Add or update a playlist member",
)
def add_member(request: Request, playlist_id: int, body: PlaylistMemberRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can manage members")
    if body.role != "collab":
        raise HTTPException(status_code=422, detail="Invalid member role")
    add_playlist_member(playlist_id, body.user_id, role=body.role, invited_by=user["id"])
    update_playlist(playlist_id, is_collaborative=True)
    return {"ok": True, "members": get_playlist_members(playlist_id)}


@router.delete(
    "/{playlist_id}/members/{user_id}",
    response_model=PlaylistMembersMutationResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Remove a playlist member",
)
def delete_member(request: Request, playlist_id: int, user_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can manage members")
    if user_id == pl.get("user_id"):
        raise HTTPException(status_code=400, detail="The owner cannot be removed")
    removed = remove_playlist_member(playlist_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"ok": True, "members": get_playlist_members(playlist_id)}


@router.post(
    "/{playlist_id}/invites",
    response_model=PlaylistInviteResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Create a playlist invite",
)
def invite(request: Request, playlist_id: int, body: PlaylistInviteRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not is_playlist_owner(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Only the owner can create invites")
    invite_row = create_playlist_invite(
        playlist_id,
        user["id"],
        expires_in_hours=body.expires_in_hours,
        max_uses=body.max_uses,
    )
    return {
        **invite_row,
        "join_url": f"/playlist/invite/{invite_row['token']}",
        "qr_value": f"/playlist/invite/{invite_row['token']}",
    }


@router.post(
    "/invites/{token}/accept",
    response_model=PlaylistInviteAcceptResponse,
    responses=_PLAYLIST_RESPONSES,
    summary="Accept a playlist invite",
)
def accept_invite(request: Request, token: str):
    user = _require_auth(request)
    invite_row = consume_playlist_invite(token)
    if not invite_row:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    pl = get_playlist(invite_row["playlist_id"])
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    add_playlist_member(pl["id"], user["id"], role="collab", invited_by=invite_row.get("created_by"))
    update_playlist(pl["id"], is_collaborative=True)
    return {"ok": True, "playlist_id": pl["id"], "members": get_playlist_members(pl["id"])}
