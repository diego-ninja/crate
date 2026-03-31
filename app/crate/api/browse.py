from fastapi import APIRouter

from crate.api.browse_album import router as album_router
from crate.api.browse_artist import router as artist_router
from crate.api.browse_media import router as media_router
from crate.api.browse_shared import find_album_dir as _find_album_dir

router = APIRouter()
router.include_router(artist_router)
router.include_router(album_router)
router.include_router(media_router)
