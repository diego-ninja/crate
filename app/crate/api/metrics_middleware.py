"""Middleware that captures per-request latency and error metrics."""

import logging
import re
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from crate.metrics import record, record_counter

log = logging.getLogger(__name__)

# Patterns that normalize dynamic path segments to templates.
_PATH_NORMALIZERS = [
    (re.compile(r"/api/tracks/(\d+)"), "/api/tracks/{id}"),
    (re.compile(r"/api/tracks/by-storage/[^/]+"), "/api/tracks/by-storage/{storage_id}"),
    (re.compile(r"/api/albums/(\d+)"), "/api/albums/{id}"),
    (re.compile(r"/api/artists/(\d+)"), "/api/artists/{id}"),
    (re.compile(r"/api/playlists/(\d+)"), "/api/playlists/{id}"),
    (re.compile(r"/api/genres/[^/]+"), "/api/genres/{slug}"),
    (re.compile(r"/api/tasks/[a-f0-9]+"), "/api/tasks/{id}"),
    (re.compile(r"/api/curation/playlists/(\d+)"), "/api/curation/playlists/{id}"),
    (re.compile(r"/api/manage/artists/(\d+)"), "/api/manage/artists/{id}"),
    (re.compile(r"/api/stream/.+"), "/api/stream/{path}"),
    (re.compile(r"/api/me/home/section/.+"), "/api/me/home/section/{id}"),
    (re.compile(r"/api/events/task/[a-f0-9]+"), "/api/events/task/{id}"),
]

_SKIP_METRICS_PREFIXES = (
    "/api/stream/",
    "/api/download/",
)
_SLOW_REQUEST_MS = 1000


def _normalize_path(path: str) -> str:
    for pattern, template in _PATH_NORMALIZERS:
        if pattern.match(path):
            return template
    return path


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Skip non-API paths and SSE streams (long-lived connections)
        path = request.url.path
        if not path.startswith("/api/") or path in ("/api/events", "/api/cache/events"):
            return await call_next(request)
        if path.startswith(_SKIP_METRICS_PREFIXES):
            return await call_next(request)
        if path.startswith("/api/tracks/") and path.endswith(("/stream", "/download")):
            return await call_next(request)
        if path.startswith("/api/tracks/by-storage/") and path.endswith(("/stream", "/download")):
            return await call_next(request)
        if path.startswith("/api/albums/") and path.endswith("/download"):
            return await call_next(request)

        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = (time.monotonic() - start) * 1000

        template = _normalize_path(path)
        tags = {"method": request.method, "path": template, "status": str(response.status_code)}

        record("api.latency", elapsed_ms, tags)
        record_counter("api.requests", tags)

        if response.status_code >= 500:
            record_counter("api.errors", tags)
        if elapsed_ms >= _SLOW_REQUEST_MS:
            record_counter("api.slow", tags)
            log.warning(
                "Slow API request %s %s -> %s in %.1fms",
                request.method,
                template,
                response.status_code,
                elapsed_ms,
            )

        return response
