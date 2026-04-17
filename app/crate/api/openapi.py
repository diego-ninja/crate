"""OpenAPI helpers for Crate."""

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

_HTTP_METHODS = {"get", "post", "put", "delete", "patch", "options", "head"}
_SECURED_TAGS = {"radio", "genres"}
_SECURED_PATHS = {
    "/api/artists/{artist_id}/radio",
}


def _should_attach_auth(path: str, operation: dict) -> bool:
    tags = set(operation.get("tags") or [])
    return path.startswith("/api/genres") or path.startswith("/api/radio") or path in _SECURED_PATHS or bool(tags & _SECURED_TAGS)


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

    app.openapi_schema = schema
    return schema
