"""AudioMuse-AI API — read sonic analysis data for tracks."""

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth, _require_admin
from crate.api._deps import artist_name_from_id, album_names_from_id
from crate import audiomuse

log = logging.getLogger(__name__)
router = APIRouter()

AUDIOMUSE_DOMAIN = f"https://ai.{os.environ.get('DOMAIN', 'lespedants.org')}"




@router.get("/api/audiomuse/status")
def audiomuse_status(request: Request):
    _require_auth(request)
    config = audiomuse.ping()
    if not config:
        return {"available": False, "analyzed_tracks": 0, "url": AUDIOMUSE_DOMAIN}
    return {
        "available": True,
        "analyzed_tracks": audiomuse.get_analyzed_count(),
        "url": AUDIOMUSE_DOMAIN,
    }


@router.get("/api/audiomuse/tracks")
def audiomuse_track_data(request: Request, ids: str = ""):
    """Get analysis data for tracks by AudioMuse item IDs (comma-separated).
    Returns {item_id: {tempo, key, scale, energy, mood}} for analyzed tracks."""
    _require_auth(request)
    if not ids:
        return {}
    item_ids = [i.strip() for i in ids.split(",") if i.strip()]
    if not item_ids or len(item_ids) > 200:
        return {}
    return audiomuse.get_track_data_from_db(item_ids)


def audiomuse_artist_tracks(request: Request, artist_name: str):
    """Get analysis data for all tracks by an artist. Returns {title_lower: {tempo, key, scale, energy}}."""
    _require_auth(request)
    return audiomuse.get_track_data_by_titles(artist_name, [])


@router.get("/api/audiomuse/artists/{artist_id}/tracks")
def audiomuse_artist_tracks_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return audiomuse_artist_tracks(request, artist_name)


@router.get("/api/audiomuse/tasks")
def audiomuse_tasks(request: Request):
    _require_auth(request)
    result = audiomuse.get_active_tasks()
    if result is None:
        return JSONResponse({"error": "AudioMuse unavailable"}, status_code=502)
    return result


# ── Internal audio analysis (lightweight, no AudioMuse needed) ──

def analyze_artist(request: Request, name: str):
    """Queue audio analysis for all tracks by an artist."""
    _require_admin(request)
    from crate.db import create_task
    task_id = create_task("analyze_tracks", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.post("/api/artists/{artist_id}/analyze")
def analyze_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return analyze_artist(request, artist_name)


def analyze_album(request: Request, artist: str, album: str):
    """Queue audio analysis + bliss vectors for a single album."""
    _require_admin(request)
    from crate.db import create_task
    task_id = create_task("analyze_album_full", {"artist": artist, "album": album})
    return {"status": "queued", "task_id": task_id}


@router.post("/api/albums/{album_id}/analyze")
def analyze_album_by_id(request: Request, album_id: int):
    album_names = album_names_from_id(album_id)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return analyze_album(request, artist, album)


def enrich_album(request: Request, artist: str, album: str):
    """Full album re-enrichment: MBID lookup + cover art + popularity + audio analysis + bliss."""
    _require_admin(request)
    from crate.db import create_task_dedup
    task_id = create_task_dedup("process_new_content", {
        "artist": artist,
        "album_folder": album,
    })
    return {"status": "queued", "task_id": task_id}


@router.post("/api/albums/{album_id}/enrich")
def enrich_album_by_id(request: Request, album_id: int):
    album_names = album_names_from_id(album_id)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return enrich_album(request, artist, album)


def get_analysis_data(request: Request, name: str):
    """Get BPM/key/energy/mood data from our library_tracks table."""
    _require_auth(request)
    from crate.db import get_db_ctx
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


@router.get("/api/artists/{artist_id}/analysis-data")
def get_analysis_data_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return get_analysis_data(request, artist_name)
