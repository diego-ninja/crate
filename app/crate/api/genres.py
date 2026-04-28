from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth, _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.genres import (
    EqPresetUpdateResponse,
    GenreDetailResponse,
    GenreGraphResponse,
    GenreSummaryResponse,
    GenreTaxonomyInvalidStatusResponse,
    GenreTaxonomyTreeResponse,
)
from crate.api.schemas.common import TaskEnqueueResponse
from crate.db.genres import (
    get_all_genres,
    get_genre_detail,
    get_genre_graph,
    get_genre_taxonomy_node_id,
    get_unmapped_genres,
    list_invalid_genre_taxonomy_nodes,
    set_genre_eq_gains,
)
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache, resolve_genre_eq_preset

router = APIRouter(prefix="/api/genres", tags=["genres"])

_GENRE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested genre could not be found."),
    },
)

_GENRE_ADMIN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request payload could not be processed."),
        404: error_response("The requested genre could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


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


@router.get(
    "",
    response_model=list[GenreSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List genres in the library",
)
def list_genres(request: Request):
    _require_auth(request)
    return get_all_genres()


@router.get(
    "/unmapped",
    response_model=list[GenreSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List unmapped raw library genres",
)
def list_unmapped_genres(request: Request, limit: int = Query(24, ge=1, le=200)):
    _require_auth(request)
    return get_unmapped_genres(limit=limit)


@router.get(
    "/taxonomy/invalid",
    response_model=GenreTaxonomyInvalidStatusResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Inspect invalid genre taxonomy nodes",
)
def get_invalid_taxonomy_nodes(request: Request, limit: int = Query(8, ge=1, le=50)):
    _require_admin(request)
    items = list_invalid_genre_taxonomy_nodes()
    return {
        "invalid_count": len(items),
        "alias_count": sum(int(item.get("alias_count") or 0) for item in items),
        "edge_count": sum(int(item.get("edge_count") or 0) for item in items),
        "items": items[:limit],
    }


@router.get(
    "/taxonomy/tree",
    response_model=GenreTaxonomyTreeResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Full taxonomy tree with parent/children refs, EQ preset status, and counts",
)
def taxonomy_tree(request: Request):
    _require_auth(request)
    from crate.genre_taxonomy import get_genre_catalog, resolve_genre_eq_preset
    from crate.db.genres import get_all_genres

    catalog = get_genre_catalog()
    genre_list = get_all_genres()
    counts: dict[str, dict[str, int]] = {}
    mbids: dict[str, str | None] = {}
    wikidata_urls: dict[str, str | None] = {}
    for g in genre_list:
        cs = g.get("canonical_slug")
        if cs:
            existing = counts.get(cs, {"artist_count": 0, "album_count": 0})
            existing["artist_count"] += g.get("artist_count") or 0
            existing["album_count"] += g.get("album_count") or 0
            counts[cs] = existing
            if g.get("musicbrainz_mbid"):
                mbids[cs] = g["musicbrainz_mbid"]
            if g.get("wikidata_url"):
                wikidata_urls[cs] = g["wikidata_url"]

    nodes = []
    top_level_slugs = []
    for slug, meta in catalog.items():
        preset = resolve_genre_eq_preset(slug)
        c = counts.get(slug, {"artist_count": 0, "album_count": 0})
        children = sorted(
            s for s, m in catalog.items()
            if slug in m.get("parents", [])
        )
        node = {
            "slug": slug,
            "name": meta["name"],
            "description": meta.get("description") or None,
            "musicbrainz_mbid": mbids.get(slug),
            "wikidata_url": wikidata_urls.get(slug),
            "top_level": meta.get("top_level", False),
            "parent_slugs": meta.get("parents", []),
            "children_slugs": children,
            "alias_names": meta.get("aliases", []),
            "artist_count": c["artist_count"],
            "album_count": c["album_count"],
            "eq_gains": list(preset["gains"]) if preset else None,
            "eq_preset_source": preset["source"] if preset else None,
            "eq_preset_inherited_from": preset.get("slug") if preset and preset["source"] == "inherited" else None,
        }
        nodes.append(node)
        if meta.get("top_level", False):
            top_level_slugs.append(slug)

    return {"nodes": nodes, "top_level_slugs": sorted(top_level_slugs)}


@router.get(
    "/{slug}/graph",
    response_model=GenreGraphResponse,
    responses=_GENRE_RESPONSES,
    summary="Get the genre taxonomy graph for a genre",
)
def genre_graph(request: Request, slug: str):
    _require_auth(request)
    graph = get_genre_graph(slug)
    if not graph:
        raise HTTPException(status_code=404, detail="Genre not found")
    return graph


@router.get(
    "/{slug}",
    response_model=GenreDetailResponse,
    responses=_GENRE_RESPONSES,
    summary="Get detailed genre information",
)
def genre_detail(request: Request, slug: str):
    _require_auth(request)
    genre = get_genre_detail(slug)
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    return genre


@router.post(
    "/index",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue a full genre index rebuild",
)
def reindex_genres(request: Request):
    _require_admin(request)
    task_id = create_task("index_genres")
    return {"task_id": task_id}


@router.post(
    "/infer",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue genre taxonomy inference",
)
def infer_genre_taxonomy(request: Request, body: InferTaxonomyBody = InferTaxonomyBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("infer_genre_taxonomy", {
        "limit": body.limit,
        "focus_slug": slug,
        "include_external": body.include_external,
        "aggressive": body.aggressive,
    })


@router.post(
    "/descriptions/enrich",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue genre description enrichment",
)
def enrich_genre_descriptions(request: Request, body: EnrichDescriptionsBody = EnrichDescriptionsBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("enrich_genre_descriptions", {
        "limit": body.limit,
        "focus_slug": slug,
        "force": body.force,
    })


@router.post(
    "/musicbrainz/sync",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue MusicBrainz genre graph sync",
)
def sync_musicbrainz_genre_graph(request: Request, body: MusicBrainzSyncBody = MusicBrainzSyncBody()):
    _require_admin(request)
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task("sync_musicbrainz_genre_graph", {
        "limit": body.limit,
        "focus_slug": slug,
        "force": body.force,
    })


@router.post(
    "/taxonomy/cleanup-invalid",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue cleanup of invalid genre taxonomy nodes",
)
def cleanup_invalid_taxonomy_nodes(request: Request):
    _require_admin(request)
    return _get_or_create_task("cleanup_invalid_genre_taxonomy", {})


@router.patch(
    "/{slug}/eq-preset",
    response_model=EqPresetUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Update the EQ preset for a canonical genre",
)
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

    node_id = get_genre_taxonomy_node_id(canonical_slug)
    if not node_id:
        raise HTTPException(status_code=404, detail="Canonical genre not found")
    set_genre_eq_gains(canonical_slug, gains_param)

    # Drop the cached graph so the next resolver call picks up the new
    # gains (or NULL → inheritance).
    invalidate_runtime_taxonomy_cache(broadcast=True)

    resolved = resolve_genre_eq_preset(canonical_slug)
    return {
        "slug": canonical_slug,
        "eq_gains": gains_param,
        "eq_preset_resolved": resolved,
    }


@router.post(
    "/{slug}/generate-eq",
    responses=_GENRE_RESPONSES,
    summary="Generate an EQ preset for a genre using AI",
)
def generate_genre_eq(request: Request, slug: str, apply: bool = Query(False, description="Auto-apply the generated preset")):
    """Use the configured LLM to generate a 10-band EQ preset for a genre."""
    _require_admin(request)

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")

    node_id = get_genre_taxonomy_node_id(canonical_slug)
    if not node_id:
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")

    # Get genre detail for context
    detail = get_genre_detail(canonical_slug)
    description = detail.get("description") if detail else None
    parent_slugs = detail.get("parent_slugs", []) if detail else []

    try:
        from crate.llm.prompts.eq_preset import generate_eq_preset
        result = generate_eq_preset(
            genre_name=canonical_slug.replace("-", " ").title(),
            description=description,
            parent_genres=[s.replace("-", " ").title() for s in parent_slugs[:3]],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    gains = [max(-12.0, min(12.0, round(g, 1))) for g in result.gains]

    if apply:
        set_genre_eq_gains(canonical_slug, gains, reasoning=result.reasoning)
        invalidate_runtime_taxonomy_cache(broadcast=True)

    return {
        "slug": canonical_slug,
        "gains": gains,
        "reasoning": result.reasoning,
        "applied": apply,
    }
