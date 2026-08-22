from __future__ import annotations

from collections.abc import Mapping

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.artist_bio_research import (
    configured_web_search_providers,
    web_search_provider_label,
)
from crate.db.repositories.library import (
    get_library_artist_by_entity_uid,
    get_library_artist_by_id,
)
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)

router = APIRouter(tags=["artist-research"])

_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested artist was not found."),
        409: error_response("Research is already running."),
    },
)


class ArtistBioResearchRequest(BaseModel):
    language: str = Field(default="English", min_length=2, max_length=40)


def _queue_research(
    request: Request, artist: Mapping[str, object], body: ArtistBioResearchRequest
):
    require_permission(request, "library.metadata.write")
    identity = str(artist.get("entity_uid") or artist.get("id") or artist.get("name"))
    dedup_key = f"artist-bio-research:{identity}"
    params = {
        "artist_id": artist.get("id"),
        "artist_entity_uid": artist.get("entity_uid"),
        "artist_name": artist.get("name"),
        "language": body.language.strip() or "English",
    }
    task_id = create_task_dedup("research_artist_bio", params, dedup_key=dedup_key)
    if task_id is None:
        task_id = find_active_task_by_type_params(
            "research_artist_bio", dedup_key=dedup_key
        )
    if task_id is None:
        raise HTTPException(status_code=409, detail="Research is already running")
    return {"task_id": task_id}


@router.post(
    "/api/artists/by-entity/{artist_entity_uid}/bio/research",
    response_model=TaskEnqueueResponse,
    responses=_RESPONSES,
    summary="Research an artist biography using internet sources and AI",
)
def research_artist_bio_by_entity(
    request: Request,
    artist_entity_uid: str,
    body: ArtistBioResearchRequest | None = None,
):
    artist = get_library_artist_by_entity_uid(artist_entity_uid)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")
    return _queue_research(request, artist, body or ArtistBioResearchRequest())


@router.post(
    "/api/artists/{artist_id}/bio/research",
    response_model=TaskEnqueueResponse,
    responses=_RESPONSES,
    summary="Research an artist biography using internet sources and AI",
)
def research_artist_bio_by_id(
    request: Request, artist_id: int, body: ArtistBioResearchRequest | None = None
):
    artist = get_library_artist_by_id(artist_id)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")
    return _queue_research(request, artist, body or ArtistBioResearchRequest())


@router.get(
    "/api/admin/artist-bio-research/status",
    responses=AUTH_ERROR_RESPONSES,
    summary="Check artist biography research availability",
)
def artist_bio_research_status(request: Request):
    require_permission(request, "library.metadata.write")
    providers = configured_web_search_providers()
    return {
        "available": True,
        "sources": ["MusicBrainz", "Wikipedia", "Last.fm", "official URLs"],
        "web_search_provider": web_search_provider_label() if providers else None,
        "web_search_providers": providers,
    }
