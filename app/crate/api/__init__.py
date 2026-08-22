import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from crate.api._deps import json_dumps
from crate.api.openapi import custom_openapi, variant_openapi
from crate.db.init_db import init_db

log = logging.getLogger(__name__)

SECURITY_RESPONSE_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_ALLOWED_HEADERS = [
    "Accept",
    "Authorization",
    "Content-Type",
    "If-Modified-Since",
    "If-None-Match",
    "Last-Event-ID",
    "Range",
    "X-Crate-App",
    "X-Device-Fingerprint",
    "X-Device-Label",
    "X-Requested-With",
]


def _extra_cors_origins() -> list[str]:
    raw = os.environ.get("CRATE_CORS_EXTRA_ORIGINS", "")
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class DateAwareJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json_dumps(content).encode("utf-8")


async def _refresh_radio_graphs_periodically() -> None:
    while True:
        await asyncio.sleep(300)
        try:
            from crate.radio_engine import clear_radio_graph_cache, _load_radio_graphs

            clear_radio_graph_cache()
            await asyncio.to_thread(_load_radio_graphs)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("Radio graph background refresh failed", exc_info=True)


def _bootstrap_federation_identity() -> None:
    from crate.federation.bootstrap import bootstrap_federation_identity

    bootstrap_federation_identity(
        display_name=os.environ.get("CRATE_INSTANCE_NAME")
        or os.environ.get("INSTANCE_NAME")
        or "Crate Node",
        api_base_url=os.environ.get("CRATE_PUBLIC_API_BASE_URL")
        or os.environ.get("CRATE_PUBLIC_URL")
        or "",
    )


def _queue_global_catalog_bootstrap() -> None:
    """Ensure the canonical catalog and historical user refs are projected."""
    from crate.db.global_catalog_search_projection import (
        get_global_catalog_search_projection_status,
    )
    from crate.db.repositories.global_catalog_state import get_catalog_state
    from crate.db.repositories.global_user_library import (
        USER_LIBRARY_REFS_BACKFILL_VERSION,
    )
    from crate.db.repositories.tasks import create_task_dedup
    from crate.task_dedup_keys import GLOBAL_CATALOG_FULL_DEDUP_KEY

    state = get_catalog_state()
    if (
        state["status"] == "ready"
        and state.get("user_refs_backfilled_at") is not None
        and state.get("user_refs_backfill_version", 0)
        >= USER_LIBRARY_REFS_BACKFILL_VERSION
        and get_global_catalog_search_projection_status() == "ready"
    ):
        return
    create_task_dedup(
        "global_catalog_reconcile_full",
        {"triggered_by": "api_startup"},
        dedup_key=GLOBAL_CATALOG_FULL_DEDUP_KEY,
    )


def _queue_artwork_variant_backfill() -> None:
    """Queue the versioned, restart-safe upgrade backfill once per installation."""
    from crate.artwork_tasks import ARTWORK_BACKFILL_VERSION
    from crate.db.cache_settings import get_setting
    from crate.db.repositories.tasks import create_task_dedup

    if get_setting("artwork_variants_backfill_version") == ARTWORK_BACKFILL_VERSION:
        return
    create_task_dedup(
        "backfill_artwork_variants",
        {"batch_size": 100, "include_genres": True},
        dedup_key=f"bootstrap:artwork-variants:v{ARTWORK_BACKFILL_VERSION}",
    )


def _queue_artwork_manifest_permission_repair() -> None:
    """Queue the one-time cache manifest mode repair for readplane access."""
    from crate.artwork_tasks import ARTWORK_MANIFEST_PERMISSIONS_VERSION
    from crate.db.cache_settings import get_setting
    from crate.db.repositories.tasks import create_task_dedup

    if (
        get_setting("artwork_manifest_permissions_version")
        == ARTWORK_MANIFEST_PERMISSIONS_VERSION
    ):
        return
    create_task_dedup(
        "repair_artwork_variants",
        {"max_assets": 100_000, "repair_manifest_permissions": True},
        dedup_key=(
            "bootstrap:artwork-manifest-permissions:"
            f"v{ARTWORK_MANIFEST_PERMISSIONS_VERSION}"
        ),
    )


def _queue_stats_dashboard_backfill() -> None:
    """Prewarm the canonical dashboard projection for every active user."""
    from crate.db.user_stats_dashboard_surface import (
        queue_missing_stats_dashboard_snapshots,
    )

    queued = queue_missing_stats_dashboard_snapshots()
    if queued:
        log.info("Queued %s missing user stats dashboard snapshots", queued)


def _queue_artist_top_track_ranking_backfill() -> None:
    """Refresh persisted remote ranks after ranking semantics change."""
    from crate.db.cache_settings import get_setting
    from crate.db.repositories.tasks import create_task_dedup
    from crate.popularity import ARTIST_TOP_TRACK_RANKING_VERSION

    if (
        get_setting("artist_top_track_ranking_version")
        == ARTIST_TOP_TRACK_RANKING_VERSION
    ):
        return
    create_task_dedup(
        "compute_popularity",
        {
            "triggered_by": "api_startup",
            "ranking_version": ARTIST_TOP_TRACK_RANKING_VERSION,
        },
        dedup_key=(f"bootstrap:artist-top-tracks:v{ARTIST_TOP_TRACK_RANKING_VERSION}"),
    )


async def _repair_musicbrainz_cache_ttls() -> int:
    from crate.db.cache_musicbrainz import repair_mb_cache_ttls

    repaired = await asyncio.to_thread(repair_mb_cache_ttls)
    if repaired:
        log.info("Applied TTLs to %s legacy MusicBrainz cache entries", repaired)
    return repaired


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _bootstrap_federation_identity()
    _queue_global_catalog_bootstrap()
    _queue_artwork_variant_backfill()
    _queue_artwork_manifest_permission_repair()
    _queue_stats_dashboard_backfill()
    _queue_artist_top_track_ranking_backfill()
    from crate.utils import init_musicbrainz

    init_musicbrainz()
    from crate.api.cache_events import (
        start_cache_invalidation_runtime,
        stop_cache_invalidation_runtime,
    )

    start_cache_invalidation_runtime()
    mb_cache_ttl_repair_task = asyncio.create_task(_repair_musicbrainz_cache_ttls())

    # Pre-warm radio graphs so the first radio request does not pay
    # the cost of loading artist similarities, genres, and members
    # from PostgreSQL into Python dicts.
    try:
        from crate.radio_engine import _load_radio_graphs

        _load_radio_graphs()
    except Exception:
        log.warning("Radio graph pre-warm failed", exc_info=True)

    radio_refresh_task = asyncio.create_task(_refresh_radio_graphs_periodically())
    from crate.runtime_saturation import monitor_event_loop_lag

    event_loop_monitor_task = asyncio.create_task(monitor_event_loop_lag())
    try:
        yield
    finally:
        stop_cache_invalidation_runtime()
        from crate.federation.client import close_shared_clients

        await asyncio.to_thread(close_shared_clients)
        federation_stream_client = getattr(app.state, "federation_stream_client", None)
        if federation_stream_client is not None:
            await federation_stream_client.aclose()
        radio_refresh_task.cancel()
        event_loop_monitor_task.cancel()
        try:
            await asyncio.gather(
                radio_refresh_task,
                event_loop_monitor_task,
                mb_cache_ttl_repair_task,
                return_exceptions=True,
            )
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    app = FastAPI(
        title="Crate",
        version="0.1.0",
        lifespan=lifespan,
        default_response_class=DateAwareJSONResponse,
    )
    app.openapi = lambda: custom_openapi(app)

    @app.middleware("http")
    async def security_headers_middleware(request, call_next):
        response = await call_next(request)
        if not is_dev:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        for header, value in SECURITY_RESPONSE_HEADERS.items():
            response.headers.setdefault(header, value)
        return response

    @app.get("/openapi-crate.json", include_in_schema=False)
    async def openapi_crate_json():
        return variant_openapi(
            app,
            "crate-rest",
            exclude_tags={"subsonic"},
            title="Crate API",
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
            include_tags={
                "auth",
                "me",
                "offline",
                "social",
                "jam",
                "bandcamp",
                "browse",
                "playlists",
                "cast",
                "radio",
                "genres",
                "curation",
                "analytics",
                "lyrics",
            },
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
            include_tags={
                "enrichment",
                "artwork",
                "metadata",
                "imports",
                "scanner",
                "organizer",
                "matcher",
                "duplicates",
                "batch",
                "acquisition",
                "tidal",
                "bandcamp",
            },
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
            include_tags={
                "management",
                "settings",
                "tasks",
                "events",
                "stack",
                "setup",
                "admin",
                "admin-auth",
            },
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
        # Tauri desktop shell
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    # Docs lives on a fixed domain regardless of the operator's DOMAIN.
    allowed_origins += [
        "https://docs.cratemusic.app",
    ]
    allowed_origins += _extra_cors_origins()
    if is_dev:
        # Dev-only origins — Vite dev servers + dev subdomains
        allowed_origins += [
            f"https://docs.{domain}",
            "https://docs.dev.cratemusic.app",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:4173",
            "http://localhost:5178",
            "http://127.0.0.1:5178",
            "http://127.0.0.1:4173",
            "http://localhost:8585",
        ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=CORS_ALLOWED_METHODS,
        allow_headers=CORS_ALLOWED_HEADERS,
    )

    from crate.api.auth import AuthMiddleware
    from crate.api.cache_events import CacheInvalidationMiddleware
    from crate.api.metrics_middleware import MetricsMiddleware
    from crate.api.trace_middleware import (
        TraceMiddleware,
        install_trace_id_log_record_factory,
    )

    app.add_middleware(AuthMiddleware)
    app.add_middleware(CacheInvalidationMiddleware)
    app.add_middleware(MetricsMiddleware)
    install_trace_id_log_record_factory()
    app.add_middleware(TraceMiddleware)

    from crate.api.setup import router as setup_router
    from crate.api.auth import router as auth_router, admin_router as admin_auth_router
    from crate.api.media_access import router as media_access_router
    from crate.api.browse import router as browse_router
    from crate.api.tags import router as tags_router
    from crate.api.artist_research import router as artist_research_router
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
    from crate.api.management import (
        router as management_router,
        admin_router as management_admin_router,
    )
    from crate.api.settings import router as settings_router
    from crate.api.playlists import router as playlists_router
    from crate.api.offline import router as offline_router
    from crate.api.curation import router as curation_router
    from crate.api.system_playlists import router as system_playlists_router
    from crate.api.genres import router as genres_router
    from crate.api.tidal import router as tidal_router
    from crate.api.bandcamp import router as bandcamp_router
    from crate.api.acquisition import router as acquisition_router
    from crate.api.me import router as me_router
    from crate.api.playback_state import router as playback_state_router
    from crate.api.connect import router as connect_router
    from crate.api.connect_ws import router as connect_ws_router
    from crate.api.cast import router as cast_router
    from crate.api.share import router as share_router
    from crate.api.radio import router as radio_router
    from crate.api.lyrics import router as lyrics_router
    from crate.api.i18n import (
        admin_router as i18n_admin_router,
        router as i18n_router,
    )
    from crate.api.cache_events import router as cache_events_router
    from crate.api.social import router as social_router
    from crate.api.jam import router as jam_router
    from crate.api.subsonic import router as subsonic_router
    from crate.api.paths import router as paths_router
    from crate.api.admin_ops import router as admin_ops_router
    from crate.api.playback_admin import router as playback_admin_router
    from crate.api.playback_telemetry import router as playback_telemetry_router
    from crate.api.admin_federation import router as admin_federation_router
    from crate.api.admin_global_catalog import router as admin_global_catalog_router
    from crate.api.federation import (
        router as federation_router,
        well_known as federation_well_known,
    )
    from crate.api.federation_remote import router as federation_remote_router
    from crate.api.internal_federation import router as internal_federation_router
    from crate.api.catalog import router as catalog_router

    # Public well-known (no auth required)
    app.include_router(federation_well_known)

    # Auth + management + settings + enrichment BEFORE browse (browse has {name:path} catch-all)
    app.include_router(setup_router)
    app.include_router(auth_router)
    app.include_router(media_access_router)
    app.include_router(admin_auth_router)
    app.include_router(me_router)
    app.include_router(playback_state_router)
    app.include_router(connect_router)
    app.include_router(connect_ws_router)
    app.include_router(cast_router)
    app.include_router(share_router)
    app.include_router(offline_router)
    app.include_router(social_router)
    app.include_router(jam_router)
    app.include_router(radio_router)
    app.include_router(lyrics_router)
    app.include_router(i18n_router)
    app.include_router(i18n_admin_router)
    app.include_router(management_router)
    app.include_router(management_admin_router)
    app.include_router(settings_router)
    app.include_router(playlists_router)
    app.include_router(curation_router)
    app.include_router(system_playlists_router)
    app.include_router(genres_router)
    app.include_router(tidal_router)
    app.include_router(bandcamp_router)
    app.include_router(acquisition_router)
    app.include_router(enrichment_router)
    app.include_router(analytics_router)
    app.include_router(artwork_router)
    app.include_router(scanner_router)
    app.include_router(matcher_router)
    app.include_router(duplicates_router)
    app.include_router(subsonic_router)
    app.include_router(federation_router)
    app.include_router(internal_federation_router)
    app.include_router(federation_remote_router)
    app.include_router(catalog_router)
    app.include_router(artist_research_router)
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
    app.include_router(playback_admin_router)
    app.include_router(playback_telemetry_router)
    from crate.api.admin_metrics import router as admin_metrics_router

    app.include_router(admin_ops_router)
    app.include_router(admin_federation_router)
    app.include_router(admin_global_catalog_router)
    app.include_router(admin_metrics_router)

    # Static files
    base = Path(__file__).resolve().parent.parent
    static_dir = base / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app
