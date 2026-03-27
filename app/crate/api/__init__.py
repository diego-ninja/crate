import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

from crate.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Scheduled tasks are managed by the worker process — no task creation here
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="MusicDock", lifespan=lifespan)

    domain = os.environ.get("DOMAIN", "localhost")
    allowed_origins = [
        f"https://admin.{domain}",
        f"https://{domain}",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8585",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from crate.api.auth import AuthMiddleware
    app.add_middleware(AuthMiddleware)

    from crate.api.setup import router as setup_router
    from crate.api.auth import router as auth_router
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
    from crate.api.pages import router as pages_router
    from crate.api.navidrome import router as navidrome_router
    from crate.api.stack import router as stack_router
    from crate.api.audiomuse import router as audiomuse_router
    from crate.api.enrichment import router as enrichment_router
    from crate.api.management import router as management_router
    from crate.api.settings import router as settings_router
    from crate.api.playlists import router as playlists_router
    from crate.api.genres import router as genres_router
    from crate.api.tidal import router as tidal_router
    from crate.api.acquisition import router as acquisition_router

    # Auth + management + settings + enrichment + audiomuse BEFORE browse (browse has {name:path} catch-all)
    app.include_router(setup_router)
    app.include_router(auth_router)
    app.include_router(management_router)
    app.include_router(settings_router)
    app.include_router(playlists_router)
    app.include_router(genres_router)
    app.include_router(tidal_router)
    app.include_router(acquisition_router)
    app.include_router(enrichment_router)
    app.include_router(audiomuse_router)
    app.include_router(navidrome_router)
    app.include_router(analytics_router)
    app.include_router(artwork_router)
    app.include_router(scanner_router)
    app.include_router(matcher_router)
    app.include_router(duplicates_router)
    app.include_router(browse_router)
    app.include_router(tags_router)
    app.include_router(organizer_router)
    app.include_router(imports_router)
    app.include_router(batch_router)
    app.include_router(events_router)
    app.include_router(tasks_router)
    app.include_router(pages_router)
    app.include_router(stack_router)

    # Static files and templates
    base = Path(__file__).resolve().parent.parent
    static_dir = base / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app
