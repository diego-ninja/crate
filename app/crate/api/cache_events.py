"""SSE endpoint for client-side cache invalidation.

Backend broadcasts invalidation scopes after mutations.
Connected clients receive events and drop cached data for that scope.

Invalidation also fires automatically via middleware for known mutation routes.
"""

import asyncio
import logging
import re
from collections import deque
from time import time

from fastapi import APIRouter, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import StreamingResponse

from crate.api.auth import _require_auth

log = logging.getLogger(__name__)
router = APIRouter()

# In-memory event bus — lightweight, no Redis needed.
_events: deque[tuple[float, str]] = deque(maxlen=200)
_event_id = 0


def broadcast_invalidation(*scopes: str):
    """Broadcast one or more cache invalidation scopes."""
    global _event_id
    for scope in scopes:
        _event_id += 1
        _events.append((time(), scope))
        log.debug("cache invalidation: %s (event %d)", scope, _event_id)


async def _invalidation_stream(last_seen: float):
    """Yield SSE events for cache invalidation."""
    for ts, scope in _events:
        if ts > last_seen:
            yield f"data: {scope}\n\n"

    while True:
        await asyncio.sleep(1)
        for ts, scope in _events:
            if ts > last_seen:
                yield f"data: {scope}\n\n"
                last_seen = ts


@router.get("/api/cache/events")
async def cache_events(request: Request):
    """SSE stream of cache invalidation events."""
    _require_auth(request)
    return StreamingResponse(
        _invalidation_stream(time()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/cache/invalidate")
async def cache_invalidate_endpoint(request: Request):
    """Internal endpoint for worker processes to broadcast invalidation.
    Only accepts requests from Docker network peers (trusted proxy check)."""
    client_ip = request.client.host if request.client else ""
    if not (client_ip.startswith("172.") or client_ip.startswith("10.") or client_ip == "127.0.0.1"):
        return Response(status_code=403)
    body = await request.json()
    scopes = body.get("scopes", [])
    if scopes:
        broadcast_invalidation(*scopes)
    return {"ok": True, "scopes": scopes}


# ── Auto-invalidation middleware ────────────────────────────────

# Map mutation routes to cache scopes they invalidate.
# Pattern → scopes (may include {id} placeholder replaced from URL).
_INVALIDATION_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    # Likes
    (re.compile(r"^/api/me/likes$"), ["likes"]),
    # Follows
    (re.compile(r"^/api/me/follows"), ["follows"]),
    # Saved albums
    (re.compile(r"^/api/me/albums(?:/(\d+))?$"), ["saved_albums"]),
    # Play history
    (re.compile(r"^/api/me/history$"), ["history"]),
    (re.compile(r"^/api/me/play-events$"), ["history"]),
    # Playlists
    (re.compile(r"^/api/playlists$"), ["playlists"]),
    (re.compile(r"^/api/playlists/(\d+)"), ["playlists", "playlist:{1}"]),
    # Curation
    (re.compile(r"^/api/curation"), ["curation"]),
    # Library mutations (tags, artwork, enrichment, scanner, matcher)
    (re.compile(r"^/api/artists/(\d+)/enrich"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/albums/(\d+)/cover"), ["library", "album:{1}"]),
    (re.compile(r"^/api/tags"), ["library"]),
    (re.compile(r"^/api/scan"), ["library"]),
    (re.compile(r"^/api/import"), ["library"]),
    # Internal: worker cache invalidation
    (re.compile(r"^/api/cache/invalidate$"), []),
]


class CacheInvalidationMiddleware(BaseHTTPMiddleware):
    """After successful mutations (POST/PUT/DELETE), broadcast cache invalidation."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        if request.method in ("POST", "PUT", "DELETE") and 200 <= response.status_code < 300:
            path = request.url.path
            for pattern, scope_templates in _INVALIDATION_RULES:
                m = pattern.match(path)
                if m:
                    scopes = []
                    for tmpl in scope_templates:
                        scope = tmpl
                        for i, group in enumerate(m.groups(), 1):
                            if group:
                                scope = scope.replace(f"{{{i}}}", group)
                        # Only emit if all placeholders resolved
                        if "{" not in scope:
                            scopes.append(scope)
                    if scopes:
                        broadcast_invalidation(*scopes)
                    break

        return response
