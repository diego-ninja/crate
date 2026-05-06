"""Canonical snapshot-backed admin operational surface."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.api.schemas.operations import AdminOpsSnapshotResponse
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.snapshot_events import snapshot_channel

router = APIRouter(tags=["admin"])


@router.get(
    "/api/admin/ops-snapshot",
    response_model=AdminOpsSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin operational snapshot",
)
def api_admin_ops_snapshot(request: Request, fresh: bool = False):
    _require_admin(request)
    return get_cached_ops_snapshot(fresh=fresh)


async def _ops_stream() -> asyncio.AsyncIterator[str]:
    yield f"data: {json_dumps(get_cached_ops_snapshot())}\n\n"
    pubsub = None
    channel = snapshot_channel("ops", "dashboard")
    try:
        pubsub = await open_pubsub(channel)
        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(get_cached_ops_snapshot())}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_ops_snapshot())}\n\n"
            await asyncio.sleep(15)
    finally:
        if pubsub is not None:
            await close_pubsub(pubsub, channel)


@router.get(
    "/api/admin/ops-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin operational snapshot updates",
)
async def api_admin_ops_stream(request: Request):
    _require_admin(request)
    return StreamingResponse(
        _ops_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
