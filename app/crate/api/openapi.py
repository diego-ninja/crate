"""OpenAPI helpers for Crate."""

from copy import deepcopy
import os

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

_HTTP_METHODS = {"get", "post", "put", "delete", "patch", "options", "head"}
_SECURED_TAGS = {"radio", "genres"}
_SECURED_PATHS = {
    "/api/artists/{artist_id}/radio",
}
_PUBLIC_AUTH_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/verify",
    "/api/auth/verify-soft",
    "/api/auth/config",
    "/api/auth/providers",
    "/api/auth/oauth/{provider}/start",
    "/api/auth/oauth/{provider}/callback",
    "/api/auth/google",
    "/api/auth/google/callback",
    "/api/auth/apple",
    "/api/auth/apple/callback",
}
_PUBLIC_PLAYLIST_PATHS = {
    "/api/playlists/filter-options",
}
_PUBLIC_SETUP_PATHS = {
    "/api/setup/status",
    "/api/setup/admin",
}
_PUBLIC_SCANNER_PATHS = {
    "/api/status",
}
_QUERY_TOKEN_PATH_PREFIXES = (
    "/api/stream/",
    "/api/download/",
)
_TAG_METADATA = [
    {"name": "auth", "x-displayName": "Authentication", "description": "Authentication, sessions, and identity provider flows."},
    {"name": "admin-auth", "x-displayName": "Admin Access", "description": "Administrator authentication and invite management."},
    {"name": "me", "x-displayName": "My Library", "description": "Personal library, listening history, feed, and home surfaces."},
    {"name": "offline", "x-displayName": "Offline Mirror", "description": "Offline manifests and mirrored playback assets."},
    {"name": "social", "x-displayName": "Social Graph", "description": "User profiles, follows, and social graph operations."},
    {"name": "jam", "x-displayName": "Jam Rooms", "description": "Collaborative listening rooms and invite flows."},
    {"name": "browse", "x-displayName": "Browse & Search", "description": "Library browsing, media metadata, and streaming endpoints."},
    {"name": "playlists", "x-displayName": "Playlists", "description": "User playlists and sharing flows."},
    {"name": "radio", "x-displayName": "Radio & Similar", "description": "Radio and recommendation building endpoints."},
    {"name": "genres", "x-displayName": "Genres", "description": "Genre taxonomy, graph, presets, and genre maintenance."},
    {"name": "curation", "x-displayName": "Curation", "description": "Curated and system playlist discovery."},
    {"name": "analytics", "x-displayName": "Analytics", "description": "Insights, statistics, and quality reporting."},
    {"name": "lyrics", "x-displayName": "Lyrics", "description": "Lyrics lookup and synchronization data."},
    {"name": "enrichment", "x-displayName": "Enrichment", "description": "Artist enrichment snapshots, analysis data, and setlist helpers."},
    {"name": "artwork", "x-displayName": "Artwork", "description": "Artwork discovery, upload, extraction, and repair workflows."},
    {"name": "metadata", "x-displayName": "Tags & Metadata", "description": "Album and track metadata editing endpoints."},
    {"name": "imports", "x-displayName": "Imports", "description": "Pending filesystem import inspection and ingestion actions."},
    {"name": "scanner", "x-displayName": "Scanner", "description": "Library scan status and issue fixing."},
    {"name": "organizer", "x-displayName": "File Organizer", "description": "File-organization preview and apply workflows."},
    {"name": "matcher", "x-displayName": "Album Matching", "description": "Album matching and metadata assistance."},
    {"name": "duplicates", "x-displayName": "Duplicates", "description": "Duplicate detection and comparison tools."},
    {"name": "batch", "x-displayName": "Batch Ops", "description": "Batch retagging and bulk maintenance tasks."},
    {"name": "acquisition", "x-displayName": "Acquisition", "description": "Soulseek and release acquisition workflows."},
    {"name": "tidal", "x-displayName": "Tidal", "description": "Tidal authentication, search, download, and monitoring."},
    {"name": "management", "x-displayName": "Health & Repair", "description": "Administrative health checks, repair, and analysis jobs."},
    {"name": "settings", "x-displayName": "Settings", "description": "Application settings and cache controls."},
    {"name": "tasks", "x-displayName": "Background Tasks", "description": "Background task inspection and worker status."},
    {"name": "events", "x-displayName": "Event Streams", "description": "Task, cache, and activity event streams."},
    {"name": "stack", "x-displayName": "Docker Stack", "description": "Managed Docker stack inspection and container control."},
    {"name": "setup", "x-displayName": "Setup", "description": "First-run setup and bootstrap helpers."},
    {"name": "admin", "x-displayName": "System Playlists", "description": "Administrator-only curated/system playlist surfaces."},
    {"name": "subsonic", "x-displayName": "Subsonic Compatibility", "description": "Open Subsonic-compatible browsing and streaming API."},
]
_TAG_GROUPS = [
    {"name": "Identity", "tags": ["auth", "me", "offline", "social", "jam", "admin-auth"]},
    {
        "name": "Listening & Discovery",
        "tags": ["browse", "playlists", "radio", "genres", "curation", "analytics", "lyrics"],
    },
    {
        "name": "Collection Operations",
        "tags": ["enrichment", "artwork", "metadata", "imports", "scanner", "organizer", "matcher", "duplicates", "batch", "acquisition", "tidal"],
    },
    {"name": "Admin & System", "tags": ["management", "settings", "tasks", "events", "stack", "setup", "admin"]},
    {"name": "Compatibility", "tags": ["subsonic"]},
]


def _filter_schema_by_tags(
    schema: dict,
    *,
    include_tags: set[str] | None = None,
    exclude_tags: set[str] | None = None,
    title: str | None = None,
    summary: str | None = None,
    description: str | None = None,
) -> dict:
    filtered = deepcopy(schema)
    filtered_paths: dict[str, dict] = {}

    for path, path_item in schema.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue

        next_path_item: dict[str, object] = {}
        for method, operation in path_item.items():
            if method not in _HTTP_METHODS or not isinstance(operation, dict):
                next_path_item[method] = deepcopy(operation)
                continue

            tags = set(operation.get("tags") or [])
            if include_tags is not None and not (tags & include_tags):
                continue
            if exclude_tags is not None and tags & exclude_tags:
                continue
            next_path_item[method] = deepcopy(operation)

        if any(method in _HTTP_METHODS for method in next_path_item):
            filtered_paths[path] = next_path_item

    active_tags = {
        tag
        for path_item in filtered_paths.values()
        for method, operation in path_item.items()
        if method in _HTTP_METHODS and isinstance(operation, dict)
        for tag in (operation.get("tags") or [])
    }

    filtered["paths"] = filtered_paths
    filtered["tags"] = [entry for entry in schema.get("tags", []) if entry.get("name") in active_tags]
    filtered["x-tagGroups"] = [
        {
            **group,
            "tags": [tag for tag in group.get("tags", []) if tag in active_tags],
        }
        for group in schema.get("x-tagGroups", [])
        if any(tag in active_tags for tag in group.get("tags", []))
    ]

    info = dict(filtered.get("info") or {})
    if title is not None:
        info["title"] = title
    if summary is not None:
        info["summary"] = summary
    if description is not None:
        info["description"] = description
    filtered["info"] = info
    return filtered


def _openapi_servers() -> list[dict[str, str]]:
    domain = os.environ.get("DOMAIN", "localhost")
    if domain == "localhost":
        return [
            {"url": "http://localhost:8585", "description": "Local development API"},
        ]
    return [
        {"url": f"https://api.{domain}", "description": "Primary API server"},
    ]


_AUTH_REQUIRED_PREFIXES = frozenset({
    "/api/admin/auth", "/api/admin/system-playlists",
    "/api/me", "/api/offline", "/api/users", "/api/jam", "/api/curation",
    "/api/artwork", "/api/manage",
    "/api/acquisition", "/api/tidal",
    "/api/imports", "/api/organize", "/api/stack",
    "/api/events", "/api/lyrics",
    "/api/browse", "/api/artists", "/api/albums",
    "/api/search", "/api/favorites", "/api/track", "/api/tracks",
    "/api/discover", "/api/similar-tracks", "/api/stream", "/api/download",
    "/api/analytics", "/api/activity", "/api/stats", "/api/timeline",
    "/api/quality", "/api/missing-search", "/api/insights",
    "/api/shows", "/api/upcoming", "/api/network",
    "/api/batch", "/api/match", "/api/duplicates",
    "/api/settings", "/api/tasks", "/api/worker",
    "/api/genres", "/api/radio",
})

_AUTH_REQUIRED_EXACT = frozenset({"/api/scan", "/api/issues", "/api/fix"})


def _should_attach_auth(path: str, operation: dict) -> bool:
    tags = set(operation.get("tags") or [])
    # Public paths are checked first (explicit opt-out overrides prefix match)
    if path in _PUBLIC_SCANNER_PATHS:
        return False
    if path.startswith("/api/auth") and path not in _PUBLIC_AUTH_PATHS:
        return True
    if path.startswith("/api/playlists") and path not in _PUBLIC_PLAYLIST_PATHS:
        return True
    if path.startswith("/api/setup") and path not in _PUBLIC_SETUP_PATHS:
        return True
    if path.startswith("/api/cache") and path != "/api/cache/invalidate":
        return True
    if path in _AUTH_REQUIRED_EXACT:
        return True
    if any(path.startswith(prefix) for prefix in _AUTH_REQUIRED_PREFIXES):
        return True
    return (
        path in _SECURED_PATHS
        or bool(tags & _SECURED_TAGS)
    )


def _supports_query_token(path: str) -> bool:
    if path == "/api/cache/events":
        return True
    if path.startswith(_QUERY_TOKEN_PATH_PREFIXES):
        return True
    if path.startswith("/api/tracks/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/tracks/by-storage/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/albums/") and path.endswith("/download"):
        return True
    return False


def custom_openapi(app: FastAPI) -> dict:
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title="MusicDock API",
        version="0.1.0",
        summary="OpenAPI contract for Crate's HTTP API.",
        description=(
            "Crate is a self-hosted music platform for library management, enrichment, "
            "analysis, playback, and discovery."
        ),
        routes=app.routes,
    )
    schema["servers"] = _openapi_servers()
    schema["tags"] = _TAG_METADATA
    schema["x-tagGroups"] = _TAG_GROUPS

    components = schema.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes.setdefault(
        "bearerAuth",
        {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Bearer token returned by /api/auth/login.",
        },
    )
    security_schemes.setdefault(
        "cookieAuth",
        {
            "type": "apiKey",
            "in": "cookie",
            "name": "crate_session",
            "description": "Browser session cookie set after login.",
        },
    )
    security_schemes.setdefault(
        "queryTokenAuth",
        {
            "type": "apiKey",
            "in": "query",
            "name": "token",
            "description": "Query-string token used on some media endpoints.",
        },
    )

    for path, path_item in schema.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in _HTTP_METHODS or not isinstance(operation, dict):
                continue
            if _should_attach_auth(path, operation) and "security" not in operation:
                operation["security"] = [
                    {"cookieAuth": []},
                    {"bearerAuth": []},
                ]
            if _supports_query_token(path):
                security = operation.setdefault(
                    "security",
                    [
                        {"cookieAuth": []},
                        {"bearerAuth": []},
                    ],
                )
                if {"queryTokenAuth": []} not in security:
                    security.append({"queryTokenAuth": []})

    app.openapi_schema = schema
    return schema


def variant_openapi(
    app: FastAPI,
    cache_key: str,
    *,
    include_tags: set[str] | None = None,
    exclude_tags: set[str] | None = None,
    title: str | None = None,
    summary: str | None = None,
    description: str | None = None,
) -> dict:
    cache = getattr(app.state, "openapi_variants", {})
    if cache_key in cache:
        return cache[cache_key]

    schema = _filter_schema_by_tags(
        custom_openapi(app),
        include_tags=include_tags,
        exclude_tags=exclude_tags,
        title=title,
        summary=summary,
        description=description,
    )
    cache[cache_key] = schema
    app.state.openapi_variants = cache
    return schema
