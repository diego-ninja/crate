from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.utility import LyricsResponse
from crate.lyrics import get_or_fetch_lyrics

router = APIRouter(tags=["lyrics"])

_LYRICS_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("artist and title are required."),
    },
)


@router.get(
    "/api/lyrics",
    response_model=LyricsResponse,
    responses=_LYRICS_RESPONSES,
    summary="Fetch cached or live lyrics for a track",
)
def api_lyrics(request: Request, artist: str = Query(""), title: str = Query("")):
    _require_auth(request)
    if not artist.strip() or not title.strip():
        raise HTTPException(status_code=400, detail="artist and title required")

    return get_or_fetch_lyrics(artist, title)
