"""SSE endpoint for client-side cache invalidation.

Backend broadcasts invalidation scopes after mutations. Connected
clients receive events and drop cached data for the affected scope.

Architecture:
  - Event bus lives in Redis (shared across all Uvicorn workers)
  - Events carry sequential IDs so reconnecting clients can replay
    anything they missed (via the standard Last-Event-ID SSE header)
  - Backend L1/L2/L3 cache is ALSO cleared on broadcast, preventing
    stale responses when clients refetch after invalidation
  - A 30 s heartbeat keeps proxies from dropping idle connections
"""

import asyncio
import json
import logging
import os
import re
from time import time

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.utility import CacheInvalidationRequest, CacheInvalidationResponse

log = logging.getLogger(__name__)
router = APIRouter(tags=["events"])

_CACHE_EVENT_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Server-sent events stream of cache invalidations.",
            "content": {
                "text/event-stream": {
                    "schema": {
                        "type": "string",
                        "example": "id: 42\ndata: home\n\nid: 43\ndata: playlist:42\n\n",
                    }
                }
            },
        },
    },
)

_CACHE_INVALIDATION_RESPONSES = {
    403: error_response("Only trusted internal peers may broadcast cache invalidations."),
    422: error_response("The request payload failed validation."),
}

# ── Redis-backed event bus ──────────────────────────────────────────
#
# Every event is a JSON blob stored in a Redis list (newest first).
# The list is capped at 500 entries. Each event carries a monotonic
# integer ID so SSE clients can resume from their last-seen position.

_EVENTS_KEY = "cache:invalidation:events"
_EVENT_ID_KEY = "cache:invalidation:next_id"
_MAX_EVENTS = 500

_redis = None

_PROJECTOR_RELEVANT_INVALIDATION_SCOPES = frozenset(
    {
        "library",
        "shows",
        "upcoming",
        "curation",
        "playlists",
    }
)


def _get_redis():
    global _redis
    if _redis is None:
        import redis as _redis_lib
        url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        _redis = _redis_lib.from_url(url, decode_responses=True)
    return _redis


def _should_append_invalidation_domain_event(scope: str) -> bool:
    return (
        scope.startswith("home:user:")
        or scope.startswith(("artist:", "album:", "playlist:"))
        or scope in _PROJECTOR_RELEVANT_INVALIDATION_SCOPES
    )


def broadcast_invalidation(*scopes: str):
    """Broadcast cache invalidation in a background thread.

    Non-blocking: the HTTP response returns immediately. Redis writes
    and backend cache clearing happen asynchronously. Failures are
    logged but never propagate.
    """
    import threading
    threading.Thread(
        target=_do_broadcast, args=(scopes,), daemon=True
    ).start()


def _do_broadcast(scopes: tuple[str, ...] | list[str]):
    try:
        r = _get_redis()
        from crate.db.domain_events import append_domain_event
        for scope in scopes:
            event_id = r.incr(_EVENT_ID_KEY)
            event = json.dumps({"id": event_id, "scope": scope, "ts": time()})
            r.lpush(_EVENTS_KEY, event)
            r.ltrim(_EVENTS_KEY, 0, _MAX_EVENTS - 1)
            if _should_append_invalidation_domain_event(scope):
                append_domain_event(
                    "ui.invalidate",
                    {"scope": scope, "redis_event_id": event_id},
                    scope="ui.invalidate",
                    subject_key=scope,
                )
            log.debug("cache invalidation: %s (event %d)", scope, event_id)
    except Exception as exc:
        log.warning("Failed to broadcast cache invalidation for %s: %s", scopes, exc)

    _clear_backend_cache_for_scopes(scopes)


def _clear_backend_cache_for_scopes(scopes: tuple[str, ...] | list[str]):
    """Clear backend cache entries that correspond to the invalidated scopes."""
    from crate.db.cache_store import delete_cache_prefix
    from crate.db.ui_snapshot_store import mark_ui_snapshots_stale

    # Mapping from scope → backend cache key prefixes to clear.
    # Not every scope has a backend cache (many are frontend-only).
    _SCOPE_CACHE_PREFIXES = {
        "home": ["home:", "home_playlist:", "home_section:"],
        "follows": [],
        "likes": [],
        "saved_albums": [],
        "history": ["stats:"],
        "library": ["discover:"],
        "shows": ["shows:"],
        "upcoming": ["upcoming:"],
        "playlists": ["playlist:"],
        "curation": ["curation:"],
    }

    prefixes_to_clear = set()
    for scope in scopes:
        # Direct scope match
        if scope in _SCOPE_CACHE_PREFIXES:
            prefixes_to_clear.update(_SCOPE_CACHE_PREFIXES[scope])
        # Parameterised scopes like "playlist:42" → clear "playlist:42"
        if ":" in scope:
            prefixes_to_clear.add(scope)

    for prefix in prefixes_to_clear:
        try:
            delete_cache_prefix(prefix)
        except Exception:
            log.debug("Failed to clear backend cache prefix: %s", prefix, exc_info=True)

    try:
        if any(
            scope in {"home", "follows", "likes", "saved_albums", "history", "library", "curation", "playlists", "shows", "upcoming"}
            or scope.startswith(("artist:", "album:", "playlist:"))
            for scope in scopes
        ):
            mark_ui_snapshots_stale(scope_prefix="home:")
        if any(
            scope in {"library", "shows", "upcoming", "curation", "playlists"}
            or scope.startswith(("artist:", "album:", "playlist:"))
            for scope in scopes
        ):
            mark_ui_snapshots_stale(scope="ops", subject_key="dashboard")
    except Exception:
        log.debug("Failed to mark ui snapshots stale for scopes: %s", scopes, exc_info=True)


def get_invalidation_events_since(last_id: int) -> list[dict]:
    """Fetch all events with id > last_id from Redis (oldest first)."""
    r = _get_redis()
    raw_events = r.lrange(_EVENTS_KEY, 0, -1)  # newest first
    events = []
    for raw in reversed(raw_events):  # oldest first
        try:
            event = json.loads(raw)
            if event.get("id", 0) > last_id:
                events.append(event)
        except (json.JSONDecodeError, TypeError):
            continue
    return events


def get_latest_invalidation_event_id() -> int:
    """Get the current highest event ID (for new connections)."""
    r = _get_redis()
    val = r.get(_EVENT_ID_KEY)
    return int(val) if val else 0


# ── SSE stream ──────────────────────────────────────────────────────

_HEARTBEAT_INTERVAL = 30  # seconds


async def _invalidation_stream(last_event_id: int):
    """Yield SSE events for cache invalidation.

    Replays any events missed since ``last_event_id`` (from the
    ``Last-Event-ID`` header on reconnect), then polls Redis for
    new events every second. Sends a keep-alive comment every 30 s
    to prevent proxy timeouts.
    """
    # Replay missed events
    missed = get_invalidation_events_since(last_event_id)
    for event in missed:
        last_event_id = event["id"]
        yield f"id: {event['id']}\ndata: {event['scope']}\n\n"

    heartbeat_counter = 0
    while True:
        await asyncio.sleep(1)
        heartbeat_counter += 1

        # Check for new events
        new_events = get_invalidation_events_since(last_event_id)
        for event in new_events:
            last_event_id = event["id"]
            yield f"id: {event['id']}\ndata: {event['scope']}\n\n"

        # Heartbeat to keep connection alive across proxies
        if heartbeat_counter >= _HEARTBEAT_INTERVAL:
            heartbeat_counter = 0
            yield ": heartbeat\n\n"


@router.get(
    "/api/cache/events",
    responses=_CACHE_EVENT_RESPONSES,
    summary="Stream cache invalidation events",
)
async def cache_events(request: Request):
    """SSE stream of cache invalidation events.

    On reconnect, the browser sends ``Last-Event-ID`` automatically.
    The server replays any events the client missed during downtime.
    """
    _require_auth(request)

    # Last-Event-ID is sent by the browser on SSE reconnect
    last_event_id_str = request.headers.get("Last-Event-ID", "0")
    try:
        last_event_id = int(last_event_id_str)
    except (ValueError, TypeError):
        last_event_id = get_latest_invalidation_event_id()

    return StreamingResponse(
        _invalidation_stream(last_event_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/api/cache/invalidate",
    response_model=CacheInvalidationResponse,
    responses=_CACHE_INVALIDATION_RESPONSES,
    summary="Broadcast cache invalidation scopes from a trusted worker",
)
async def cache_invalidate_endpoint(request: Request, body: CacheInvalidationRequest):
    """Internal endpoint for worker processes to broadcast invalidation.
    Only accepts requests from Docker network peers (trusted proxy check)."""
    client_ip = request.client.host if request.client else ""
    if not (client_ip.startswith("172.") or client_ip.startswith("10.") or client_ip == "127.0.0.1"):
        raise HTTPException(status_code=403, detail="Forbidden")
    scopes = body.scopes
    if scopes:
        broadcast_invalidation(*scopes)
    return {"ok": True, "scopes": scopes}


# ── Auto-invalidation middleware ────────────────────────────────

# Map mutation routes to cache scopes they invalidate.
_INVALIDATION_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"^/api/me/likes"), ["likes"]),
    (re.compile(r"^/api/me/follows"), ["follows", "home", "upcoming"]),
    (re.compile(r"^/api/me/albums"), ["saved_albums", "home"]),
    # history and play-events do NOT invalidate home — the home cache
    # has its own TTL and recomputing 200+ queries on every track play
    # kills the server. Home data updates on its own schedule.
    (re.compile(r"^/api/me/history$"), ["history"]),
    (re.compile(r"^/api/me/play-events$"), ["history"]),
    (re.compile(r"^/api/me/shows"), ["shows", "upcoming"]),
    (re.compile(r"^/api/me/location$"), ["shows", "upcoming"]),
    (re.compile(r"^/api/playlists$"), ["playlists"]),
    (re.compile(r"^/api/playlists/(\d+)"), ["playlists", "playlist:{1}"]),
    (re.compile(r"^/api/curation"), ["curation"]),
    (re.compile(r"^/api/artists/(\d+)/enrich"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/manage/artists/(\d+)/delete"), ["library", "artist:{1}", "home"]),
    (re.compile(r"^/api/manage/artists/(\d+)/repair"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/manage/artists/(\d+)"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/albums/(\d+)/cover"), ["library", "album:{1}"]),
    (re.compile(r"^/api/albums/(\d+)/tags"), ["library", "album:{1}"]),
    (re.compile(r"^/api/albums/(\d+)"), ["library", "album:{1}"]),
    (re.compile(r"^/api/tracks/(\d+)/tags"), ["library"]),
    (re.compile(r"^/api/tags"), ["library"]),
    (re.compile(r"^/api/scan"), ["library", "home"]),
    (re.compile(r"^/api/import"), ["library", "home"]),
    (re.compile(r"^/api/cache/invalidate$"), []),
]


def _match_invalidation_scopes(path: str) -> list[str]:
    for pattern, scope_templates in _INVALIDATION_RULES:
        match = pattern.match(path)
        if not match:
            continue
        scopes: list[str] = []
        for template in scope_templates:
            scope = template
            for index, group in enumerate(match.groups(), 1):
                if group:
                    scope = scope.replace(f"{{{index}}}", group)
            if "{" not in scope:
                scopes.append(scope)
        return scopes
    return []


class CacheInvalidationMiddleware:
    """After successful mutations, broadcast cache invalidation asynchronously."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        path = scope.get("path", "")
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
            await send(message)

        await self.app(scope, receive, send_wrapper)

        if method in ("POST", "PUT", "DELETE") and 200 <= status_code < 300:
            scopes = _match_invalidation_scopes(path)
            if scopes:
                broadcast_invalidation(*scopes)
