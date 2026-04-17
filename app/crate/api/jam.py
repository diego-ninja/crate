from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.jam import (
    JamInviteCreateRequest,
    JamInviteJoinRequest,
    JamInviteResponse,
    JamJoinResponse,
    JamRoomCreateRequest,
    JamRoomResponse,
)
from crate.auth import verify_jwt
from crate.db import (
    create_jam_room,
    get_jam_room,
    get_jam_room_members,
    get_jam_room_member,
    is_jam_room_member,
    upsert_jam_room_member,
    touch_jam_room_member,
    append_jam_room_event,
    list_jam_room_events,
    update_jam_room_state,
    create_jam_room_invite,
    consume_jam_room_invite,
    get_session,
)

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


class _JamHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._rooms[room_id].add(websocket)

    async def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                return
            room.discard(websocket)
            if not room:
                self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: str, payload: dict) -> None:
        async with self._lock:
            targets = list(self._rooms.get(room_id, set()))
        for websocket in targets:
            try:
                await websocket.send_json(payload)
            except Exception:
                await self.disconnect(room_id, websocket)

    async def close_room(self, room_id: str, *, code: int = 4409, reason: str = "Room closed") -> None:
        async with self._lock:
            targets = list(self._rooms.pop(room_id, set()))
        for websocket in targets:
            try:
                await websocket.close(code=code, reason=reason)
            except Exception:
                pass


_hub = _JamHub()


def _serialize_room(room: dict) -> dict:
    return {
        **room,
        "members": get_jam_room_members(str(room["id"])),
        "events": list_jam_room_events(str(room["id"]), limit=50),
    }


def _auth_ws(websocket: WebSocket) -> dict:
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        token = websocket.cookies.get("crate_session")
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
    room = create_jam_room(user["id"], body.name.strip())
    append_jam_room_event(str(room["id"]), "join", {"role": "host"}, user["id"])
    return _serialize_room(room)


@router.get(
    "/rooms/{room_id}",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Get jam room state",
)
def get_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not is_jam_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a room member")
    touch_jam_room_member(room_id, user["id"])
    return _serialize_room(room)


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
def join_room_by_invite(request: Request, token: str, body: JamInviteJoinRequest):
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
    return {
        "ok": True,
        "room": _serialize_room(room),
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
    await _hub.broadcast(
        room_id,
        {
            "type": "room_ended",
            "event": event,
            "room": _serialize_room(updated),
            "members": get_jam_room_members(room_id),
        },
    )
    await _hub.close_room(room_id, reason="Room ended")
    return _serialize_room(updated)


@router.websocket("/rooms/{room_id}/ws")
async def jam_room_ws(websocket: WebSocket, room_id: str):
    try:
        payload = _auth_ws(websocket)
    except HTTPException:
        await websocket.close(code=4401)
        return

    user_id = int(payload["user_id"])
    room = get_jam_room(room_id)
    if not room or room.get("status") != "active" or not is_jam_room_member(room_id, user_id):
        await websocket.close(code=4403)
        return
    member = get_jam_room_member(room_id, user_id)
    if not member:
        await websocket.close(code=4403)
        return

    await _hub.connect(room_id, websocket)
    touch_jam_room_member(room_id, user_id)
    await websocket.send_json({"type": "state_sync", "room": _serialize_room(room)})
    await _hub.broadcast(
        room_id,
        {
            "type": "presence",
            "room_id": room_id,
            "members": get_jam_room_members(room_id),
        },
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                await websocket.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            event_type = data.get("type")
            # Heartbeat: respond immediately, don't process as event
            if event_type == "ping":
                await websocket.send_json({"type": "pong"})
                touch_jam_room_member(room_id, user_id)
                continue
            if event_type not in {"queue_add", "queue_remove", "queue_reorder", "play", "pause", "seek", "join", "presence"}:
                continue
            touch_jam_room_member(room_id, user_id)
            role = member.get("role")
            if event_type in {"play", "pause", "seek"} and role != "host":
                await websocket.send_json({"type": "error", "detail": "Only the host can control playback"})
                continue
            if event_type in {"queue_add", "queue_remove", "queue_reorder"} and role not in {"host", "collab"}:
                await websocket.send_json({"type": "error", "detail": "You cannot edit this queue"})
                continue
            if event_type in {"play", "pause", "seek"}:
                state = {
                    "track": data.get("track"),
                    "position": data.get("position"),
                    "playing": data.get("playing"),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                update_jam_room_state(room_id, current_track_payload=state)
            event = append_jam_room_event(room_id, event_type, data, user_id)
            await _hub.broadcast(
                room_id,
                {
                    "type": event_type,
                    "event": event,
                    "members": get_jam_room_members(room_id),
                },
            )
    except WebSocketDisconnect:
        await _hub.disconnect(room_id, websocket)
        await _hub.broadcast(
            room_id,
            {
                "type": "presence",
                "room_id": room_id,
                "members": get_jam_room_members(room_id),
            },
        )
