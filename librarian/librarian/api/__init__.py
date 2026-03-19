from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

from librarian.db import init_db, get_cache, create_task, list_tasks
from librarian.api._deps import library_path


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Pre-compute analytics/stats if cache is empty and no compute task is running
    if not get_cache("analytics") and not list_tasks(status="running", task_type="compute_analytics", limit=1) and not list_tasks(status="pending", task_type="compute_analytics", limit=1):
        create_task("compute_analytics")
    # Trigger Last.fm enrichment if coverage is below 80%
    _maybe_trigger_enrichment()
    yield


def _maybe_trigger_enrichment():
    try:
        lib = library_path()
        artist_dirs = [d for d in lib.iterdir() if d.is_dir() and not d.name.startswith(".") and not d.name.startswith("_")]
        total = len(artist_dirs)
        if total == 0:
            return
        cached_count = sum(
            1 for d in artist_dirs
            if get_cache(f"lastfm:artist:{d.name.lower()}", max_age_seconds=86400)
        )
        if cached_count < total * 0.8:
            pending = list_tasks(status="pending", task_type="enrich_artists", limit=1)
            running = list_tasks(status="running", task_type="enrich_artists", limit=1)
            if not pending and not running:
                create_task("enrich_artists")
    except Exception:
        pass


def create_app() -> FastAPI:
    app = FastAPI(title="MusicDock Librarian", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from librarian.api.browse import router as browse_router
    from librarian.api.tags import router as tags_router
    from librarian.api.scanner import router as scanner_router
    from librarian.api.matcher import router as matcher_router
    from librarian.api.duplicates import router as duplicates_router
    from librarian.api.artwork import router as artwork_router
    from librarian.api.organizer import router as organizer_router
    from librarian.api.imports import router as imports_router
    from librarian.api.batch import router as batch_router
    from librarian.api.analytics import router as analytics_router
    from librarian.api.events import router as events_router
    from librarian.api.tasks import router as tasks_router
    from librarian.api.pages import router as pages_router
    from librarian.api.navidrome import router as navidrome_router
    from librarian.api.stack import router as stack_router
    from librarian.api.audiomuse import router as audiomuse_router

    app.include_router(browse_router)
    app.include_router(tags_router)
    app.include_router(scanner_router)
    app.include_router(matcher_router)
    app.include_router(duplicates_router)
    app.include_router(artwork_router)
    app.include_router(organizer_router)
    app.include_router(imports_router)
    app.include_router(batch_router)
    app.include_router(analytics_router)
    app.include_router(events_router)
    app.include_router(tasks_router)
    app.include_router(pages_router)
    app.include_router(navidrome_router)
    app.include_router(stack_router)
    app.include_router(audiomuse_router)

    # Static files and templates
    base = Path(__file__).resolve().parent.parent
    static_dir = base / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app
