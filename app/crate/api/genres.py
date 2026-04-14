from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth, _require_admin
from crate.db import create_task, get_all_genres, get_genre_detail, get_genre_graph, get_unmapped_genres, list_tasks

router = APIRouter(prefix="/api/genres", tags=["genres"])


def _get_or_create_task(task_type: str, params: dict, max_limit: int = 500) -> dict:
    """Dedup: return existing pending/running task or create a new one."""
    for status in ("running", "pending"):
        existing = list_tasks(status=status, task_type=task_type, limit=1)
        if existing:
            return {"task_id": existing[0]["id"], "status": existing[0]["status"], "deduplicated": True}
    task_id = create_task(task_type, params)
    return {"task_id": task_id, "status": "queued", "deduplicated": False}


class InferTaxonomyBody(BaseModel):
    limit: int = Field(200, ge=1, le=500)
    focus_slug: str | None = None
    include_external: bool = True
    aggressive: bool = True


class EnrichDescriptionsBody(BaseModel):
    limit: int = Field(120, ge=1, le=500)
    focus_slug: str | None = None
    force: bool = False


class MusicBrainzSyncBody(BaseModel):
    limit: int = Field(80, ge=1, le=300)
    focus_slug: str | None = None
    force: bool = False


@router.get("")
def list_genres(request: Request):
    _require_auth(request)
    return get_all_genres()


@router.get("/unmapped")
def list_unmapped_genres(request: Request, limit: int = Query(24, ge=1, le=200)):
    _require_auth(request)
    return get_unmapped_genres(limit=limit)


@router.get("/{slug}/graph")
def genre_graph(request: Request, slug: str):
    _require_auth(request)
    graph = get_genre_graph(slug)
    if not graph:
        raise HTTPException(status_code=404, detail="Genre not found")
    return graph


@router.get("/{slug}")
def genre_detail(request: Request, slug: str):
    _require_auth(request)
    genre = get_genre_detail(slug)
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    return genre


@router.post("/index")
def reindex_genres(request: Request):
    _require_admin(request)
    task_id = create_task("index_genres")
    return {"task_id": task_id}


@router.post("/infer")
def infer_genre_taxonomy(request: Request, body: InferTaxonomyBody = InferTaxonomyBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("infer_genre_taxonomy", {
        "limit": body.limit,
        "focus_slug": slug,
        "include_external": body.include_external,
        "aggressive": body.aggressive,
    })


@router.post("/descriptions/enrich")
def enrich_genre_descriptions(request: Request, body: EnrichDescriptionsBody = EnrichDescriptionsBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("enrich_genre_descriptions", {
        "limit": body.limit,
        "focus_slug": slug,
        "force": body.force,
    })


@router.post("/musicbrainz/sync")
def sync_musicbrainz_genre_graph(request: Request, body: MusicBrainzSyncBody = MusicBrainzSyncBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("sync_musicbrainz_genre_graph", {
        "limit": body.limit,
        "focus_slug": slug,
        "force": body.force,
    })
