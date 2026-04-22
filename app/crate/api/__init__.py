import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from crate.api._deps import json_dumps
from crate.api.openapi import custom_openapi, variant_openapi
from crate.db import init_db


class DateAwareJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json_dumps(content).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from crate.utils import init_musicbrainz
    init_musicbrainz()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="MusicDock",
        version="0.1.0",
        lifespan=lifespan,
        default_response_class=DateAwareJSONResponse,
    )
    app.openapi = lambda: custom_openapi(app)

    @app.get("/openapi-crate.json", include_in_schema=False)
    async def openapi_crate_json():
        return variant_openapi(
            app,
            "crate-rest",
            exclude_tags={"subsonic"},
            title="MusicDock API",
            summary="OpenAPI contract for Crate's primary HTTP API.",
            description=(
                "Crate is a self-hosted music platform for library management, enrichment, "
                "analysis, playback, and discovery."
            ),
        )

    @app.get("/openapi-app.json", include_in_schema=False)
    async def openapi_app_json():
        return variant_openapi(
            app,
            "app-api",
            include_tags={"auth", "me", "offline", "social", "jam", "browse", "playlists", "radio", "genres", "curation", "analytics", "lyrics"},
            title="Crate App & Listening API",
            summary="Authentication, personal library, browsing, playlists, radio, and listening surfaces.",
            description=(
                "This surface covers the day-to-day Crate application experience: signing in, "
                "browsing the library, building playlists, radio, and user-facing discovery."
            ),
        )

    @app.get("/openapi-collection-ops.json", include_in_schema=False)
    async def openapi_collection_ops_json():
        return variant_openapi(
            app,
            "collection-ops",
            include_tags={"enrichment", "artwork", "metadata", "imports", "scanner", "organizer", "matcher", "duplicates", "batch", "acquisition", "tidal"},
            title="Crate Collection Operations API",
            summary="Artwork, metadata, import, acquisition, and maintenance workflows for the library.",
            description=(
                "This surface focuses on collection maintenance and ingest workflows: enrichment, "
                "artwork, metadata editing, imports, acquisition, and bulk maintenance."
            ),
        )

    @app.get("/openapi-admin-system.json", include_in_schema=False)
    async def openapi_admin_system_json():
        return variant_openapi(
            app,
            "admin-system",
            include_tags={"management", "settings", "tasks", "events", "stack", "setup", "admin", "admin-auth"},
            title="Crate Admin & System API",
            summary="Setup, administration, health, task orchestration, and system control.",
            description=(
                "This surface gathers administrative and operational endpoints: setup, invite "
                "management, health and repair flows, task orchestration, event streams, and stack control."
            ),
        )

    @app.get("/openapi-subsonic.json", include_in_schema=False)
    async def openapi_subsonic_json():
        return variant_openapi(
            app,
            "subsonic-compatibility",
            include_tags={"subsonic"},
            title="Crate Subsonic Compatibility API",
            summary="OpenAPI contract for the Open Subsonic-compatible surface exposed by Crate.",
            description=(
                "Crate exposes a Subsonic-compatible API under /rest so third-party players can "
                "browse, search, and stream from the library."
            ),
        )

    domain = os.environ.get("DOMAIN", "localhost")
    is_dev = domain in ("localhost", "127.0.0.1")
    allowed_origins = [
        f"https://admin.{domain}",
        f"https://listen.{domain}",
        f"https://api.{domain}",
        f"https://{domain}",
        # Capacitor native shells
        "capacitor://localhost",
        "https://localhost",
    ]
    # Project surfaces (docs, reference) — always allowed because they
    # live on a fixed domain regardless of the operator's DOMAIN.
    allowed_origins += [
        "https://docs.cratemusic.app",
        "https://reference.cratemusic.app",
    ]
    if is_dev:
        # Dev-only origins — Vite dev servers + dev subdomains
        allowed_origins += [
            f"https://docs.{domain}", f"https://reference.{domain}",
            "https://docs.dev.cratemusic.app",
            "https://reference.dev.cratemusic.app",
            "http://localhost:3000", "http://localhost:5173",
            "http://localhost:5174", "http://localhost:4173",
            "http://localhost:5177", "http://127.0.0.1:4173",
            "http://127.0.0.1:5177", "http://localhost:8585",
        ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from crate.api.auth import AuthMiddleware
    from crate.api.cache_events import CacheInvalidationMiddleware
    from crate.api.metrics_middleware import MetricsMiddleware
    app.add_middleware(AuthMiddleware)
    app.add_middleware(CacheInvalidationMiddleware)
    app.add_middleware(MetricsMiddleware)

    from crate.api.setup import router as setup_router
    from crate.api.auth import router as auth_router, admin_router as admin_auth_router
    from crate.api.browse import router as browse_router
    from crate.api.tags import router as tags_router
    from crate.api.scanner import router as scanner_router
    from crate.api.matcher import router as matcher_router
    from crate.api.duplicates import router as duplicates_router
    from crate.api.artwork import router as artwork_router
    from crate.api.organizer import router as organizer_router
    from crate.api.imports import router as imports_router
    from crate.api.batch import router as batch_router
    from crate.api.analytics import router as analytics_router
    from crate.api.events import router as events_router
    from crate.api.tasks import router as tasks_router
    from crate.api.stack import router as stack_router
    from crate.api.enrichment import router as enrichment_router
    from crate.api.management import router as management_router
    from crate.api.settings import router as settings_router
    from crate.api.playlists import router as playlists_router
    from crate.api.offline import router as offline_router
    from crate.api.curation import router as curation_router
    from crate.api.system_playlists import router as system_playlists_router
    from crate.api.genres import router as genres_router
    from crate.api.tidal import router as tidal_router
    from crate.api.acquisition import router as acquisition_router
    from crate.api.me import router as me_router
    from crate.api.radio import router as radio_router
    from crate.api.lyrics import router as lyrics_router
    from crate.api.cache_events import router as cache_events_router
    from crate.api.social import router as social_router
    from crate.api.jam import router as jam_router
    from crate.api.subsonic import router as subsonic_router
    from crate.api.paths import router as paths_router

    # Auth + management + settings + enrichment BEFORE browse (browse has {name:path} catch-all)
    app.include_router(setup_router)
    app.include_router(auth_router)
    app.include_router(admin_auth_router)
    app.include_router(me_router)
    app.include_router(offline_router)
    app.include_router(social_router)
    app.include_router(jam_router)
    app.include_router(radio_router)
    app.include_router(lyrics_router)
    app.include_router(management_router)
    app.include_router(settings_router)
    app.include_router(playlists_router)
    app.include_router(curation_router)
    app.include_router(system_playlists_router)
    app.include_router(genres_router)
    app.include_router(tidal_router)
    app.include_router(acquisition_router)
    app.include_router(enrichment_router)
    app.include_router(analytics_router)
    app.include_router(artwork_router)
    app.include_router(scanner_router)
    app.include_router(matcher_router)
    app.include_router(duplicates_router)
    app.include_router(subsonic_router)
    app.include_router(browse_router)
    app.include_router(tags_router)
    app.include_router(organizer_router)
    app.include_router(imports_router)
    app.include_router(batch_router)
    app.include_router(events_router)
    app.include_router(cache_events_router)
    app.include_router(paths_router)
    app.include_router(tasks_router)
    app.include_router(stack_router)
    from crate.api.admin_metrics import router as admin_metrics_router
    app.include_router(admin_metrics_router)

    # Static files
    base = Path(__file__).resolve().parent.parent
    static_dir = base / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app
