import logging
import math
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from starlette.background import BackgroundTask

from crate.api._deps import enrich_radio_tracks as _enrich_radio_tracks, library_path, safe_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import fs_search, has_library_data
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import OkResponse
from crate.api.schemas.media import (
    DiscoverCompletenessRefreshResponse,
    DiscoverCompletenessResponse,
    EqFeaturesResponse,
    FavoriteMutationRequest,
    FavoritesResponse,
    MoodPresetsResponse,
    MoodTracksResponse,
    PlaybackPrepareRequest,
    PlaybackPrepareResponse,
    PlaybackResolutionResponse,
    SearchResponse,
    SimilarTracksResponse,
    TrackGenreResponse,
    TrackInfoResponse,
    TrackRatingRequest,
    TrackRatingResponse,
)
from crate.db.cache_store import get_cache, set_cache
from crate.db.repositories.library import set_track_rating
from crate.db.queries.browse_media import (
    add_favorite,
    count_mood_presets,
    find_track_id_by_path,
    get_mood_tracks,
    get_track_album_genres,
    get_track_artist_genres,
    get_track_exists,
    get_track_id_by_entity_uid,
    get_track_info_cols,
    get_track_info_cols_by_entity_uid,
    get_track_info_cols_by_path,
    get_track_path,
    get_track_path_by_entity_uid,
    list_favorites,
    remove_favorite,
    search_albums,
    search_artists,
    search_tracks,
)
from crate.db.queries.browse_media_track_lookup import get_track_info_cols_by_storage_id
from crate.db.repositories.tasks import create_task_dedup
from crate.audio import read_audio_quality
from crate.streaming.paths import resolve_data_file
from crate.db.repositories.streaming import (
    get_variant_by_id,
    get_track_delivery_row_by_entity_uid,
    get_track_delivery_row_by_id,
    get_track_delivery_row_by_path,
    mark_variant_missing,
)
from crate.streaming.policy import normalize_policy
from crate.streaming.service import media_type_for_path, resolution_to_payload, resolve_playback

log = logging.getLogger(__name__)

router = APIRouter(tags=["browse"])

_BROWSE_MEDIA_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested media resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_STREAM_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary audio stream response.",
            "content": {
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/mp4": {"schema": {"type": "string", "format": "binary"}},
                "audio/ogg": {"schema": {"type": "string", "format": "binary"}},
                "audio/opus": {"schema": {"type": "string", "format": "binary"}},
                "audio/wav": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: error_response("The requested track stream could not be found."),
    },
)

_DOWNLOAD_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary file download response.",
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: error_response("The requested download could not be found."),
    },
)


@router.get(
    "/api/search",
    response_model=SearchResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Search artists, albums, and tracks",
)
def api_search(request: Request, q: str = "", limit: int = 20):
    _require_auth(request)
    q_stripped = q.strip()
    capped_limit = max(1, min(limit, 50))
    if len(q_stripped) < 2:
        return {"artists": [], "albums": [], "tracks": []}

    cache_key = f"listen:search:v1:{q_stripped.lower()}:{capped_limit}"
    cached = get_cache(cache_key, max_age_seconds=30)
    if cached is not None:
        return cached

    if not has_library_data():
        result = fs_search(q_stripped)
        result["tracks"] = []
        set_cache(cache_key, result, ttl=45)
        return result

    like = f"%{q_stripped}%"
    artist_rows = search_artists(like, capped_limit)
    album_rows = search_albums(like, capped_limit)
    track_rows = search_tracks(like, capped_limit)

    artists = [
        {
            "id": row["id"],
            "entity_uid": row.get("entity_uid"),
            "slug": row.get("slug"),
            "name": row["name"],
            "album_count": row.get("album_count", 0),
            "has_photo": bool(row.get("has_photo")),
        }
        for row in artist_rows
    ]
    albums = [
        {
            "id": row["id"],
            "entity_uid": row.get("entity_uid"),
            "slug": row.get("slug"),
            "artist": row["artist"],
            "artist_id": row.get("artist_id"),
            "artist_entity_uid": row.get("artist_entity_uid"),
            "artist_slug": row.get("artist_slug"),
            "name": row["name"],
            "year": row.get("year") or "",
            "has_cover": bool(row.get("has_cover")),
        }
        for row in album_rows
    ]
    tracks = [
        {
            "id": row["id"],
            "entity_uid": entity_uid,
            "slug": row.get("slug"),
            "title": row["title"],
            "artist": row["artist"],
            "artist_id": row.get("artist_id"),
            "artist_entity_uid": row.get("artist_entity_uid"),
            "artist_slug": row.get("artist_slug"),
            "album_id": row.get("album_id"),
            "album_entity_uid": row.get("album_entity_uid"),
            "album_slug": row.get("album_slug"),
            "album": row["album"],
            "path": row["path"],
            "duration": row["duration"],
        }
        for row in track_rows
        for entity_uid in [str(row["entity_uid"]) if row.get("entity_uid") is not None else None]
    ]
    payload = {"artists": artists, "albums": albums, "tracks": tracks}
    set_cache(cache_key, payload, ttl=45)
    return payload


@router.get(
    "/api/favorites",
    response_model=FavoritesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List favorite artists, albums, and tracks",
)
def api_favorites_list(request: Request):
    _require_auth(request)
    return {"items": list_favorites()}


@router.post(
    "/api/favorites/add",
    response_model=OkResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Add an item to favorites",
)
def api_favorites_add(request: Request, body: FavoriteMutationRequest):
    _require_auth(request)
    from datetime import datetime, timezone

    item_id = body.item_id
    item_type = body.type
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    if item_type not in ("song", "album", "artist"):
        raise HTTPException(status_code=400, detail="type must be song, album, or artist")

    now = datetime.now(timezone.utc).isoformat()
    add_favorite(item_type, item_id, now)

    return {"ok": True}


@router.post(
    "/api/favorites/remove",
    response_model=OkResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Remove an item from favorites",
)
def api_favorites_remove(request: Request, body: FavoriteMutationRequest):
    _require_auth(request)
    item_id = body.item_id
    item_type = body.type
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    if item_type not in ("song", "album", "artist"):
        raise HTTPException(status_code=400, detail="type must be song, album, or artist")

    remove_favorite(item_type, item_id)

    return {"ok": True}


@router.post(
    "/api/track/rate",
    response_model=TrackRatingResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Set a rating for a track",
)
def api_rate_track(request: Request, body: TrackRatingRequest):
    _require_auth(request)

    rating = body.rating
    track_id = body.track_id
    track_path = body.path

    if not isinstance(rating, int) or not 0 <= rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be 0-5")

    if not track_id and track_path:
        track_id = find_track_id_by_path(track_path)

    if not track_id:
        raise HTTPException(status_code=404, detail="Track not found")

    set_track_rating(track_id, rating)
    return {"ok": True, "rating": rating}


_TRACK_INFO_QUERY_COLS = (
    "entity_uid, title, artist, album, format, bitrate, sample_rate, bit_depth, "
    "bpm, audio_key, audio_scale, energy, "
    "danceability, valence, acousticness, instrumentalness, loudness, "
    "dynamic_range, mood_json, bliss_vector, lastfm_listeners, lastfm_playcount, popularity, rating"
)


def _derive_bliss_signature(bliss_vector) -> dict[str, float] | None:
    if not isinstance(bliss_vector, (list, tuple)) or not bliss_vector:
        return None

    values: list[float] = []
    for value in bliss_vector:
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            continue

    if not values:
        return None

    mean_abs = sum(abs(value) for value in values) / len(values)
    density_raw = math.sqrt(sum(value * value for value in values) / len(values))
    diffs = [abs(values[i] - values[i - 1]) for i in range(1, len(values))]
    texture_raw = sum(diffs) / len(diffs) if diffs else 0.0
    half = max(1, len(values) // 2)
    front = sum(values[:half]) / half
    back = sum(values[half:]) / max(1, len(values) - half)
    motion_raw = abs(back - front)

    return {
        "texture": round(math.tanh(texture_raw * 1.35), 3),
        "motion": round(math.tanh((motion_raw + mean_abs * 0.35) * 1.55), 3),
        "density": round(math.tanh((density_raw * 0.9 + mean_abs * 0.5) * 1.2), 3),
    }


def _serialize_track_info_row(row) -> dict:
    payload = dict(row)
    raw_path = str(payload.get("path") or "")
    if raw_path and (
        payload.get("bitrate") in (None, 0)
        or payload.get("sample_rate") in (None, 0)
        or payload.get("bit_depth") in (None, 0)
    ):
        lib = library_path()
        relative = raw_path
        lib_str = str(lib)
        if relative.startswith(lib_str):
            relative = relative[len(lib_str):].lstrip("/")
        elif relative.startswith("/music/"):
            relative = relative[len("/music/"):].lstrip("/")
        resolved = safe_path(lib, relative)
        if resolved and resolved.is_file():
            quality = read_audio_quality(resolved)
            if payload.get("bitrate") in (None, 0) and quality.get("bitrate") is not None:
                payload["bitrate"] = quality["bitrate"]
            if payload.get("sample_rate") in (None, 0) and quality.get("sample_rate") is not None:
                payload["sample_rate"] = quality["sample_rate"]
            if payload.get("bit_depth") in (None, 0) and quality.get("bit_depth") is not None:
                payload["bit_depth"] = quality["bit_depth"]
    if payload.get("entity_uid") is not None:
        payload["entity_uid"] = str(payload["entity_uid"])
        payload.pop("storage_id", None)
    bliss_vector = payload.pop("bliss_vector", None)
    payload["bliss_signature"] = _derive_bliss_signature(bliss_vector)
    return payload


def _get_track_info_cols_via_storage_alias(storage_id: str, cols: str) -> dict | None:
    row = get_track_info_cols_by_storage_id(storage_id, cols)
    if not row:
        return None
    entity_uid = str(row["entity_uid"]) if row.get("entity_uid") is not None else None
    if not entity_uid:
        return row
    canonical = get_track_info_cols_by_entity_uid(entity_uid, cols)
    return canonical or row


def _get_entity_uid_from_storage_alias(storage_id: str) -> str | None:
    row = get_track_info_cols_by_storage_id(storage_id, "entity_uid")
    entity_uid = row.get("entity_uid") if row else None
    return str(entity_uid) if entity_uid is not None else None


def _get_track_id_via_storage_alias(storage_id: str) -> int | None:
    row = _get_track_info_cols_via_storage_alias(storage_id, "id, entity_uid")
    if not row:
        return None
    track_id = row.get("id")
    if track_id is not None:
        return int(track_id)
    entity_uid = row.get("entity_uid")
    if entity_uid is None:
        return None
    return get_track_id_by_entity_uid(str(entity_uid))


def _get_track_path_via_storage_alias(storage_id: str) -> str | None:
    row = _get_track_info_cols_via_storage_alias(storage_id, "entity_uid, path")
    if not row:
        return None
    path = row.get("path")
    if path:
        return path
    entity_uid = row.get("entity_uid")
    if entity_uid is None:
        return None
    return get_track_path_by_entity_uid(str(entity_uid))


@router.get(
    "/api/tracks/{track_id}/info",
    response_model=TrackInfoResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get detailed track metadata by track ID",
)
def api_track_info_by_id(request: Request, track_id: int):
    _require_auth(request)
    row = get_track_info_cols(track_id, _TRACK_INFO_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_track_info_row(row)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/info",
    response_model=TrackInfoResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get detailed track metadata by entity UID",
)
def api_track_info_by_entity_uid(request: Request, entity_uid: str):
    _require_auth(request)
    row = get_track_info_cols_by_entity_uid(entity_uid, _TRACK_INFO_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_track_info_row(row)


@router.get(
    "/api/tracks/by-storage/{storage_id}/info",
    response_model=TrackInfoResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get detailed track metadata by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def api_track_info_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    entity_uid = _get_entity_uid_from_storage_alias(storage_id)
    if entity_uid:
        return RedirectResponse(url=f"/api/tracks/by-entity/{entity_uid}/info", status_code=307)
    row = _get_track_info_cols_via_storage_alias(storage_id, _TRACK_INFO_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_track_info_row(row)


@router.get(
    "/api/track-info/{filepath:path}",
    response_model=TrackInfoResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get detailed track metadata by file path",
)
def api_track_info(request: Request, filepath: str):
    _require_auth(request)
    if filepath.startswith("/music/"):
        filepath = filepath[len("/music/") :]

    row = get_track_info_cols_by_path(filepath, _TRACK_INFO_QUERY_COLS)

    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_track_info_row(row)


# ── EQ adaptive features ────────────────────────────────────────────

_EQ_FEATURES_QUERY_COLS = (
    "energy, loudness, dynamic_range, spectral_complexity, "
    "danceability, valence, acousticness, instrumentalness"
)


def _serialize_eq_features(row) -> dict:
    """Normalize nullable floats + expose canonical frontend keys."""
    data = dict(row)
    return {
        "energy": data.get("energy"),
        "loudness": data.get("loudness"),
        "dynamicRange": data.get("dynamic_range"),
        "brightness": data.get("spectral_complexity"),
        "danceability": data.get("danceability"),
        "valence": data.get("valence"),
        "acousticness": data.get("acousticness"),
        "instrumentalness": data.get("instrumentalness"),
    }


@router.get(
    "/api/tracks/{track_id}/eq-features",
    response_model=EqFeaturesResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get adaptive EQ features for a track by ID",
)
def api_eq_features_by_id(request: Request, track_id: int):
    _require_auth(request)
    row = get_track_info_cols(track_id, _EQ_FEATURES_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_eq_features(row)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/eq-features",
    response_model=EqFeaturesResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get adaptive EQ features for a track by entity UID",
)
def api_eq_features_by_entity_uid(request: Request, entity_uid: str):
    _require_auth(request)
    row = get_track_info_cols_by_entity_uid(entity_uid, _EQ_FEATURES_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_eq_features(row)


@router.get(
    "/api/tracks/by-storage/{storage_id}/eq-features",
    response_model=EqFeaturesResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get adaptive EQ features for a track by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def api_eq_features_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    entity_uid = _get_entity_uid_from_storage_alias(storage_id)
    if entity_uid:
        return RedirectResponse(url=f"/api/tracks/by-entity/{entity_uid}/eq-features", status_code=307)
    row = _get_track_info_cols_via_storage_alias(storage_id, _EQ_FEATURES_QUERY_COLS)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    return _serialize_eq_features(row)


# ── Track primary genre ─────────────────────────────────────────────

def _pick_primary_genre(rows, *, canonical_only: bool = False):
    """Prefer the highest-weight canonical genre; fall back to the
    highest-weight raw tag if none resolve cleanly. Canonical picks
    also carry the resolved EQ preset (direct or inherited)."""
    from crate.genre_taxonomy import (
        get_genre_display_name,
        get_top_level_slug,
        is_canonical_genre_slug,
        resolve_genre_eq_preset,
        resolve_genre_slug,
    )

    canonical_pick = None
    raw_pick = None

    for row in rows:
        raw_slug = (row.get("slug") or "").strip().lower()
        raw_name = (row.get("name") or "").strip().lower()
        resolved = resolve_genre_slug(raw_name or raw_slug)
        if resolved and is_canonical_genre_slug(resolved):
            if canonical_pick is None:
                top_level_slug = get_top_level_slug(resolved) or resolved
                preset_info = resolve_genre_eq_preset(resolved)
                preset_payload = None
                if preset_info is not None:
                    preset_payload = {
                        "gains": preset_info["gains"],
                        "source": preset_info["source"],
                        "inheritedFrom": (
                            {"slug": preset_info["slug"], "name": preset_info["name"]}
                            if preset_info["source"] == "inherited"
                            else None
                        ),
                    }
                canonical_pick = {
                    "primary": {
                        "slug": resolved,
                        "name": get_genre_display_name(resolved),
                        "canonical": True,
                    },
                    "topLevel": {
                        "slug": top_level_slug,
                        "name": get_genre_display_name(top_level_slug),
                    },
                    "preset": preset_payload,
                }
        elif raw_pick is None:
            raw_pick = {
                "primary": {
                    "slug": raw_slug or resolved or "",
                    "name": raw_name or (raw_slug.replace("-", " ") if raw_slug else ""),
                    "canonical": False,
                },
                "topLevel": None,
                "preset": None,
            }

    if canonical_only:
        return canonical_pick
    return canonical_pick or raw_pick


def _resolve_track_genre(track_id: int) -> dict | None:
    album_rows = get_track_album_genres(track_id)
    picked = _pick_primary_genre(album_rows, canonical_only=True) if album_rows else None
    if picked:
        picked["source"] = "album"
        return picked

    artist_rows = get_track_artist_genres(track_id)
    picked = _pick_primary_genre(artist_rows, canonical_only=True) if artist_rows else None
    if picked:
        picked["source"] = "artist"
        return picked

    picked = _pick_primary_genre(album_rows) if album_rows else None
    if picked:
        picked["source"] = "album"
        return picked

    picked = _pick_primary_genre(artist_rows) if artist_rows else None
    if picked:
        picked["source"] = "artist"
        return picked

    return None


def _track_genre_payload(track_id: int) -> dict:
    cache_key = f"listen:track_genre:v1:{track_id}"
    cached = get_cache(cache_key, max_age_seconds=3600)
    if cached is not None:
        return cached

    result = _resolve_track_genre(track_id)
    payload = result or {"primary": None, "topLevel": None, "source": None, "preset": None}
    set_cache(cache_key, payload, ttl=3600)
    return payload


@router.get(
    "/api/tracks/{track_id}/genre",
    response_model=TrackGenreResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get the primary genre for a track by ID",
)
def api_track_genre_by_id(request: Request, track_id: int):
    _require_auth(request)
    if not get_track_exists(track_id):
        raise HTTPException(status_code=404, detail="Track not found")
    return _track_genre_payload(track_id)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/genre",
    response_model=TrackGenreResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get the primary genre for a track by entity UID",
)
def api_track_genre_by_entity_uid(request: Request, entity_uid: str):
    _require_auth(request)
    tid = get_track_id_by_entity_uid(entity_uid)
    if tid is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return _track_genre_payload(tid)


@router.get(
    "/api/tracks/by-storage/{storage_id}/genre",
    response_model=TrackGenreResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Get the primary genre for a track by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def api_track_genre_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    entity_uid = _get_entity_uid_from_storage_alias(storage_id)
    if entity_uid:
        return RedirectResponse(url=f"/api/tracks/by-entity/{entity_uid}/genre", status_code=307)
    tid = _get_track_id_via_storage_alias(storage_id)
    if tid is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return _track_genre_payload(tid)


@router.get(
    "/api/discover/completeness",
    response_model=DiscoverCompletenessResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List cached library completeness results",
)
def api_discover_completeness(request: Request):
    """Return cached completeness data. The heavy computation runs as a worker task."""
    _require_auth(request)
    cached = get_cache("discover:completeness", max_age_seconds=86400)
    if cached is not None:
        return cached
    create_task_dedup("compute_completeness", {})
    return []


@router.post(
    "/api/discover/completeness/refresh",
    response_model=DiscoverCompletenessRefreshResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue a completeness refresh",
)
def api_discover_completeness_refresh(request: Request):
    """Force recompute of completeness data."""
    _require_auth(request)
    task_id = create_task_dedup("compute_completeness", {})
    return {"task_id": task_id}


_STREAM_MEDIA_TYPES = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
}


def _stream_file(request: Request, filepath: str):
    _require_auth(request)
    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    file_path = safe_path(lib, filepath)
    return _stream_resolved_file(request, file_path)


def _stream_resolved_file(request: Request, file_path, *, media_type: str | None = None, extra_headers: dict[str, str] | None = None):
    _require_auth(request)
    from fastapi.responses import FileResponse
    from crate.metrics import record, record_counter

    if not file_path or not file_path.is_file():
        record_counter("stream.requests", {"status": "404"})
        raise HTTPException(status_code=404, detail="Track not found")

    ext = file_path.suffix.lower()
    record_counter("stream.requests", {"status": "200", "format": ext.lstrip(".")})
    try:
        record("stream.bytes", file_path.stat().st_size)
    except Exception:
        pass

    return FileResponse(
        path=str(file_path),
        media_type=media_type or _STREAM_MEDIA_TYPES.get(ext, "audio/mpeg"),
        headers={"Accept-Ranges": "bytes", **(extra_headers or {})},
    )


def _playback_headers(resolution) -> dict[str, str]:
    delivery = resolution.delivery or {}
    source = resolution.source or {}
    return {
        "X-Crate-Delivery-Policy": resolution.requested_policy,
        "X-Crate-Delivery-Effective-Policy": resolution.effective_policy,
        "X-Crate-Delivery-Format": str(delivery.get("format") or ""),
        "X-Crate-Delivery-Bitrate": str(delivery.get("bitrate") or ""),
        "X-Crate-Source-Format": str(source.get("format") or ""),
        "X-Crate-Transcoded": "1" if resolution.transcoded else "0",
        "X-Crate-Variant-Status": str(resolution.variant_status or ("preparing" if resolution.preparing else "")),
    }


def _stream_track(request: Request, track: dict, delivery: str):
    resolution = resolve_playback(track, delivery, enqueue=True)
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return _stream_resolved_file(
        request,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
    )


def _stream_url_for_track(track: dict, policy: str) -> str:
    query = "" if policy == "original" else f"?delivery={policy}"
    entity_uid = track.get("entity_uid")
    if entity_uid is not None:
        return f"/api/tracks/by-entity/{quote(str(entity_uid), safe='')}/stream{query}"
    track_id = track.get("id")
    if track_id is not None:
        return f"/api/tracks/{track_id}/stream{query}"
    encoded_path = quote(str(track.get("path") or "").lstrip("/"), safe="/")
    return f"/api/stream/{encoded_path}{query}"


def _playback_payload_for_track(track: dict, delivery: str) -> dict:
    resolution = resolve_playback(track, delivery, enqueue=True)
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return resolution_to_payload(resolution, _stream_url_for_track(track, resolution.requested_policy))


@router.get(
    "/api/tracks/{track_id}/stream",
    responses=_STREAM_RESPONSES,
    summary="Stream a track by track ID",
)
def api_stream_by_id(request: Request, track_id: int, delivery: str = Query("original")):
    _require_auth(request)
    track = get_track_delivery_row_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _stream_track(request, track, delivery)


@router.get(
    "/api/tracks/{track_id}/playback",
    response_model=PlaybackResolutionResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Resolve playback delivery for a track by track ID",
)
def api_playback_by_id(request: Request, track_id: int, delivery: str = Query("original")):
    _require_auth(request)
    track = get_track_delivery_row_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _playback_payload_for_track(track, delivery)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/stream",
    responses=_STREAM_RESPONSES,
    summary="Stream a track by entity UID",
)
def api_stream_by_entity_uid(request: Request, entity_uid: str, delivery: str = Query("original")):
    _require_auth(request)
    track = get_track_delivery_row_by_entity_uid(entity_uid)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _stream_track(request, track, delivery)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/playback",
    response_model=PlaybackResolutionResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Resolve playback delivery for a track by entity UID",
)
def api_playback_by_entity_uid(request: Request, entity_uid: str, delivery: str = Query("original")):
    _require_auth(request)
    track = get_track_delivery_row_by_entity_uid(entity_uid)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _playback_payload_for_track(track, delivery)


@router.get(
    "/api/tracks/by-storage/{storage_id}/stream",
    responses=_STREAM_RESPONSES,
    summary="Stream a track by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def api_stream_by_storage_id(request: Request, storage_id: str, delivery: str = Query("original")):
    _require_auth(request)
    track = _get_track_info_cols_via_storage_alias(
        storage_id,
        "id, entity_uid, path, title, artist, album, format, bitrate, sample_rate, bit_depth, duration, size",
    )
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _stream_track(request, track, delivery)


@router.get(
    "/api/stream/{filepath:path}",
    responses=_STREAM_RESPONSES,
    summary="Stream a track by file path",
)
def api_stream_file(request: Request, filepath: str, delivery: str = Query("original")):
    if delivery != "original":
        track = get_track_delivery_row_by_path(filepath)
        if track:
            return _stream_track(request, track, delivery)
    return _stream_file(request, filepath)


@router.get(
    "/api/playback/variants/{variant_id}/stream",
    responses=_STREAM_RESPONSES,
    summary="Stream a cached playback variant",
)
def api_stream_playback_variant(request: Request, variant_id: str):
    _require_auth(request)
    row = get_variant_by_id(variant_id)
    if not row or row.get("status") != "ready":
        raise HTTPException(status_code=404, detail="Playback variant not found")
    track_id = row.get("track_id")
    track = get_track_delivery_row_by_id(int(track_id)) if track_id is not None else None
    if not track or track.get("path") != row.get("source_path"):
        raise HTTPException(status_code=404, detail="Playback variant not found")
    source_path = safe_path(library_path(), str(row.get("source_path") or ""))
    if not source_path or not source_path.is_file():
        mark_variant_missing(row["cache_key"])
        raise HTTPException(status_code=404, detail="Playback variant not found")
    source_stat = source_path.stat()
    if source_stat.st_size != int(row.get("source_size") or 0) or source_stat.st_mtime_ns != int(row.get("source_mtime_ns") or 0):
        mark_variant_missing(row["cache_key"])
        raise HTTPException(status_code=404, detail="Playback variant not found")
    variant_path = resolve_data_file(row.get("relative_path"))
    if not variant_path or not variant_path.is_file():
        mark_variant_missing(row["cache_key"])
        raise HTTPException(status_code=404, detail="Playback variant not found")
    return _stream_resolved_file(
        request,
        variant_path,
        media_type=media_type_for_path(variant_path),
        extra_headers={
            "X-Crate-Delivery-Policy": str(row.get("preset") or ""),
            "X-Crate-Delivery-Effective-Policy": str(row.get("preset") or ""),
            "X-Crate-Delivery-Format": str(row.get("delivery_format") or ""),
            "X-Crate-Delivery-Bitrate": str(row.get("delivery_bitrate") or ""),
            "X-Crate-Transcoded": "1",
            "X-Crate-Variant-Status": "ready",
        },
    )


def _resolve_playback_prepare_track(ref) -> dict | None:
    if ref.entity_uid:
        return get_track_delivery_row_by_entity_uid(ref.entity_uid)
    if ref.track_id:
        return get_track_delivery_row_by_id(ref.track_id)
    if ref.path:
        return get_track_delivery_row_by_path(ref.path)
    return None


@router.post(
    "/api/playback/prepare",
    response_model=PlaybackPrepareResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Queue cached playback variants for upcoming tracks",
)
def api_playback_prepare(request: Request, body: PlaybackPrepareRequest):
    _require_auth(request)
    policy = normalize_policy(body.policy)
    items = []
    for ref in body.tracks[:12]:
        track = _resolve_playback_prepare_track(ref)
        if not track:
            items.append({"ok": False, "error": "Track not found"})
            continue
        try:
            resolution = resolve_playback(track, policy, enqueue=True)
            items.append({
                "track_id": track.get("id"),
                "entity_uid": str(track["entity_uid"]) if track.get("entity_uid") is not None else None,
                "ok": resolution is not None,
                "preparing": bool(resolution and resolution.preparing),
                "cache_hit": bool(resolution and resolution.cache_hit),
                "transcoded": bool(resolution and resolution.transcoded),
                "task_id": resolution.task_id if resolution else None,
                "variant_id": resolution.variant_id if resolution else None,
                "variant_status": resolution.variant_status if resolution else None,
            })
        except Exception as exc:
            log.debug("Failed to prepare playback variant", exc_info=True)
            items.append({
                "track_id": track.get("id"),
                "entity_uid": str(track["entity_uid"]) if track.get("entity_uid") is not None else None,
                "ok": False,
                "error": str(exc),
            })
    return {"policy": policy, "items": items}


@router.get(
    "/api/similar-tracks",
    response_model=SimilarTracksResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Find tracks similar to a seed track",
)
def api_similar_tracks_query(request: Request, path: str = "", track_id: int = 0, limit: int = 20):
    _require_auth(request)
    from crate.bliss import get_similar_from_db

    if track_id:
        found_path = get_track_path(track_id)
        if found_path:
            path = found_path

    if not path:
        raise HTTPException(status_code=400, detail="path or track_id required")

    results = get_similar_from_db(path, limit=limit)
    return {"tracks": _enrich_radio_tracks(results)}


@router.get(
    "/api/similar-tracks/{filepath:path}",
    response_model=SimilarTracksResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="Find tracks similar to a seed file path",
)
def api_similar_tracks(request: Request, filepath: str, limit: int = 20):
    _require_auth(request)
    from crate.bliss import get_similar_from_db

    lib = library_path()
    full_path = safe_path(lib, filepath)
    if not full_path or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Track not found")
    similar = get_similar_from_db(str(full_path), limit=limit)
    return {"tracks": _enrich_radio_tracks(similar)}


def _download_track(request: Request, filepath: str):
    _require_auth(request)
    from fastapi.responses import FileResponse

    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    file_path = safe_path(lib, filepath)
    if not file_path or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Track not found")

    try:
        from crate.db.queries.portable_metadata import get_portable_track_payload_by_path
        from crate.download_cache import (
            cached_download_artifact_path,
            download_cache_lock,
            download_cache_enabled,
            get_cached_download,
            safe_download_filename,
            store_cached_download,
            track_cache_ttl_seconds,
            track_download_cache_key,
        )
        from crate.media_worker import build_track_download_artifact
        from crate.portable_metadata import find_album_artwork_file, write_track_rich_tags

        payload = get_portable_track_payload_by_path(str(file_path))
        if payload:
            album_payload = payload.get("album") or {}
            artwork_path = find_album_artwork_file(album_payload.get("path") or "")
            cache_key = track_download_cache_key(payload, source_path=file_path, artwork_path=artwork_path)
            cache_filename = safe_download_filename(file_path.name, "track")
            cached = get_cached_download("track", cache_key, cache_filename, ttl_seconds=track_cache_ttl_seconds())
            if cached is None:
                with download_cache_lock("track", cache_key, timeout_seconds=120):
                    cached = get_cached_download("track", cache_key, cache_filename, ttl_seconds=track_cache_ttl_seconds())
                    if cached is None:
                        if download_cache_enabled():
                            worker_output_path = cached_download_artifact_path("track", cache_key, cache_filename)
                            worker_result = build_track_download_artifact(
                                payload,
                                source_path=file_path,
                                output_path=worker_output_path,
                                filename=cache_filename,
                                job_id=cache_key,
                                artwork_path=artwork_path,
                                write_rich_tags=True,
                                cache_kind="track",
                                cache_key=cache_key,
                                cache_metadata={
                                    "track_id": (payload.get("track") or {}).get("id"),
                                    "track_entity_uid": (payload.get("track") or {}).get("entity_uid"),
                                    "album_entity_uid": album_payload.get("entity_uid"),
                                    "engine": "crate-media-worker",
                                },
                            )
                            if worker_result and worker_result.get("ok"):
                                cached = get_cached_download(
                                    "track",
                                    cache_key,
                                    cache_filename,
                                    ttl_seconds=track_cache_ttl_seconds(),
                                )
                            elif worker_result:
                                log.debug("crate-media-worker track artifact failed: %s", worker_result)
                        if cached is not None:
                            return FileResponse(path=str(cached.path), filename=file_path.name, media_type="application/octet-stream")
                        tmp_dir = tempfile.mkdtemp(prefix="crate-track-download.")
                        tmp_path = Path(tmp_dir) / file_path.name
                        keep_tmp = False
                        try:
                            shutil.copy2(file_path, tmp_path)
                            write_track_rich_tags(
                                tmp_path,
                                artist_uid=(payload.get("artist") or {}).get("entity_uid"),
                                album_uid=album_payload.get("entity_uid"),
                                track_payload=payload.get("track") or {},
                                artwork_path=artwork_path,
                            )
                            cached = store_cached_download(
                                "track",
                                cache_key,
                                cache_filename,
                                tmp_path,
                                metadata={
                                    "track_id": (payload.get("track") or {}).get("id"),
                                    "track_entity_uid": (payload.get("track") or {}).get("entity_uid"),
                                    "album_entity_uid": album_payload.get("entity_uid"),
                                },
                            )
                            if cached is None:
                                keep_tmp = True
                                return FileResponse(
                                    path=str(tmp_path),
                                    filename=file_path.name,
                                    media_type="application/octet-stream",
                                    background=BackgroundTask(shutil.rmtree, tmp_dir, ignore_errors=True),
                                )
                        finally:
                            if not keep_tmp:
                                shutil.rmtree(tmp_dir, ignore_errors=True)
            if cached is not None:
                return FileResponse(path=str(cached.path), filename=file_path.name, media_type="application/octet-stream")
    except Exception:
        log.debug("Falling back to original track download for %s", file_path, exc_info=True)

    return FileResponse(path=str(file_path), filename=file_path.name, media_type="application/octet-stream")


@router.get(
    "/api/tracks/{track_id}/download",
    responses=_DOWNLOAD_RESPONSES,
    summary="Download a track by track ID",
)
def api_download_track_by_id(request: Request, track_id: int):
    _require_auth(request)
    path = get_track_path(track_id)
    if not path:
        raise HTTPException(status_code=404, detail="Track not found")
    return _download_track(request, path)


@router.get(
    "/api/tracks/by-entity/{entity_uid}/download",
    responses=_DOWNLOAD_RESPONSES,
    summary="Download a track by entity UID",
)
def api_download_track_by_entity_uid(request: Request, entity_uid: str):
    _require_auth(request)
    path = get_track_path_by_entity_uid(entity_uid)
    if not path:
        raise HTTPException(status_code=404, detail="Track not found")
    return _download_track(request, path)


@router.get(
    "/api/tracks/by-storage/{storage_id}/download",
    responses=_DOWNLOAD_RESPONSES,
    summary="Download a track by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def api_download_track_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    entity_uid = _get_entity_uid_from_storage_alias(storage_id)
    if entity_uid:
        return RedirectResponse(url=f"/api/tracks/by-entity/{entity_uid}/download", status_code=307)
    path = _get_track_path_via_storage_alias(storage_id)
    if not path:
        raise HTTPException(status_code=404, detail="Track not found")
    return _download_track(request, path)


@router.get(
    "/api/download/track/{filepath:path}",
    responses=_DOWNLOAD_RESPONSES,
    summary="Download a track by file path",
)
def api_download_track(request: Request, filepath: str):
    return _download_track(request, filepath)


# ── Mood/Energy browse ──────────────────────────────────────────

MOOD_PRESETS = {
    "energetic": {"energy_min": 0.7, "danceability_min": 0.5},
    "chill": {"energy_max": 0.4, "valence_min": 0.3},
    "dark": {"valence_max": 0.3, "energy_min": 0.4},
    "happy": {"valence_min": 0.6, "energy_min": 0.4},
    "melancholy": {"valence_max": 0.35, "energy_max": 0.5},
    "intense": {"energy_min": 0.8},
    "groovy": {"danceability_min": 0.65, "energy_min": 0.45},
    "acoustic": {"acousticness_min": 0.6},
}


def _mood_conditions(filters: dict) -> tuple[list[str], list]:
    conditions = ["bpm IS NOT NULL"]
    params: list = []
    for key, val in filters.items():
        col = key.rsplit("_", 1)[0]
        op = ">" if key.endswith("_min") else "<"
        conditions.append(f"{col} {op}= %s")
        params.append(val)
    return conditions, params


@router.get(
    "/api/browse/moods",
    response_model=MoodPresetsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List mood presets with available track counts",
)
def api_browse_moods(request: Request):
    """Return available mood presets with track counts."""
    _require_auth(request)
    cached = get_cache("listen:browse_moods:v1", max_age_seconds=600)
    if cached is not None:
        return cached

    counts = count_mood_presets(MOOD_PRESETS)
    results = [
        {"name": name, "track_count": counts.get(name, 0), "filters": filters}
        for name, filters in MOOD_PRESETS.items()
    ]
    set_cache("listen:browse_moods:v1", results, ttl=600)
    return results


@router.get(
    "/api/browse/mood/{mood}",
    response_model=MoodTracksResponse,
    responses=_BROWSE_MEDIA_RESPONSES,
    summary="List tracks matching a mood preset",
)
def api_browse_mood_tracks(request: Request, mood: str, limit: int = Query(50, ge=1, le=200)):
    """Return tracks matching a mood preset."""
    _require_auth(request)
    preset = MOOD_PRESETS.get(mood)
    if not preset:
        raise HTTPException(status_code=404, detail=f"Unknown mood: {mood}")
    conditions, params = _mood_conditions(preset)
    tracks = get_mood_tracks(conditions, params, limit)
    return {"mood": mood, "filters": preset, "tracks": tracks, "count": len(tracks)}
