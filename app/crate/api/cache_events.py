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
import re
from time import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    OpenApiResponses,
    error_response,
    merge_responses,
)
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.api.schemas.utility import (
    CacheInvalidationRequest,
    CacheInvalidationResponse,
)
from crate.config import get_cache_redis_url

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

_CACHE_INVALIDATION_RESPONSES: OpenApiResponses = {
    403: error_response(
        "Only trusted internal peers may broadcast cache invalidations."
    ),
    422: error_response("The request payload failed validation."),
}

# ── Redis-backed event bus ──────────────────────────────────────────
#
# Every event is a JSON blob stored in a Redis list (newest first).
# The list is capped at 500 entries. Each event carries a monotonic
# integer ID so SSE clients can resume from their last-seen position.

_EVENTS_KEY = "cache:invalidation:events"
_EVENT_ID_KEY = "cache:invalidation:next_id"
_LIVE_CHANNEL = "crate:sse:cache-invalidation"
_MAX_EVENTS = 500

_redis: Any | None = None
_invalidation_dispatcher = None
_invalidation_subscriber = None

_PROJECTOR_RELEVANT_INVALIDATION_SCOPES = frozenset(
    {
        "home",
        "library",
        "global_catalog",
        "shows",
        "upcoming",
        "curation",
        "playlists",
        "artist_bio",
    }
)


def _get_redis() -> Any:
    global _redis
    if _redis is None:
        import redis as _redis_lib

        _redis = _redis_lib.from_url(get_cache_redis_url(), decode_responses=True)
    return _redis


def _should_append_invalidation_domain_event(scope: str) -> bool:
    return (
        scope.startswith("home:user:")
        or scope.startswith(("artist:", "album:", "playlist:"))
        or scope in _PROJECTOR_RELEVANT_INVALIDATION_SCOPES
    )


def broadcast_invalidation(*scopes: str):
    """Queue cache invalidation on the process-wide bounded dispatcher.

    Projector-relevant invalidations are committed to the PostgreSQL outbox
    before the volatile dispatcher receives them. Redis writes and backend
    cache clearing then happen asynchronously.
    """
    normalized = tuple(dict.fromkeys(scope for scope in scopes if scope))
    if not normalized:
        return
    try:
        _persist_invalidation_events(normalized)
    except Exception:
        log.warning("Failed to persist cache invalidations", exc_info=True)
    _get_invalidation_dispatcher().submit(normalized)


def wait_for_cache_invalidation(*, timeout: float = 2.0) -> bool:
    """Wait until this process has applied queued cache invalidations."""
    dispatcher = _invalidation_dispatcher
    if dispatcher is None:
        return True
    try:
        return dispatcher.wait_until_idle(timeout=max(0.0, timeout))
    except Exception:
        log.warning("Failed to wait for cache invalidation", exc_info=True)
        return False


def _persist_invalidation_events(scopes: tuple[str, ...]) -> None:
    from crate.db.cache_invalidation import persist_invalidation_events

    relevant = tuple(
        scope for scope in scopes if _should_append_invalidation_domain_event(scope)
    )
    persist_invalidation_events(relevant)


def _get_invalidation_dispatcher():
    global _invalidation_dispatcher
    if _invalidation_dispatcher is None:
        from crate.db.cache_invalidation import BoundedInvalidationDispatcher

        _invalidation_dispatcher = BoundedInvalidationDispatcher(_do_broadcast)
        _invalidation_dispatcher.start()
    return _invalidation_dispatcher


def start_cache_invalidation_runtime() -> None:
    global _invalidation_subscriber
    _get_invalidation_dispatcher()
    if _invalidation_subscriber is None:
        from crate.db.cache_invalidation import CacheInvalidationSubscriber

        _invalidation_subscriber = CacheInvalidationSubscriber(
            _get_redis,
            _LIVE_CHANNEL,
        )
        _invalidation_subscriber.start()


def stop_cache_invalidation_runtime() -> None:
    global _invalidation_dispatcher, _invalidation_subscriber
    if _invalidation_subscriber is not None:
        _invalidation_subscriber.stop()
        _invalidation_subscriber = None
    if _invalidation_dispatcher is not None:
        _invalidation_dispatcher.stop()
        _invalidation_dispatcher = None


def _do_broadcast(scopes: tuple[str, ...] | list[str]):
    try:
        r = _get_redis()
    except Exception:
        r = None
        log.warning("Cache Redis is unavailable during invalidation", exc_info=True)

    try:
        _clear_backend_cache_for_scopes(scopes)
    except Exception:
        log.warning("Failed to clear local cache for %s", scopes, exc_info=True)

    for scope in scopes:
        event_id = None
        if r is not None:
            try:
                event_id = r.incr(_EVENT_ID_KEY)
                event = json.dumps({"id": event_id, "scope": scope, "ts": time()})
                r.lpush(_EVENTS_KEY, event)
                r.ltrim(_EVENTS_KEY, 0, _MAX_EVENTS - 1)
                r.publish(_LIVE_CHANNEL, event)
                log.debug("cache invalidation: %s (event %d)", scope, event_id)
            except Exception:
                log.warning(
                    "Failed to publish cache invalidation for %s", scope, exc_info=True
                )


def _clear_backend_cache_for_scopes(scopes: tuple[str, ...] | list[str]):
    """Clear backend cache entries that correspond to the invalidated scopes."""
    from crate.db.cache_store import delete_cache_prefix
    from crate.db.ui_snapshot_store import mark_ui_snapshots_stale

    from crate.db.cache_invalidation import cache_prefixes_for_scopes
    from crate.db.cache_runtime import _mem_clear

    if "*" in scopes:
        _mem_clear()
        delete_cache_prefix("")
        mark_ui_snapshots_stale(scope_prefix="")
        return

    prefixes_to_clear = cache_prefixes_for_scopes(scopes)

    for prefix in prefixes_to_clear:
        try:
            delete_cache_prefix(prefix)
        except Exception:
            log.debug("Failed to clear backend cache prefix: %s", prefix, exc_info=True)

    try:
        for scope in scopes:
            if scope.startswith("home:user:"):
                user_id = scope.split(":")[-1]
                if user_id:
                    mark_ui_snapshots_stale(scope="home:discovery", subject_key=user_id)
        if any(
            scope
            in {
                "home",
                "follows",
                "likes",
                "saved_albums",
                "history",
                "library",
                "global_catalog",
                "curation",
                "playlists",
                "shows",
                "upcoming",
                "artist_bio",
            }
            or scope.startswith(("artist:", "album:", "playlist:"))
            for scope in scopes
        ):
            mark_ui_snapshots_stale(scope_prefix="home:")
        if any(
            scope
            in {
                "library",
                "global_catalog",
                "shows",
                "upcoming",
                "curation",
                "playlists",
                "artist_bio",
            }
            or scope.startswith(("artist:", "album:", "playlist:"))
            for scope in scopes
        ):
            mark_ui_snapshots_stale(scope="ops", subject_key="dashboard")
    except Exception:
        log.debug(
            "Failed to mark ui snapshots stale for scopes: %s", scopes, exc_info=True
        )


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


def _format_invalidation_sse(event: dict) -> str:
    return f"id: {event['id']}\ndata: {event['scope']}\n\n"


def _format_heartbeat_sse() -> str:
    payload = json.dumps({"ts": time()})
    return f"event: heartbeat\ndata: {payload}\n\n: heartbeat\n\n"


async def _open_live_invalidation_pubsub():
    return await open_pubsub(_LIVE_CHANNEL)


async def _close_live_invalidation_pubsub(pubsub) -> None:
    try:
        await close_pubsub(pubsub, _LIVE_CHANNEL)
    except Exception:
        log.debug("Failed to close cache invalidation pubsub", exc_info=True)


# ── SSE stream ──────────────────────────────────────────────────────

_HEARTBEAT_INTERVAL = 30  # seconds


def _cache_event_resume_id(request: Request) -> int:
    """Resolve a valid SSE cursor without replaying history to new clients."""
    values = (
        request.headers.get("Last-Event-ID"),
        request.query_params.get("last_event_id"),
    )
    for value in values:
        if value is None or not value.strip():
            continue
        try:
            event_id = int(value)
        except (ValueError, TypeError):
            continue
        if event_id >= 0:
            return event_id
    return get_latest_invalidation_event_id()


async def _invalidation_stream(last_event_id: int) -> AsyncIterator[str]:
    """Yield SSE events for cache invalidation.

    Replays any events missed since ``last_event_id`` (from the
    ``Last-Event-ID`` header on reconnect), then subscribes to a
    Redis pub/sub channel for low-latency live delivery. Sends a
    keep-alive comment every 30 s to prevent proxy timeouts.
    """
    pubsub = None
    live_redis = None

    try:
        live_pubsub = await _open_live_invalidation_pubsub()
        if isinstance(live_pubsub, tuple):
            live_redis, pubsub = live_pubsub
        else:
            pubsub = live_pubsub

        missed = get_invalidation_events_since(last_event_id)
        for event in missed:
            last_event_id = event["id"]
            yield _format_invalidation_sse(event)

        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message.get("type") == "message":
                try:
                    event = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError):
                    continue
                event_id = int(event.get("id") or 0)
                if event_id <= last_event_id:
                    continue
                last_event_id = event_id
                heartbeat_counter = 0
                yield _format_invalidation_sse(event)
                continue

            heartbeat_counter += 1
            if heartbeat_counter >= _HEARTBEAT_INTERVAL:
                heartbeat_counter = 0
                yield _format_heartbeat_sse()
    except Exception:
        heartbeat_counter = 0
        while True:
            await asyncio.sleep(1)
            heartbeat_counter += 1

            new_events = get_invalidation_events_since(last_event_id)
            for event in new_events:
                last_event_id = event["id"]
                yield _format_invalidation_sse(event)

            if heartbeat_counter >= _HEARTBEAT_INTERVAL:
                heartbeat_counter = 0
                yield _format_heartbeat_sse()
    finally:
        if pubsub is not None:
            await _close_live_invalidation_pubsub(pubsub)
        if live_redis is not None:
            close = getattr(live_redis, "aclose", None)
            if close is not None:
                await close()


@router.get(
    "/api/cache/events",
    responses=_CACHE_EVENT_RESPONSES,
    summary="Stream cache invalidation events",
)
async def cache_events(request: Request):
    """SSE stream of cache invalidation events.

    On reconnect, the browser sends ``Last-Event-ID`` automatically.
    Full page reloads resume through the persisted ``last_event_id`` query
    parameter. The server replays any events the client missed during downtime.
    """
    _require_auth(request)

    last_event_id = _cache_event_resume_id(request)

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
    if not (
        client_ip.startswith("172.")
        or client_ip.startswith("10.")
        or client_ip == "127.0.0.1"
    ):
        raise HTTPException(status_code=403, detail="Forbidden")
    scopes = body.scopes
    if scopes:
        broadcast_invalidation(*scopes)
    return {"ok": True, "scopes": scopes}


# ── Auto-invalidation middleware ────────────────────────────────

# Map mutation routes to cache scopes they invalidate.
_INVALIDATION_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"^/api/auth/(?:logout|sessions|profile)"), ["auth"]),
    (re.compile(r"^/api/admin/(?:auth/)?users/\d+(?:/|$)"), ["auth"]),
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
    (
        re.compile(r"^/api/manage/artists/(\d+)/delete"),
        ["library", "artist:{1}", "home"],
    ),
    (re.compile(r"^/api/manage/artists/(\d+)/repair"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/manage/artists/(\d+)"), ["library", "artist:{1}"]),
    (re.compile(r"^/api/albums/(\d+)/cover"), ["library", "album:{1}"]),
    (re.compile(r"^/api/albums/(\d+)/tags"), ["library", "album:{1}"]),
    (re.compile(r"^/api/albums/(\d+)"), ["library", "album:{1}"]),
    (re.compile(r"^/api/tracks/(\d+)/tags"), ["library"]),
    (re.compile(r"^/api/tags"), ["library"]),
    (re.compile(r"^/api/scan"), ["library", "home"]),
    (re.compile(r"^/api/import"), ["library", "home"]),
    (re.compile(r"^/api/jam"), ["jam"]),
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

        if method in ("POST", "PUT", "PATCH", "DELETE") and 200 <= status_code < 300:
            scopes = _match_invalidation_scopes(path)
            if scopes:
                broadcast_invalidation(*scopes)
