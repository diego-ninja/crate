from fastapi import APIRouter, Request

from crate.api.auth import _require_auth
from crate.api.browse_album import router as album_router
from crate.api.browse_artist import api_browse_filters, router as artist_router
from crate.api.browse_media import api_browse_moods, router as media_router
from crate.api.browse_shared import find_album_dir as _find_album_dir
from crate.api.curation import curated_playlists
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import BrowseExplorePageResponse

router = APIRouter()
router.include_router(artist_router)
router.include_router(album_router)
router.include_router(media_router)


@router.get(
    "/api/browse/explore-page",
    response_model=BrowseExplorePageResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the bundled Explore page payload",
)
def api_browse_explore_page(request: Request):
    _require_auth(request)
    return {
        "filters": api_browse_filters(request),
        "playlists": curated_playlists(request)[:8],
        "moods": api_browse_moods(request),
    }
