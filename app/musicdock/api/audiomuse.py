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


@router.get("/api/audiomuse/artist/{artist_name}/tracks")
def audiomuse_artist_tracks(artist_name: str):
    """Get analysis data for all tracks by an artist. Returns {title_lower: {tempo, key, scale, energy}}."""
    return audiomuse.get_track_data_by_titles(artist_name, [])


@router.get("/api/audiomuse/tasks")
def audiomuse_tasks():
    result = audiomuse.get_active_tasks()
    if result is None:
        return JSONResponse({"error": "AudioMuse unavailable"}, status_code=502)
    return result


# ── Internal audio analysis (lightweight, no AudioMuse needed) ──

@router.post("/api/analyze/artist/{name}")
def analyze_artist(name: str):
    """Queue audio analysis for all tracks by an artist."""
    from musicdock.db import create_task
    task_id = create_task("analyze_tracks", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.post("/api/analyze/album/{artist}/{album}")
def analyze_album(artist: str, album: str):
    """Queue audio analysis for a single album."""
    from musicdock.db import create_task
    task_id = create_task("analyze_tracks", {"artist": artist, "album": album})
    return {"status": "queued", "task_id": task_id}


@router.get("/api/analyze/artist/{name}/data")
def get_analysis_data(name: str):
    """Get BPM/key/energy/mood data from our library_tracks table."""
    from musicdock.db import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT title, bpm, audio_key, audio_scale, energy, mood_json, "
            "danceability, valence, acousticness, instrumentalness, "
            "loudness, dynamic_range, spectral_complexity "
            "FROM library_tracks "
            "WHERE artist ILIKE %s AND bpm IS NOT NULL",
            (name,),
        )
        rows = cur.fetchall()

    result = {}
    for r in rows:
        mood = r["mood_json"]
        result[r["title"].lower() if r["title"] else ""] = {
            "tempo": round(r["bpm"]) if r["bpm"] else None,
            "key": r["audio_key"],
            "scale": r["audio_scale"],
            "energy": round(r["energy"], 2) if r["energy"] else None,
            "mood": mood,
            "danceability": r["danceability"],
            "valence": r["valence"],
            "acousticness": r["acousticness"],
            "instrumentalness": r["instrumentalness"],
            "loudness": r["loudness"],
            "dynamic_range": r["dynamic_range"],
            "spectral_complexity": r["spectral_complexity"],
        }
    return result
