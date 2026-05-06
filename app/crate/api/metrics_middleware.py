"""ASGI middleware that captures per-request latency and error metrics."""

import logging
import re
import time
from threading import Lock

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from crate.metrics import record_counter_later, record_later, record_route_latency_later

log = logging.getLogger(__name__)

# Patterns that normalize dynamic path segments to templates.
_PATH_NORMALIZERS = [
    (re.compile(r"/api/tracks/(\d+)"), "/api/tracks/{id}"),
    (re.compile(r"/api/tracks/by-entity/[^/]+"), "/api/tracks/by-entity/{entity_uid}"),
    (re.compile(r"/api/tracks/by-storage/[^/]+"), "/api/tracks/by-storage/{storage_id}"),
    (re.compile(r"/api/albums/(\d+)"), "/api/albums/{id}"),
    (re.compile(r"/api/albums/by-entity/[^/]+"), "/api/albums/by-entity/{entity_uid}"),
    (re.compile(r"/api/artists/(\d+)"), "/api/artists/{id}"),
    (re.compile(r"/api/artists/by-entity/[^/]+"), "/api/artists/by-entity/{entity_uid}"),
    (re.compile(r"/api/playlists/(\d+)"), "/api/playlists/{id}"),
    (re.compile(r"/api/genres/[^/]+"), "/api/genres/{slug}"),
    (re.compile(r"/api/tasks/[a-f0-9]+"), "/api/tasks/{id}"),
    (re.compile(r"/api/curation/playlists/(\d+)"), "/api/curation/playlists/{id}"),
    (re.compile(r"/api/manage/artists/(\d+)"), "/api/manage/artists/{id}"),
    (re.compile(r"/api/manage/artists/by-entity/[^/]+"), "/api/manage/artists/by-entity/{entity_uid}"),
    (re.compile(r"/api/manage/albums/by-entity/[^/]+"), "/api/manage/albums/by-entity/{entity_uid}"),
    (re.compile(r"/api/stream/.+"), "/api/stream/{path}"),
    (re.compile(r"/api/me/home/section/.+"), "/api/me/home/section/{id}"),
    (re.compile(r"/api/events/task/[a-f0-9]+"), "/api/events/task/{id}"),
]

_SKIP_METRICS_PREFIXES = (
    "/api/stream/",
    "/api/download/",
)
_SLOW_REQUEST_MS = 1000
_HTTP_LATENCY_METRIC = "api.request.latency"
_HTTP_REQUESTS_METRIC = "api.request.count"
_HTTP_ERRORS_METRIC = "api.request.errors"
_HTTP_SLOW_METRIC = "api.request.slow"
_STREAM_REQUESTS_METRIC = "stream.requests"
_STREAM_LATENCY_METRIC = "stream.latency"
_STREAM_CONCURRENT_METRIC = "stream.concurrent"

_active_streams = 0
_active_streams_lock = Lock()


def _normalize_path(path: str) -> str:
    for pattern, template in _PATH_NORMALIZERS:
        if pattern.match(path):
            return template
    return path


def _should_skip_metrics(path: str) -> bool:
    if not path.startswith("/api/"):
        return True
    if path.startswith(_SKIP_METRICS_PREFIXES):
        return True
    if path.startswith("/api/tracks/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/tracks/by-entity/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/tracks/by-storage/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/albums/") and path.endswith("/download"):
        return True
    return False


def _get_header(headers: list[tuple[bytes, bytes]] | None, name: str) -> str | None:
    if not headers:
        return None
    wanted = name.lower().encode("latin-1")
    for key, value in headers:
        if key.lower() == wanted:
            return value.decode("latin-1")
    return None


def _classify_metric_target(path: str, headers: list[tuple[bytes, bytes]] | None) -> str | None:
    if _should_skip_metrics(path):
        return None
    content_type = (_get_header(headers, "content-type") or "").lower()
    if content_type.startswith("text/event-stream"):
        return "stream"
    return "api"


def _increment_active_streams() -> int:
    global _active_streams
    with _active_streams_lock:
        _active_streams += 1
        return _active_streams


def _decrement_active_streams() -> int:
    global _active_streams
    with _active_streams_lock:
        _active_streams = max(0, _active_streams - 1)
        return _active_streams


class MetricsMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        start = time.monotonic()
        status_code = 500
        response_headers: list[tuple[bytes, bytes]] | None = None
        stream_started = False
        normalized_path = _normalize_path(path)

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_headers, stream_started
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers = message.get("headers", [])
                if _classify_metric_target(path, response_headers) == "stream" and not stream_started:
                    stream_started = True
                    concurrent = _increment_active_streams()
                    record_later(
                        _STREAM_CONCURRENT_METRIC,
                        float(concurrent),
                        {"method": scope.get("method", "GET"), "path": normalized_path, "status": str(status_code)},
                    )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            if stream_started:
                concurrent = _decrement_active_streams()
                record_later(
                    _STREAM_CONCURRENT_METRIC,
                    float(concurrent),
                    {"method": scope.get("method", "GET"), "path": normalized_path, "status": str(status_code)},
                )
            self._record(scope, path, status_code, (time.monotonic() - start) * 1000, response_headers)
            raise

        if stream_started:
            concurrent = _decrement_active_streams()
            record_later(
                _STREAM_CONCURRENT_METRIC,
                float(concurrent),
                {"method": scope.get("method", "GET"), "path": normalized_path, "status": str(status_code)},
            )

        self._record(scope, path, status_code, (time.monotonic() - start) * 1000, response_headers)

    def _record(
        self,
        scope: Scope,
        path: str,
        status_code: int,
        elapsed_ms: float,
        response_headers: list[tuple[bytes, bytes]] | None,
    ) -> None:
        target = _classify_metric_target(path, response_headers)
        if target is None:
            return

        template = _normalize_path(path)
        tags = {"method": scope.get("method", "GET"), "path": template, "status": str(status_code)}

        if target == "stream":
            record_counter_later(_STREAM_REQUESTS_METRIC, tags)
            record_later(_STREAM_LATENCY_METRIC, elapsed_ms, tags)
            return

        record_later(_HTTP_LATENCY_METRIC, elapsed_ms, tags)
        record_route_latency_later(
            method=scope.get("method", "GET"),
            path=template,
            status=status_code,
            elapsed_ms=elapsed_ms,
            target=target,
        )
        record_counter_later(_HTTP_REQUESTS_METRIC, tags)

        if status_code >= 500:
            record_counter_later(_HTTP_ERRORS_METRIC, tags)
        if elapsed_ms >= _SLOW_REQUEST_MS:
            record_counter_later(_HTTP_SLOW_METRIC, tags)
            log.warning(
                "Slow API request %s %s -> %s in %.1fms",
                scope.get("method", "GET"),
                template,
                status_code,
                elapsed_ms,
            )
