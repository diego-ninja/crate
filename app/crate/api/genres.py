from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth, _require_admin
from crate.db import create_task, get_all_genres, get_genre_detail, get_genre_graph, get_unmapped_genres, list_tasks
from crate.db.core import get_db_ctx
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache, resolve_genre_eq_preset

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


# 10-band EQ contract, matches the frontend EQ_BANDS + EQ_GAIN_MIN/MAX.
_EQ_BAND_COUNT = 10
_EQ_GAIN_MIN = -12.0
_EQ_GAIN_MAX = 12.0


class EqPresetBody(BaseModel):
    # None = clear the preset (the node will inherit from its first
    # ancestor that has one). Array must be exactly 10 floats.
    gains: list[float] | None = Field(default=None)


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


@router.patch("/{slug}/eq-preset")
def update_genre_eq_preset(request: Request, slug: str, body: EqPresetBody):
    """Set or clear the EQ preset for a canonical genre.

    Passing ``gains: null`` drops the row's eq_gains back to NULL, making
    it inherit from its first ancestor that has a preset. Otherwise the
    array must have exactly 10 floats; values are clamped to
    [EQ_GAIN_MIN, EQ_GAIN_MAX].
    """
    _require_admin(request)

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")

    gains_param: list[float] | None = None
    if body.gains is not None:
        if len(body.gains) != _EQ_BAND_COUNT:
            raise HTTPException(
                status_code=400,
                detail=f"gains must have exactly {_EQ_BAND_COUNT} entries",
            )
        clamped: list[float] = []
        for value in body.gains:
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="gains must be numeric")
            if numeric != numeric:  # NaN guard
                raise HTTPException(status_code=400, detail="gains must be finite")
            clamped.append(max(_EQ_GAIN_MIN, min(_EQ_GAIN_MAX, numeric)))
        gains_param = clamped

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id FROM genre_taxonomy_nodes WHERE slug = %s",
            (canonical_slug,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Canonical genre not found")
        cur.execute(
            "UPDATE genre_taxonomy_nodes SET eq_gains = %s WHERE slug = %s",
            (gains_param, canonical_slug),
        )

    # Drop the cached graph so the next resolver call picks up the new
    # gains (or NULL → inheritance).
    invalidate_runtime_taxonomy_cache()

    resolved = resolve_genre_eq_preset(canonical_slug)
    return {
        "slug": canonical_slug,
        "eq_gains": gains_param,
        "eq_preset_resolved": resolved,
    }
