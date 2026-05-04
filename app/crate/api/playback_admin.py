from __future__ import annotations

from fastapi import APIRouter, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.media import AdminPlaybackDeliveryResponse
from crate.config import load_config
from crate.db.queries.streaming_admin import get_playback_delivery_snapshot
from crate.worker_handlers.playback import get_stream_transcode_runtime

router = APIRouter(tags=["admin"])


@router.get(
    "/api/admin/playback-delivery",
    response_model=AdminPlaybackDeliveryResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get playback delivery and transcode cache status",
)
def api_admin_playback_delivery(request: Request, limit: int = 20):
    _require_admin(request)
    payload = get_playback_delivery_snapshot(limit=limit)
    payload["runtime"] = get_stream_transcode_runtime(load_config())
    return payload
