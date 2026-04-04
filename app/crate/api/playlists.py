from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from crate.api.auth import _require_auth
from crate.api.playlist_utils import apply_playlist_cover_payload, execute_smart_rules
from crate.playlist_covers import delete_playlist_cover, playlist_cover_abspath
from crate.db import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    remove_playlist_track, reorder_playlist, get_db_ctx, create_task,
    get_user_external_identity,
)

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class CreatePlaylistRequest(BaseModel):
    name: str
    description: str = ""
    cover_data_url: str | None = None
    is_smart: bool = False
    smart_rules: dict | None = None


class UpdatePlaylistRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_data_url: str | None = None
    smart_rules: dict | None = None


class AddTracksRequest(BaseModel):
    tracks: list[dict]  # [{path, title, artist, album, duration}]


class ReorderRequest(BaseModel):
    track_ids: list[int]


class SyncNavidromeRequest(BaseModel):
    playlist_id: int


# ── Filter options ───────────────────────────────────────────────

@router.get("/filter-options")
def filter_options():
    """Return available values for smart playlist filters."""
    from crate.db import get_all_genres
    genres = [g["name"] for g in get_all_genres()]

    with get_db_ctx() as cur:
        cur.execute("SELECT DISTINCT format FROM library_tracks WHERE format IS NOT NULL AND format != '' ORDER BY format")
        formats = [r["format"] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT audio_key FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != '' ORDER BY audio_key")
        keys = [r["audio_key"] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT audio_scale FROM library_tracks WHERE audio_scale IS NOT NULL AND audio_scale != '' ORDER BY audio_scale")
        scales = [r["audio_scale"] for r in cur.fetchall()]

        cur.execute("SELECT name FROM library_artists ORDER BY name")
        artists = [r["name"] for r in cur.fetchall()]

        cur.execute("SELECT MIN(year) AS min_y, MAX(year) AS max_y FROM library_tracks WHERE year IS NOT NULL AND year != ''")
        yr = cur.fetchone()

        cur.execute("SELECT MIN(bpm) AS min_b, MAX(bpm) AS max_b FROM library_tracks WHERE bpm IS NOT NULL")
        bpm = cur.fetchone()

    return {
        "genres": genres,
        "formats": formats,
        "keys": keys,
        "scales": scales,
        "artists": artists,
        "year_range": [yr["min_y"] or "1960", yr["max_y"] or "2026"],
        "bpm_range": [int(bpm["min_b"] or 60), int(bpm["max_b"] or 200)],
    }


# ── CRUD ─────────────────────────────────────────────────────────

@router.get("")
def list_playlists(request: Request):
    user = _require_auth(request)
    playlists = get_playlists(user_id=user["id"])
    return playlists


@router.post("")
def create(request: Request, body: CreatePlaylistRequest):
    user = _require_auth(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    playlist_id = create_playlist(
        name=body.name.strip(),
        description=body.description,
        user_id=user["id"],
        is_smart=body.is_smart,
        smart_rules=body.smart_rules,
    )
    cover_update = apply_playlist_cover_payload(playlist_id, body.cover_data_url)
    if cover_update:
        update_playlist(playlist_id, **cover_update)
    return {"id": playlist_id}


@router.get("/{playlist_id}")
def get_one(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    tracks = get_playlist_tracks(playlist_id)
    pl["tracks"] = tracks
    return pl


@router.put("/{playlist_id}")
def update(request: Request, playlist_id: int, body: UpdatePlaylistRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.cover_data_url is not None:
        kwargs.update(apply_playlist_cover_payload(playlist_id, body.cover_data_url, pl.get("cover_path")) or {})
    if body.smart_rules is not None:
        kwargs["smart_rules"] = body.smart_rules
    if kwargs:
        update_playlist(playlist_id, **kwargs)
    return {"ok": True}


@router.delete("/{playlist_id}")
def delete(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    delete_playlist_cover(pl.get("cover_path"))
    delete_playlist(playlist_id)
    return {"ok": True}


@router.get("/{playlist_id}/cover")
def get_cover(request: Request, playlist_id: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("scope") != "system" and pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    cover_path = playlist_cover_abspath(pl.get("cover_path"))
    if not cover_path or not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    return FileResponse(cover_path)


# ── Tracks ───────────────────────────────────────────────────────

@router.post("/{playlist_id}/tracks")
def add_tracks(request: Request, playlist_id: int, body: AddTracksRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    if not body.tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    add_playlist_tracks(playlist_id, body.tracks)
    return {"ok": True, "added": len(body.tracks)}


@router.delete("/{playlist_id}/tracks/{position}")
def remove_track(request: Request, playlist_id: int, position: int):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    remove_playlist_track(playlist_id, position)
    return {"ok": True}


@router.post("/{playlist_id}/reorder")
def reorder(request: Request, playlist_id: int, body: ReorderRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if pl.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")
    reorder_playlist(playlist_id, body.track_ids)
    return {"ok": True}


# ── Smart playlist generation ───────────────────────────────────

@router.post("/{playlist_id}/generate")
def generate_smart(request: Request, playlist_id: int):
    """Re-generate tracks for a smart playlist based on its rules."""
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl or not pl.get("is_smart") or not pl.get("smart_rules"):
        raise HTTPException(status_code=400, detail="Not a smart playlist or no rules defined")

    rules = pl["smart_rules"]
    tracks = execute_smart_rules(rules)

    # Replace existing tracks
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s", (playlist_id,))

    if tracks:
        add_playlist_tracks(playlist_id, tracks)

    return {"ok": True, "track_count": len(tracks)}
# ── Navidrome sync ───────────────────────────────────────────────

@router.post("/{playlist_id}/sync-navidrome")
def sync_to_navidrome(request: Request, playlist_id: int):
    """Create/update this playlist in Navidrome."""
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    owner_id = pl.get("user_id")
    if owner_id != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")

    identity = get_user_external_identity(owner_id, "navidrome")
    if not identity or identity.get("status") != "synced" or not identity.get("external_username"):
        raise HTTPException(
            status_code=409,
            detail="Navidrome user is not linked yet for this playlist owner",
        )

    task_id = create_task(
        "sync_playlist_navidrome",
        {
            "playlist_id": playlist_id,
            "user_id": owner_id,
            "navidrome_username": identity["external_username"],
        },
    )
    return {"task_id": task_id}
