from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder

from crate.api.auth import COOKIE_NAME, COOKIE_NAME_LISTEN, _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.redis_sse import close_pubsub, get_async_redis, open_pubsub
from crate.api.schemas.jam import (
    JamInviteCreateRequest,
    JamInviteJoinRequest,
    JamInviteResponse,
    JamJoinResponse,
    JamRoomCreateRequest,
    JamRoomDeleteResponse,
    JamRoomListResponse,
    JamRoomResponse,
    JamRoomUpdateRequest,
)
from crate.auth import verify_jwt
from crate.db.repositories.auth import get_session
from crate.db.jam import (
    append_jam_room_event,
    consume_jam_room_invite,
    create_jam_room,
    create_jam_room_invite,
    delete_jam_room,
    get_jam_room,
    get_jam_room_member,
    get_jam_room_members,
    is_jam_room_member,
    list_jam_room_events,
    list_jam_rooms_for_user,
    reactivate_permanent_jam_room,
    touch_jam_room_member,
    update_jam_room_settings,
    update_jam_room_state,
    upsert_jam_room_member,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jam", tags=["jam"])

_JAM_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response("The current user cannot access or mutate this jam room."),
        404: error_response("The requested jam room or invite could not be found."),
        409: error_response("The jam room is no longer active."),
        422: error_response("The request payload failed validation."),
    },
)


def _json_payload(payload: dict) -> dict:
    return jsonable_encoder(payload)


class _JamPeer:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.distributed = False
        self._send_lock = asyncio.Lock()

    async def send_json(self, payload: dict) -> None:
        async with self._send_lock:
            await self.websocket.send_json(_json_payload(payload))

    async def send_text(self, payload: str) -> None:
        async with self._send_lock:
            await self.websocket.send_text(payload)

    async def close(self, *, code: int, reason: str = "") -> None:
        async with self._send_lock:
            await self.websocket.close(code=code, reason=reason)


class _LocalJamHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[_JamPeer]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, peer: _JamPeer) -> None:
        async with self._lock:
            self._rooms.setdefault(room_id, set()).add(peer)

    async def disconnect(self, room_id: str, peer: _JamPeer) -> None:
        async with self._lock:
            peers = self._rooms.get(room_id)
            if not peers:
                return
            peers.discard(peer)
            if not peers:
                self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: str, payload: dict, *, fallback_only: bool = False) -> None:
        async with self._lock:
            peers = list(self._rooms.get(room_id, set()))
        for peer in peers:
            if fallback_only and peer.distributed:
                continue
            try:
                await peer.send_json(payload)
            except Exception:
                await self.disconnect(room_id, peer)

    async def close_room(self, room_id: str, *, code: int = 4409, reason: str = "Room closed") -> None:
        async with self._lock:
            peers = list(self._rooms.pop(room_id, set()))
        for peer in peers:
            with contextlib.suppress(Exception):
                await peer.close(code=code, reason=reason)


_local_hub = _LocalJamHub()
_sync_clocks: dict[str, dict] = {}
_sync_clocks_lock = asyncio.Lock()
_local_heartbeat_owners: dict[str, str] = {}
_local_heartbeat_lock = asyncio.Lock()


def _room_channel(room_id: str) -> str:
    return f"crate:jam:room:{room_id}"


def _sync_clock_key(room_id: str) -> str:
    return f"crate:jam:sync:{room_id}"


_SYNC_HEARTBEAT_SECONDS = 2.0
_HEARTBEAT_LOCK_TTL_SECONDS = max(5, int(_SYNC_HEARTBEAT_SECONDS * 4))


async def _broadcast_to_room(room_id: str, payload: dict) -> None:
    """Publish to the distributed room bus, falling back to local peers."""
    try:
        redis = get_async_redis()
        await redis.publish(_room_channel(room_id), json.dumps(_json_payload(payload)))
        await _local_hub.broadcast(room_id, payload, fallback_only=True)
        return
    except Exception:
        log.exception("Failed to publish jam room event for room %s; using local fallback", room_id)
    await _local_hub.broadcast(room_id, payload)


async def _set_sync_clock(room_id: str, *, track: dict | None, position_ms: float, playing: bool) -> dict:
    """Store the authoritative playback clock for a room."""
    clock = _json_payload({
        "track": track,
        "position_ms": position_ms,
        "playing": playing,
        "clock_started_at": datetime.now(timezone.utc).timestamp(),
    })
    async with _sync_clocks_lock:
        _sync_clocks[room_id] = clock
    try:
        redis = get_async_redis()
        await redis.set(_sync_clock_key(room_id), json.dumps(clock))
    except Exception:
        log.exception("Failed to persist jam sync clock for room %s; using local fallback", room_id)
    return clock


async def _get_sync_clock(room_id: str) -> dict | None:
    """Read the current playback clock for a room."""
    try:
        redis = get_async_redis()
        raw = await redis.get(_sync_clock_key(room_id))
        if raw:
            clock = json.loads(raw)
            async with _sync_clocks_lock:
                _sync_clocks[room_id] = clock
            return clock
    except Exception:
        log.exception("Failed to read jam sync clock for room %s; using local fallback", room_id)
    async with _sync_clocks_lock:
        return _sync_clocks.get(room_id)


async def _clear_sync_clock(room_id: str) -> None:
    """Remove the playback clock (room paused/ended)."""
    async with _sync_clocks_lock:
        _sync_clocks.pop(room_id, None)
    try:
        redis = get_async_redis()
        await redis.delete(_sync_clock_key(room_id))
    except Exception:
        log.exception("Failed to clear jam sync clock for room %s", room_id)


async def _compute_expected_position(clock: dict) -> float:
    """Compute the expected playback position based on the clock."""
    if not clock.get("playing"):
        return clock["position_ms"]
    elapsed = (datetime.now(timezone.utc).timestamp() - clock["clock_started_at"]) * 1000
    return clock["position_ms"] + elapsed


def _serialize_room(room: dict, *, events_limit: int = 50) -> dict:
    return {
        **room,
        "members": get_jam_room_members(str(room["id"])),
        "events": list_jam_room_events(str(room["id"]), limit=events_limit),
    }


def _reactivate_permanent_room_if_needed(room: dict) -> dict:
    if room.get("status") == "active" or not room.get("is_permanent"):
        return room
    return reactivate_permanent_jam_room(str(room["id"])) or room


def _normalise_room_tags(tags: list[str] | None) -> list[str]:
    seen: set[str] = set()
    normalised: list[str] = []
    for raw in tags or []:
        tag = raw.strip().lower()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        normalised.append(tag[:40])
        if len(normalised) >= 12:
            break
    return normalised


def _normalise_room_description(description: str | None) -> str | None:
    if description is None:
        return None
    value = description.strip()
    return value[:500] if value else None


def _auth_ws(websocket: WebSocket) -> dict:
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        for cookie_name in (COOKIE_NAME_LISTEN, COOKIE_NAME):
            token = websocket.cookies.get(cookie_name)
            if token:
                break
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    session_id = payload.get("sid")
    if session_id:
        session = get_session(session_id)
        if not session or session.get("revoked_at") is not None:
            raise HTTPException(status_code=401, detail="Session expired")
    return payload


async def _acquire_heartbeat_lock(room_id: str, owner: str) -> bool:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        return bool(await redis.set(key, owner, nx=True, ex=_HEARTBEAT_LOCK_TTL_SECONDS))
    except Exception:
        log.exception("Failed to acquire Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        if room_id in _local_heartbeat_owners:
            return False
        _local_heartbeat_owners[room_id] = owner
        return True


async def _renew_heartbeat_lock(room_id: str, owner: str) -> bool:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        current_owner = await redis.get(key)
        if current_owner != owner:
            return False
        await redis.expire(key, _HEARTBEAT_LOCK_TTL_SECONDS)
        return True
    except Exception:
        log.exception("Failed to renew Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        return _local_heartbeat_owners.get(room_id) == owner


async def _release_heartbeat_lock(room_id: str, owner: str) -> None:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        current_owner = await redis.get(key)
        if current_owner == owner:
            await redis.delete(key)
    except Exception:
        log.exception("Failed to release Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        if _local_heartbeat_owners.get(room_id) == owner:
            _local_heartbeat_owners.pop(room_id, None)


@router.post(
    "/rooms",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Create a jam room",
)
def create_room(request: Request, body: JamRoomCreateRequest):
    user = _require_auth(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Room name is required")
    room = create_jam_room(
        user["id"],
        body.name.strip(),
        visibility=body.visibility,
        is_permanent=body.is_permanent,
        description=_normalise_room_description(body.description),
        tags=_normalise_room_tags(body.tags),
    )
    append_jam_room_event(str(room["id"]), "join", {"role": "host"}, user["id"])
    return _serialize_room(room)


@router.get(
    "/rooms",
    response_model=JamRoomListResponse,
    responses=_JAM_RESPONSES,
    summary="List active jam rooms visible to the current user",
)
def list_rooms(request: Request, q: str | None = Query(default=None, max_length=80)):
    user = _require_auth(request)
    rooms = list_jam_rooms_for_user(user["id"], limit=50, query=q)
    return {"rooms": [_serialize_room(room, events_limit=12) for room in rooms]}


@router.get(
    "/rooms/{room_id}",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Get jam room state",
)
async def get_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    member = get_jam_room_member(room_id, user["id"])
    if not member and room.get("visibility") == "public" and (room.get("status") == "active" or room.get("is_permanent")):
        room = _reactivate_permanent_room_if_needed(room)
        upsert_jam_room_member(room_id, user["id"], role="collab")
        event = append_jam_room_event(room_id, "join", {"role": "collab"}, user["id"])
        updated = get_jam_room(room_id) or room
        serialized = _serialize_room(updated)
        await _broadcast_to_room(
            room_id,
            {
                "type": "join",
                "event": event,
                "room": serialized,
                "members": serialized["members"],
            },
        )
        return serialized
    if not member:
        raise HTTPException(status_code=403, detail="Not a room member")
    room = _reactivate_permanent_room_if_needed(room)
    touch_jam_room_member(room_id, user["id"])
    return _serialize_room(room)


@router.patch(
    "/rooms/{room_id}",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Update jam room settings",
)
async def update_room(request: Request, room_id: str, body: JamRoomUpdateRequest):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can update this room")
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            raise HTTPException(status_code=409, detail="Room is no longer active")

    name = body.name.strip() if body.name is not None else None
    if body.name is not None and not name:
        raise HTTPException(status_code=422, detail="Room name is required")
    updated = update_jam_room_settings(
        room_id,
        name=name,
        visibility=body.visibility,
        is_permanent=body.is_permanent,
        description=_normalise_room_description(body.description) if "description" in body.model_fields_set else None,
        description_provided="description" in body.model_fields_set,
        tags=_normalise_room_tags(body.tags) if body.tags is not None else None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    event = append_jam_room_event(
        room_id,
        "room_updated",
        {
            "name": updated["name"],
            "visibility": updated.get("visibility", "private"),
            "is_permanent": bool(updated.get("is_permanent")),
            "description": updated.get("description"),
            "tags": updated.get("tags") or [],
        },
        user["id"],
    )
    serialized = _serialize_room(updated)
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_updated",
            "event": event,
            "room": serialized,
            "members": serialized["members"],
        },
    )
    return serialized


@router.post(
    "/rooms/{room_id}/join",
    response_model=JamJoinResponse,
    responses=_JAM_RESPONSES,
    summary="Join a public jam room",
)
async def join_public_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            raise HTTPException(status_code=409, detail="Room is no longer active")
    existing_member = get_jam_room_member(room_id, user["id"])
    if not existing_member and room.get("visibility") != "public":
        raise HTTPException(status_code=403, detail="This room is invite-only")

    event = None
    if existing_member:
        touch_jam_room_member(room_id, user["id"])
    else:
        upsert_jam_room_member(room_id, user["id"], role="collab")
        event = append_jam_room_event(room_id, "join", {"role": "collab"}, user["id"])
    updated = get_jam_room(room_id) or room
    serialized = _serialize_room(updated)
    if event:
        await _broadcast_to_room(
            room_id,
            {
                "type": "join",
                "event": event,
                "room": serialized,
                "members": serialized["members"],
            },
        )
    else:
        await _broadcast_to_room(
            room_id,
            {
                "type": "presence",
                "room_id": room_id,
                "members": serialized["members"],
            },
        )
    return {"ok": True, "room": serialized, "event": event}


@router.post(
    "/rooms/{room_id}/invites",
    response_model=JamInviteResponse,
    responses=_JAM_RESPONSES,
    summary="Create a jam room invite",
)
def create_room_invite(request: Request, room_id: str, body: JamInviteCreateRequest):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can create invites")
    if room.get("status") != "active":
        raise HTTPException(status_code=409, detail="Room is no longer active")
    invite = create_jam_room_invite(
        room_id,
        user["id"],
        expires_in_hours=body.expires_in_hours,
        max_uses=body.max_uses,
    )
    return {
        **invite,
        "join_url": f"/jam/invite/{invite['token']}",
        "qr_value": f"/jam/invite/{invite['token']}",
    }


@router.post(
    "/rooms/invites/{token}/join",
    response_model=JamJoinResponse,
    responses=_JAM_RESPONSES,
    summary="Join a jam room from an invite",
)
async def join_room_by_invite(request: Request, token: str, body: JamInviteJoinRequest):
    user = _require_auth(request)
    invite = consume_jam_room_invite(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    room = get_jam_room(str(invite["room_id"]))
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("status") != "active":
        raise HTTPException(status_code=409, detail="Room is no longer active")
    existing_member = get_jam_room_member(str(invite["room_id"]), user["id"])
    role = existing_member["role"] if existing_member else "collab"
    upsert_jam_room_member(str(invite["room_id"]), user["id"], role=role)
    event = append_jam_room_event(str(invite["room_id"]), "join", {"role": role}, user["id"])
    updated = get_jam_room(str(invite["room_id"])) or room
    serialized = _serialize_room(updated)
    await _broadcast_to_room(
        str(invite["room_id"]),
        {
            "type": "join",
            "event": event,
            "room": serialized,
            "members": serialized["members"],
        },
    )
    return {
        "ok": True,
        "room": serialized,
        "event": event,
    }


@router.post(
    "/rooms/{room_id}/end",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="End a jam room",
)
async def end_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can end this room")
    if room.get("status") == "ended":
        return _serialize_room(room)
    ended_at = datetime.now(timezone.utc).isoformat()
    updated = update_jam_room_state(room_id, status="ended", ended_at=ended_at)
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    event = append_jam_room_event(room_id, "room_ended", {"ended_at": ended_at}, user["id"])
    await _clear_sync_clock(room_id)
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_ended",
            "event": event,
            "room": _serialize_room(updated),
            "members": get_jam_room_members(room_id),
        },
    )
    await _local_hub.close_room(room_id, reason="Room ended")
    return _serialize_room(updated)


@router.delete(
    "/rooms/{room_id}",
    response_model=JamRoomDeleteResponse,
    responses=_JAM_RESPONSES,
    summary="Delete a jam room",
)
async def delete_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can delete this room")

    await _clear_sync_clock(room_id)
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_deleted",
            "room_id": room_id,
        },
    )
    if not delete_jam_room(room_id):
        raise HTTPException(status_code=404, detail="Room not found")
    await _local_hub.close_room(room_id, reason="Room deleted")
    return {"ok": True, "room_id": room_id}


@router.websocket("/rooms/{room_id}/ws")
async def jam_room_ws(websocket: WebSocket, room_id: str):
    try:
        payload = _auth_ws(websocket)
    except HTTPException:
        await websocket.close(code=4401)
        return

    user_id = int(payload["user_id"])
    room = get_jam_room(room_id)
    if not room or not is_jam_room_member(room_id, user_id):
        await websocket.close(code=4403)
        return
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            await websocket.close(code=4403)
            return
    if room.get("status") != "active":
        await websocket.close(code=4403)
        return
    member = get_jam_room_member(room_id, user_id)
    if not member:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    peer = _JamPeer(websocket)
    await _local_hub.connect(room_id, peer)

    pubsub = None
    try:
        pubsub = await open_pubsub(_room_channel(room_id))
        peer.distributed = True
    except Exception:
        log.exception("Failed to open Redis pubsub for room %s", room_id)
        await peer.send_json({
            "type": "warning",
            "detail": "Room sync is running in local fallback mode",
        })
    touch_jam_room_member(room_id, user_id)
    await peer.send_json({"type": "state_sync", "room": _serialize_room(room)})

    try:
        clock = await _get_sync_clock(room_id)
        if clock:
            expected_position = await _compute_expected_position(clock)
            await peer.send_json({
                "type": "sync_clock",
                "track": clock.get("track"),
                "position_ms": expected_position,
                "playing": clock.get("playing"),
            })
    except Exception:
        log.exception("Failed to send sync clock for room %s", room_id)

    await _broadcast_to_room(
        room_id,
        {
            "type": "presence",
            "room_id": room_id,
            "members": get_jam_room_members(room_id),
        },
    )

    heartbeat_task: asyncio.Task | None = None
    heartbeat_owner = secrets.token_urlsafe(16)

    async def _sync_heartbeat():
        while True:
            await asyncio.sleep(_SYNC_HEARTBEAT_SECONDS)
            if not await _renew_heartbeat_lock(room_id, heartbeat_owner):
                break
            clock = await _get_sync_clock(room_id)
            if not clock or not clock.get("playing"):
                continue
            expected_position = await _compute_expected_position(clock)
            await _broadcast_to_room(
                room_id,
                {
                    "type": "sync_clock",
                    "track": clock.get("track"),
                    "position_ms": expected_position,
                    "playing": clock.get("playing"),
                },
            )

    if await _acquire_heartbeat_lock(room_id, heartbeat_owner):
        heartbeat_task = asyncio.create_task(_sync_heartbeat())

    async def _redis_listener():
        if pubsub is None:
            return
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    data_str = message.get("data")
                    if data_str and isinstance(data_str, str):
                        try:
                            await peer.send_text(data_str)
                            payload = json.loads(data_str)
                            if payload.get("type") in {"room_ended", "room_deleted"}:
                                await peer.close(code=4409, reason="Room closed")
                                break
                        except Exception:
                            break
        except Exception:
            pass

    listener_task = asyncio.create_task(_redis_listener())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                await peer.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            event_type = data.get("type")
            if event_type == "ping":
                await peer.send_json({"type": "pong"})
                touch_jam_room_member(room_id, user_id)
                continue
            if event_type not in {"queue_add", "queue_remove", "queue_reorder", "play", "pause", "seek", "join", "presence"}:
                continue
            touch_jam_room_member(room_id, user_id)
            role = member.get("role")
            if event_type in {"play", "pause", "seek"} and role != "host":
                await peer.send_json({"type": "error", "detail": "Only the host can control playback"})
                continue
            if event_type in {"queue_add", "queue_remove", "queue_reorder"} and role not in {"host", "collab"}:
                await peer.send_json({"type": "error", "detail": "You cannot edit this queue"})
                continue

            if event_type in {"play", "pause", "seek"}:
                track = data.get("track")
                position_seconds = float(data.get("position", 0))
                position_ms = position_seconds * 1000
                playing = event_type == "play" or (event_type == "seek" and data.get("playing"))
                await _set_sync_clock(
                    room_id,
                    track=track,
                    position_ms=position_ms,
                    playing=playing,
                )
                state = {
                    "track": track,
                    "position": position_seconds,
                    "playing": playing,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                update_jam_room_state(room_id, current_track_payload=state)

            event = append_jam_room_event(room_id, event_type, data, user_id)
            await _broadcast_to_room(
                room_id,
                {
                    "type": event_type,
                    "event": event,
                    "members": get_jam_room_members(room_id),
                },
            )
    except WebSocketDisconnect:
        pass
    finally:
        listener_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await listener_task
        if heartbeat_task:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            await _release_heartbeat_lock(room_id, heartbeat_owner)
        if pubsub is not None:
            await close_pubsub(pubsub, _room_channel(room_id))
        await _local_hub.disconnect(room_id, peer)
        await _broadcast_to_room(
            room_id,
            {
                "type": "presence",
                "room_id": room_id,
                "members": get_jam_room_members(room_id),
            },
        )
