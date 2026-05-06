from fastapi import APIRouter, Request

from crate.api.auth import _require_auth
from crate.api.browse_album import router as album_router
from crate.api.browse_artist import api_browse_filters, router as artist_router
from crate.api.browse_media import api_browse_moods, router as media_router
from crate.api.browse_shared import find_album_dir as _find_album_dir
from crate.api.curation import curated_playlists
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import BrowseExplorePageResponse
from crate.db.cache_store import get_cache, set_cache

router = APIRouter()
router.include_router(artist_router)
router.include_router(album_router)
router.include_router(media_router)

_EXPLORE_PAGE_CACHE_TTL_SECONDS = 60


@router.get(
    "/api/browse/explore-page",
    response_model=BrowseExplorePageResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the bundled Explore page payload",
)
def api_browse_explore_page(request: Request):
    user = _require_auth(request)
    cache_key = f"listen:explore_page:v1:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=_EXPLORE_PAGE_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    payload = {
        "filters": api_browse_filters(request),
        "playlists": curated_playlists(request)[:8],
        "moods": api_browse_moods(request),
    }
    set_cache(cache_key, payload, ttl=_EXPLORE_PAGE_CACHE_TTL_SECONDS)
    return payload
