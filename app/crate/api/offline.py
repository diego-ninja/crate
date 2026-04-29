import hashlib
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.offline import OfflineManifestResponse
from crate.db.repositories.library import (
    get_library_album_by_id,
    get_library_artist,
    get_library_track_by_entity_uid,
    get_library_track_by_id,
    get_library_track_by_path,
    get_library_tracks_by_entity_uids,
    get_library_tracks,
)
from crate.db.repositories.library_track_reads import get_library_track_by_storage_id, get_library_tracks_by_storage_ids
from crate.db.repositories.playlists import can_view_playlist, get_playlist, get_playlist_tracks

router = APIRouter(prefix="/api/offline", tags=["offline"])

_OFFLINE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested offline manifest could not be found."),
        409: error_response("The requested item cannot be made available offline."),
    },
)


def _iso(dt: datetime | str | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def _hash_payload(parts: list[object]) -> str:
    payload = json.dumps(parts, ensure_ascii=True, sort_keys=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _artist_cache_lookup(cache: dict[str, dict | None], artist_name: str | None) -> dict | None:
    key = (artist_name or "").strip()
    if not key:
        return None
    if key not in cache:
        cache[key] = get_library_artist(key)
    return cache[key]


def _track_manifest_row(
    track: dict,
    *,
    album_slug: str | None = None,
    artist_cache: dict[str, dict | None] | None = None,
) -> dict:
    artist_cache = artist_cache or {}
    artist_row = _artist_cache_lookup(artist_cache, track.get("artist"))
    entity_uid = track.get("entity_uid")
    raw_storage_id = track.get("storage_id")
    storage_id = None if entity_uid else raw_storage_id
    if not entity_uid and not storage_id:
        raise HTTPException(status_code=404, detail="Track entity_uid/storage_id missing")

    stream_ref = entity_uid or raw_storage_id
    stream_prefix = "by-entity" if entity_uid else "by-storage"

    return {
        "entity_uid": entity_uid,
        "track_id": track.get("id"),
        "title": track.get("title") or track.get("filename") or "Unknown",
        "artist": track.get("artist") or "",
        "artist_id": artist_row.get("id") if artist_row else None,
        "artist_slug": artist_row.get("slug") if artist_row else None,
        "album": track.get("album"),
        "album_id": track.get("album_id"),
        "album_slug": album_slug,
        "duration": track.get("duration"),
        "format": track.get("format"),
        "bitrate": track.get("bitrate"),
        "sample_rate": track.get("sample_rate"),
        "bit_depth": track.get("bit_depth"),
        "byte_length": track.get("size"),
        "stream_url": f"/api/tracks/{stream_prefix}/{stream_ref}/stream",
        "download_url": f"/api/tracks/{stream_prefix}/{stream_ref}/download",
        "updated_at": _iso(track.get("updated_at")),
    }


def _track_manifest_identity(track: dict) -> str | None:
    entity_uid = track.get("entity_uid")
    if entity_uid:
        return str(entity_uid)
    storage_id = track.get("storage_id")
    return str(storage_id) if storage_id else None


def _build_track_manifest(track: dict) -> dict:
    album = get_library_album_by_id(track.get("album_id")) if track.get("album_id") else None
    manifest_track = _track_manifest_row(track, album_slug=album.get("slug") if album else None)
    manifest_id = _track_manifest_identity(track)
    parts = [
        manifest_id,
        manifest_track["format"],
        manifest_track["bitrate"],
        manifest_track["duration"],
        manifest_track["updated_at"],
    ]
    return {
        "kind": "track",
        "id": manifest_id,
        "title": manifest_track["title"],
        "content_version": _hash_payload(parts),
        "updated_at": manifest_track["updated_at"],
        "track_count": 1,
        "total_bytes": int(manifest_track.get("byte_length") or 0),
        "tracks": [manifest_track],
        "artwork": {
            "cover_url": (
                f"/api/albums/{album['id']}/cover"
                if album and album.get("id") is not None
                else None
            )
        },
        "metadata": {
            "artist": manifest_track["artist"],
            "album": manifest_track.get("album"),
            "album_id": manifest_track.get("album_id"),
            "entity_uid": manifest_track.get("entity_uid"),
        },
    }


def _build_album_manifest(album: dict, tracks: list[dict]) -> dict:
    artist_cache: dict[str, dict | None] = {}
    manifest_tracks = [_track_manifest_row(track, album_slug=album.get("slug"), artist_cache=artist_cache) for track in tracks]
    parts = [
        album.get("id"),
        [_track_manifest_identity(track) for track in tracks],
        max([track.get("updated_at") for track in manifest_tracks] + [_iso(album.get("updated_at"))]),
    ]
    total_bytes = sum(int(track.get("byte_length") or 0) for track in manifest_tracks)
    return {
        "kind": "album",
        "id": album["id"],
        "title": album.get("name") or "Album",
        "content_version": _hash_payload(parts),
        "updated_at": _iso(album.get("updated_at")),
        "track_count": len(manifest_tracks),
        "total_bytes": total_bytes,
        "tracks": manifest_tracks,
        "artwork": {
            "cover_url": f"/api/albums/{album['id']}/cover",
        },
        "metadata": {
            "artist": album.get("artist"),
            "album_id": album.get("id"),
            "album_slug": album.get("slug"),
            "year": album.get("year"),
        },
    }


def _build_playlist_manifest(playlist: dict, tracks: list[dict]) -> dict:
    artist_cache: dict[str, dict | None] = {}
    manifest_tracks: list[dict] = []
    version_parts: list[object] = [playlist.get("id")]
    total_bytes = 0
    entity_uids = [track.get("track_entity_uid") for track in tracks if track.get("track_entity_uid")]
    storage_ids = [
        track.get("track_storage_id")
        for track in tracks
        if track.get("track_storage_id") and not track.get("track_entity_uid")
    ]
    tracks_by_entity = get_library_tracks_by_entity_uids(entity_uids) if entity_uids else {}
    tracks_by_storage = get_library_tracks_by_storage_ids(storage_ids) if storage_ids else {}

    for track in tracks:
        entity_uid = track.get("track_entity_uid")
        storage_id = track.get("track_storage_id")
        if not storage_id and not entity_uid:
            continue
        lib_track = tracks_by_entity.get(entity_uid) if entity_uid else None
        if not lib_track and storage_id and not entity_uid:
            lib_track = tracks_by_storage.get(storage_id)
        if not lib_track:
            continue
        manifest_track = _track_manifest_row(
            lib_track,
            album_slug=track.get("album_slug"),
            artist_cache=artist_cache,
        )
        manifest_track["artist_id"] = track.get("artist_id") or manifest_track.get("artist_id")
        manifest_track["artist_slug"] = track.get("artist_slug") or manifest_track.get("artist_slug")
        manifest_track["album_id"] = track.get("album_id") or manifest_track.get("album_id")
        manifest_track["album_slug"] = track.get("album_slug") or manifest_track.get("album_slug")
        manifest_track["duration"] = track.get("duration") or manifest_track.get("duration")
        manifest_tracks.append(manifest_track)
        total_bytes += int(manifest_track.get("byte_length") or 0)
        version_parts.append(
            (
                track.get("position"),
                _track_manifest_identity(lib_track),
                manifest_track["updated_at"],
            )
        )

    version_parts.append(_iso(playlist.get("updated_at")))
    return {
        "kind": "playlist",
        "id": playlist["id"],
        "title": playlist.get("name") or "Playlist",
        "content_version": _hash_payload(version_parts),
        "updated_at": _iso(playlist.get("updated_at")),
        "track_count": len(manifest_tracks),
        "total_bytes": total_bytes,
        "tracks": manifest_tracks,
        "artwork": {
            "cover_url": f"/api/playlists/{playlist['id']}/cover" if playlist.get("cover_path") else None,
        },
        "metadata": {
            "playlist_id": playlist.get("id"),
            "playlist_name": playlist.get("name"),
            "generation_mode": playlist.get("generation_mode"),
            "visibility": playlist.get("visibility"),
        },
    }


@router.get(
    "/tracks/{track_id}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for a track by ID",
)
def get_track_manifest_by_id(request: Request, track_id: int):
    _require_auth(request)
    track = get_library_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _build_track_manifest(track)


@router.get(
    "/tracks/by-path/{path:path}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for a track by path",
)
def get_track_manifest_by_path(request: Request, path: str):
    _require_auth(request)
    track = get_library_track_by_path(path)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _build_track_manifest(track)


@router.get(
    "/tracks/by-entity/{entity_uid}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for a track by entity UID",
)
def get_track_manifest_by_entity_uid(request: Request, entity_uid: str):
    _require_auth(request)
    track = get_library_track_by_entity_uid(entity_uid)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _build_track_manifest(track)


@router.get(
    "/tracks/by-storage/{storage_id}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for a track by legacy storage ID",
    deprecated=True,
    include_in_schema=False,
)
def get_track_manifest(request: Request, storage_id: str):
    _require_auth(request)
    track = get_library_track_by_storage_id(storage_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    entity_uid = track.get("entity_uid")
    if entity_uid:
        return RedirectResponse(url=f"/api/offline/tracks/by-entity/{entity_uid}/manifest", status_code=307)
    return _build_track_manifest(track)


@router.get(
    "/albums/{album_id}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for an album",
)
def get_album_manifest(request: Request, album_id: int):
    _require_auth(request)
    album = get_library_album_by_id(album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    tracks = get_library_tracks(album_id)
    if not tracks:
        raise HTTPException(status_code=404, detail="Album has no playable tracks")
    return _build_album_manifest(album, tracks)


@router.get(
    "/playlists/{playlist_id}/manifest",
    response_model=OfflineManifestResponse,
    responses=_OFFLINE_RESPONSES,
    summary="Get an offline manifest for a static playlist",
)
def get_playlist_manifest(request: Request, playlist_id: int):
    user = _require_auth(request)
    playlist = get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_view_playlist(playlist, user["id"]):
        raise HTTPException(status_code=403, detail="Playlist is private")
    if playlist.get("generation_mode") == "smart" or playlist.get("is_smart"):
        raise HTTPException(status_code=409, detail="Offline is only available for static playlists")

    tracks = get_playlist_tracks(playlist_id)
    if not tracks:
        raise HTTPException(status_code=404, detail="Playlist has no playable tracks")
    return _build_playlist_manifest(playlist, tracks)
