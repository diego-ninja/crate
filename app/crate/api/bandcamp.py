from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response
from crate.api.permissions import require_permission
from crate.api.schemas.bandcamp import (
    BandcampContributionResponse,
    BandcampCollectionResponse,
    BandcampConnectionStatusResponse,
    BandcampCookieConnectRequest,
    BandcampImportRequest,
    BandcampImportResponse,
    BandcampRadarResponse,
    BandcampSessionConnectRequest,
    BandcampTaskResponse,
)
from crate.bandcamp.client import BandcampClient, BandcampClientError
from crate.bandcamp.client import session_material_from_payload
from crate.bandcamp.credential_broker import credential_bridge_status
from crate.bandcamp.credentials import fingerprint_secret, store_secret
from crate.bandcamp.models import BandcampSessionMaterial
from crate.bandcamp.web import BandcampWebClient, BandcampWebError
from crate.db.repositories.bandcamp import (
    create_bandcamp_import,
    disconnect_connection,
    get_bandcamp_import,
    get_bandcamp_link_for_entity,
    get_connection_for_user,
    get_user_owned_bandcamp_item,
    has_active_connection,
    list_admin_user_collections,
    list_bandcamp_imports,
    list_bandcamp_library_matches,
    list_bandcamp_match_candidates_for_name,
    list_bandcamp_radar_items,
    list_user_collection,
    set_bandcamp_import_task,
    set_bandcamp_library_match_status,
    update_bandcamp_radar_status,
    upsert_bandcamp_library_match,
    upsert_connection,
)
from crate.db.repositories.library_contributions import (
    get_user_album_contribution,
    list_user_album_contributions,
)
from crate.db.repositories.tasks import create_task

router = APIRouter(prefix="/api/bandcamp", tags=["bandcamp"])

_RESPONSES = {
    **AUTH_ERROR_RESPONSES,
    400: error_response("The request could not be processed."),
    403: error_response("Bandcamp credential bridge is disabled."),
    404: error_response("The requested Bandcamp resource was not found."),
}


def _require_bandcamp_manager(request: Request) -> dict:
    return require_permission(request, "library.bandcamp.manage")


def _connection_status(user_id: int) -> BandcampConnectionStatusResponse:
    connection = get_connection_for_user(user_id)
    bridge = credential_bridge_status()
    if not connection:
        return BandcampConnectionStatusResponse(
            connected=False,
            bridge_enabled=bool(bridge["enabled"]),
            bridge_ready=bool(bridge["ready"]),
            bridge_backend=bridge["backend"],
            bridge_message=bridge["message"],
        )
    return BandcampConnectionStatusResponse(
        connected=connection.get("status") == "connected",
        status=connection.get("status") or "disconnected",
        bridge_enabled=bool(bridge["enabled"]),
        bridge_ready=bool(bridge["ready"]),
        bridge_backend=bridge["backend"],
        bridge_message=bridge["message"],
        username=connection.get("username"),
        fan_id=connection.get("fan_id"),
        display_name=connection.get("display_name"),
        image_url=connection.get("image_url"),
        connection_method=connection.get("connection_method"),
        last_sync_at=connection.get("last_sync_at"),
        last_success_at=connection.get("last_success_at"),
        last_error=connection.get("last_error"),
    )


@router.get(
    "/me/status",
    response_model=BandcampConnectionStatusResponse,
    responses=_RESPONSES,
    summary="Get current user's Bandcamp connection status",
)
def api_bandcamp_status(request: Request):
    user = _require_auth(request)
    return _connection_status(int(user["id"]))


@router.post(
    "/me/connect/session",
    response_model=BandcampConnectionStatusResponse,
    responses=_RESPONSES,
    summary="Connect Bandcamp using session material captured by a native connector",
)
def api_bandcamp_connect_session(request: Request, body: BandcampSessionConnectRequest):
    user = _require_auth(request)
    if body.connection_method not in {
        "native_desktop",
        "native_mobile",
        "oauth",
        "manual_dev",
    }:
        raise HTTPException(
            status_code=400, detail="Unsupported session connection method"
        )

    try:
        session_material = session_material_from_payload(body.session)
        identity = BandcampClient(session_material).validate_session()
    except BandcampClientError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    secret_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": session_material.cookies,
            "profile": {
                "username": identity.username,
                "fan_id": identity.fan_id,
                "display_name": identity.display_name,
                "image_url": identity.image_url,
            },
        },
    )
    upsert_connection(
        user_id=int(user["id"]),
        session_secret_ref=secret_ref,
        session_fingerprint=fingerprint_secret({"cookies": session_material.cookies}),
        connection_method=body.connection_method,
        username=identity.username,
        fan_id=identity.fan_id,
        display_name=identity.display_name,
        image_url=identity.image_url,
    )
    return _connection_status(int(user["id"]))


@router.post(
    "/me/connect/cookie",
    response_model=BandcampConnectionStatusResponse,
    responses=_RESPONSES,
    summary="Connect Bandcamp using a manually supplied session cookie",
)
def api_bandcamp_connect_cookie(request: Request, body: BandcampCookieConnectRequest):
    user = _require_auth(request)
    if body.connection_method not in {
        "manual_cookie",
        "native_desktop",
        "native_mobile",
    }:
        raise HTTPException(
            status_code=400, detail="Unsupported cookie connection method"
        )

    cookies = _parse_bandcamp_cookie_input(body.cookie)
    if not cookies.get("identity"):
        raise HTTPException(
            status_code=400, detail="Bandcamp identity cookie is required"
        )
    session_material = BandcampSessionMaterial(
        cookies=cookies,
        raw={"source": body.connection_method},
    )

    try:
        identity = BandcampWebClient(session_material, timeout=10.0).validate_session()
    except BandcampWebError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    secret_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": session_material.cookies,
            "profile": {
                "username": identity.username,
                "fan_id": identity.fan_id,
                "display_name": identity.display_name,
                "image_url": identity.image_url,
            },
        },
    )
    upsert_connection(
        user_id=int(user["id"]),
        session_secret_ref=secret_ref,
        session_fingerprint=fingerprint_secret({"cookies": session_material.cookies}),
        connection_method=body.connection_method,
        username=identity.username,
        fan_id=identity.fan_id,
        display_name=identity.display_name,
        image_url=identity.image_url,
    )
    return _connection_status(int(user["id"]))


def _parse_bandcamp_cookie_input(raw_cookie: str) -> dict[str, str]:
    value = raw_cookie.strip()
    if value.lower().startswith("cookie:"):
        value = value.split(":", 1)[1].strip()
    if "=" not in value and ";" not in value:
        return {"identity": value}

    cookies: dict[str, str] = {}
    for part in value.split(";"):
        name, separator, cookie_value = part.strip().partition("=")
        if separator and name.strip() and cookie_value.strip():
            cookies[name.strip()] = cookie_value.strip()
    return cookies


@router.post(
    "/me/disconnect",
    response_model=BandcampConnectionStatusResponse,
    responses=_RESPONSES,
    summary="Disconnect the current user's Bandcamp account",
)
def api_bandcamp_disconnect(request: Request):
    user = _require_auth(request)
    disconnect_connection(int(user["id"]))
    return _connection_status(int(user["id"]))


@router.post(
    "/me/sync",
    response_model=BandcampTaskResponse,
    responses=_RESPONSES,
    summary="Queue Bandcamp collection sync for the current user",
)
def api_bandcamp_sync(request: Request):
    user = _require_auth(request)
    connection = get_connection_for_user(int(user["id"]))
    if not connection or connection.get("status") != "connected":
        raise HTTPException(status_code=400, detail="Bandcamp is not connected")
    task_id = create_task(
        "bandcamp_sync_collection",
        {
            "user_id": int(user["id"]),
            "connection_id": connection["id"],
            "include": ["collection", "wishlist", "following"],
        },
    )
    return BandcampTaskResponse(task_id=task_id)


@router.post(
    "/me/imports",
    response_model=BandcampTaskResponse,
    responses=_RESPONSES,
    summary="Queue import for one owned Bandcamp item",
)
def api_bandcamp_import(request: Request, body: BandcampImportRequest):
    user = _require_auth(request)
    user_id = int(user["id"])
    item = get_user_owned_bandcamp_item(
        user_id=user_id,
        bandcamp_item_id=body.bandcamp_item_id,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Owned Bandcamp item not found")
    if not item.get("owned") or not item.get("downloadable"):
        raise HTTPException(status_code=400, detail="Bandcamp item is not downloadable")

    requested_format = body.format.strip().lower() or "flac"
    if requested_format not in {"flac", "alac", "mp3-v0", "mp3-320", "aac"}:
        raise HTTPException(
            status_code=400, detail="Unsupported Bandcamp import format"
        )

    import_row = create_bandcamp_import(
        user_id=user_id,
        connection_id=int(item["connection_id"]),
        bandcamp_item_id=int(item["id"]),
        requested_format=requested_format,
    )
    task_id = create_task(
        "bandcamp_import_purchase",
        {
            "user_id": user_id,
            "connection_id": int(item["connection_id"]),
            "bandcamp_import_id": int(import_row["id"]),
            "bandcamp_item_id": int(item["id"]),
            "format": requested_format,
            "force": body.force,
        },
    )
    set_bandcamp_import_task(int(import_row["id"]), task_id)
    return BandcampTaskResponse(
        task_id=task_id,
        import_id=int(import_row["id"]),
    )


@router.get(
    "/me/imports",
    response_model=BandcampImportResponse,
    responses=_RESPONSES,
    summary="List current user's Bandcamp import requests",
)
def api_bandcamp_imports(request: Request):
    user = _require_auth(request)
    imports = list_bandcamp_imports(int(user["id"]))
    return BandcampImportResponse(imports=imports, total=len(imports))


@router.get(
    "/me/imports/{import_id}",
    response_model=dict,
    responses=_RESPONSES,
    summary="Get one Bandcamp import request",
)
def api_bandcamp_import_detail(request: Request, import_id: int):
    user = _require_auth(request)
    import_row = get_bandcamp_import(import_id, user_id=int(user["id"]))
    if not import_row:
        raise HTTPException(status_code=404, detail="Bandcamp import not found")
    return import_row


@router.get(
    "/me/contributions",
    response_model=BandcampContributionResponse,
    responses=_RESPONSES,
    summary="List current user's active Bandcamp library contributions",
)
def api_bandcamp_contributions(request: Request):
    user = _require_auth(request)
    items = list_user_album_contributions(int(user["id"]), source="bandcamp")
    return BandcampContributionResponse(items=items, total=len(items))


@router.get(
    "/me/contributions/{contribution_id}/export",
    responses=_RESPONSES,
    summary="Download a portable package for one Bandcamp contribution",
)
def api_bandcamp_export_contribution(request: Request, contribution_id: int):
    user = _require_auth(request)
    contribution = get_user_album_contribution(
        user_id=int(user["id"]),
        contribution_id=contribution_id,
        source="bandcamp",
    )
    if not contribution or contribution.get("status") != "active":
        raise HTTPException(status_code=404, detail="Bandcamp contribution not found")
    if not contribution.get("album_id"):
        raise HTTPException(
            status_code=404, detail="Bandcamp contribution is not linked to an album"
        )

    from crate.api.browse_album import api_download_album_by_id

    return api_download_album_by_id(request, int(contribution["album_id"]))


@router.post(
    "/me/contributions/{contribution_id}/withdraw",
    response_model=BandcampTaskResponse,
    responses=_RESPONSES,
    summary="Withdraw one Bandcamp contribution from the Crate library",
)
def api_bandcamp_withdraw_contribution(request: Request, contribution_id: int):
    user = _require_auth(request)
    contribution = get_user_album_contribution(
        user_id=int(user["id"]),
        contribution_id=contribution_id,
        source="bandcamp",
    )
    if not contribution or contribution.get("status") != "active":
        raise HTTPException(status_code=404, detail="Bandcamp contribution not found")
    task_id = create_task(
        "library_withdraw_contribution",
        {"user_id": int(user["id"]), "contribution_id": contribution_id},
    )
    return BandcampTaskResponse(task_id=task_id)


@router.get(
    "/me/radar",
    response_model=BandcampRadarResponse,
    responses=_RESPONSES,
    summary="List current user's Bandcamp Radar candidates",
)
def api_bandcamp_radar(request: Request):
    user = _require_auth(request)
    items = list_bandcamp_radar_items(int(user["id"]))
    return BandcampRadarResponse(items=items, total=len(items))


@router.post(
    "/me/radar/refresh",
    response_model=BandcampTaskResponse,
    responses=_RESPONSES,
    summary="Refresh current user's Bandcamp Radar candidates",
)
def api_bandcamp_radar_refresh(request: Request):
    user = _require_auth(request)
    user_id = int(user["id"])
    if not has_active_connection(user_id):
        raise HTTPException(status_code=400, detail="Bandcamp is not connected")
    task_id = create_task("bandcamp_radar_refresh", {"user_id": user_id})
    return BandcampTaskResponse(task_id=task_id)


@router.post(
    "/me/radar/{radar_id}/dismiss",
    response_model=dict,
    responses=_RESPONSES,
    summary="Dismiss a Bandcamp Radar candidate",
)
def api_bandcamp_radar_dismiss(request: Request, radar_id: int):
    user = _require_auth(request)
    row = update_bandcamp_radar_status(
        user_id=int(user["id"]),
        radar_id=radar_id,
        status="dismissed",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bandcamp Radar item not found")
    return row


@router.post(
    "/me/radar/{radar_id}/save",
    response_model=dict,
    responses=_RESPONSES,
    summary="Save a Bandcamp Radar candidate for later",
)
def api_bandcamp_radar_save(request: Request, radar_id: int):
    user = _require_auth(request)
    row = update_bandcamp_radar_status(
        user_id=int(user["id"]),
        radar_id=radar_id,
        status="saved",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bandcamp Radar item not found")
    return row


@router.get(
    "/links/artist/by-entity/{artist_entity_uid}",
    response_model=dict,
    responses=_RESPONSES,
    summary="Get confirmed Bandcamp link state for one artist entity",
)
def api_bandcamp_artist_link(request: Request, artist_entity_uid: str):
    user = _require_auth(request)
    link = get_bandcamp_link_for_entity(
        entity_type="artist",
        entity_uid=artist_entity_uid,
        user_id=int(user["id"]),
    )
    return link or {"entity_type": "artist", "entity_uid": artist_entity_uid}


@router.get(
    "/links/album/by-entity/{album_entity_uid}",
    response_model=dict,
    responses=_RESPONSES,
    summary="Get confirmed Bandcamp link state for one album entity",
)
def api_bandcamp_album_link(request: Request, album_entity_uid: str):
    user = _require_auth(request)
    link = get_bandcamp_link_for_entity(
        entity_type="album",
        entity_uid=album_entity_uid,
        user_id=int(user["id"]),
    )
    return link or {"entity_type": "album", "entity_uid": album_entity_uid}


@router.post(
    "/admin/matches",
    response_model=dict,
    responses=_RESPONSES,
    summary="Create or update a Bandcamp library match",
)
def api_admin_bandcamp_match(request: Request, body: dict):
    _require_bandcamp_manager(request)
    entity_type = str(body.get("entity_type") or "").strip()
    if entity_type not in {"artist", "album", "track"}:
        raise HTTPException(status_code=400, detail="Unsupported entity type")
    status = str(body.get("status") or "candidate").strip()
    if status not in {"candidate", "confirmed", "rejected"}:
        raise HTTPException(status_code=400, detail="Unsupported match status")
    try:
        bandcamp_item_id = int(body["bandcamp_item_id"])
        confidence = float(body.get("confidence") or 0)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="Invalid Bandcamp match payload"
        ) from exc
    entity_uid = str(body.get("entity_uid") or "").strip()
    if not entity_uid:
        raise HTTPException(status_code=400, detail="entity_uid is required")
    return upsert_bandcamp_library_match(
        bandcamp_item_id=bandcamp_item_id,
        entity_type=entity_type,
        entity_uid=entity_uid,
        confidence=confidence,
        status=status,
        source=str(body.get("source") or "admin"),
        evidence=body.get("evidence") if isinstance(body.get("evidence"), dict) else {},
    )


@router.get(
    "/admin/matches",
    response_model=dict,
    responses=_RESPONSES,
    summary="List Bandcamp library matches",
)
def api_admin_bandcamp_matches(
    request: Request,
    status: str = "",
    limit: int = 100,
):
    _require_bandcamp_manager(request)
    normalized_status = status.strip()
    if normalized_status and normalized_status not in {
        "candidate",
        "confirmed",
        "rejected",
    }:
        raise HTTPException(status_code=400, detail="Unsupported match status")
    items = list_bandcamp_library_matches(
        status=normalized_status,
        limit=max(1, min(limit, 250)),
    )
    return {"items": items, "total": len(items)}


@router.post(
    "/admin/matches/{match_id}/confirm",
    response_model=dict,
    responses=_RESPONSES,
    summary="Confirm a Bandcamp library match",
)
def api_admin_bandcamp_match_confirm(request: Request, match_id: int):
    _require_bandcamp_manager(request)
    match = set_bandcamp_library_match_status(match_id, status="confirmed")
    if not match:
        raise HTTPException(status_code=404, detail="Bandcamp match not found")
    return match


@router.post(
    "/admin/matches/{match_id}/reject",
    response_model=dict,
    responses=_RESPONSES,
    summary="Reject a Bandcamp library match",
)
def api_admin_bandcamp_match_reject(request: Request, match_id: int):
    _require_bandcamp_manager(request)
    match = set_bandcamp_library_match_status(match_id, status="rejected")
    if not match:
        raise HTTPException(status_code=404, detail="Bandcamp match not found")
    return match


@router.get(
    "/admin/match-candidates",
    response_model=dict,
    responses=_RESPONSES,
    summary="Find Bandcamp match candidates by normalized names",
)
def api_admin_bandcamp_match_candidates(
    request: Request,
    entity_type: str,
    artist_name: str,
    album_title: str = "",
):
    _require_bandcamp_manager(request)
    if entity_type not in {"artist", "album", "track"}:
        raise HTTPException(status_code=400, detail="Unsupported entity type")
    items = list_bandcamp_match_candidates_for_name(
        entity_type=entity_type,
        artist_name=artist_name,
        album_title=album_title,
    )
    return {"items": items, "total": len(items)}


@router.get(
    "/admin/collection",
    response_model=BandcampCollectionResponse,
    responses=_RESPONSES,
    summary="List synced Bandcamp collection items across users",
)
def api_admin_bandcamp_collection(
    request: Request,
    relation_type: str = "",
    limit: int = 200,
):
    _require_bandcamp_manager(request)
    if relation_type and relation_type not in {"collection", "wishlist", "following"}:
        raise HTTPException(status_code=400, detail="Unsupported Bandcamp relation")
    capped_limit = max(1, min(limit, 500))
    items = list_admin_user_collections(relation_type, limit=capped_limit)
    return BandcampCollectionResponse(items=items, total=len(items))


@router.post(
    "/admin/backfill-urls",
    response_model=BandcampTaskResponse,
    responses=_RESPONSES,
    summary="Backfill Bandcamp URLs for local artists and albums",
)
def api_admin_bandcamp_backfill_urls(
    request: Request,
    limit: int = 100,
    public_search: bool = True,
):
    _require_bandcamp_manager(request)
    task_id = create_task(
        "bandcamp_backfill_entity_urls",
        {
            "limit": max(1, min(limit, 5000)),
            "public_search": public_search,
            "artists": True,
            "albums": True,
        },
    )
    return BandcampTaskResponse(task_id=task_id, status="queued")


@router.get(
    "/me/collection",
    response_model=BandcampCollectionResponse,
    responses=_RESPONSES,
    summary="List current user's synced Bandcamp collection",
)
def api_bandcamp_collection(request: Request):
    user = _require_auth(request)
    items = list_user_collection(int(user["id"]), "collection")
    return BandcampCollectionResponse(items=items, total=len(items))


@router.get(
    "/me/wishlist",
    response_model=BandcampCollectionResponse,
    responses=_RESPONSES,
    summary="List current user's synced Bandcamp wishlist",
)
def api_bandcamp_wishlist(request: Request):
    user = _require_auth(request)
    items = list_user_collection(int(user["id"]), "wishlist")
    return BandcampCollectionResponse(items=items, total=len(items))


@router.get(
    "/me/following",
    response_model=BandcampCollectionResponse,
    responses=_RESPONSES,
    summary="List current user's synced Bandcamp follows",
)
def api_bandcamp_following(request: Request):
    user = _require_auth(request)
    items = list_user_collection(int(user["id"]), "following")
    return BandcampCollectionResponse(items=items, total=len(items))
