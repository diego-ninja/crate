"""AudioMuse-AI API — read sonic analysis data for tracks."""

import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock import audiomuse

log = logging.getLogger(__name__)
router = APIRouter()

AUDIOMUSE_DOMAIN = f"https://ai.{os.environ.get('DOMAIN', 'lespedants.org')}"


@router.get("/api/audiomuse/status")
def audiomuse_status():
    config = audiomuse.ping()
    if not config:
        return {"available": False, "analyzed_tracks": 0, "url": AUDIOMUSE_DOMAIN}
    return {
        "available": True,
        "analyzed_tracks": audiomuse.get_analyzed_count(),
        "url": AUDIOMUSE_DOMAIN,
    }


@router.get("/api/audiomuse/tracks")
def audiomuse_track_data(ids: str = ""):
    """Get analysis data for tracks by Navidrome song IDs (comma-separated).
    Returns {item_id: {tempo, key, scale, energy, mood}} for analyzed tracks."""
    if not ids:
        return {}
    item_ids = [i.strip() for i in ids.split(",") if i.strip()]
    if not item_ids or len(item_ids) > 200:
        return {}
    return audiomuse.get_track_data_from_db(item_ids)


@router.get("/api/audiomuse/tasks")
def audiomuse_tasks():
    result = audiomuse.get_active_tasks()
    if result is None:
        return JSONResponse({"error": "AudioMuse unavailable"}, status_code=502)
    return result
