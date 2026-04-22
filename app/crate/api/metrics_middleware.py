"""Middleware that captures per-request latency and error metrics."""

import re
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from crate.metrics import record, record_counter

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

        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = (time.monotonic() - start) * 1000

        template = _normalize_path(path)
        tags = {"method": request.method, "path": template, "status": str(response.status_code)}

        record("api.latency", elapsed_ms, tags)
        record_counter("api.requests", tags)

        if response.status_code >= 500:
            record_counter("api.errors", tags)

        return response
