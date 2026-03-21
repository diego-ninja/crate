from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from musicdock.api.auth import _require_auth
from musicdock.db import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    remove_playlist_track, reorder_playlist, get_db_ctx, create_task,
)

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class CreatePlaylistRequest(BaseModel):
    name: str
    description: str = ""
    is_smart: bool = False
    smart_rules: dict | None = None


class UpdatePlaylistRequest(BaseModel):
    name: str | None = None
    description: str | None = None
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
    from musicdock.db import get_all_genres
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
    playlists = get_playlists()
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
    return {"id": playlist_id}


@router.get("/{playlist_id}")
def get_one(request: Request, playlist_id: int):
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    tracks = get_playlist_tracks(playlist_id)
    pl["tracks"] = tracks
    return pl


@router.put("/{playlist_id}")
def update(request: Request, playlist_id: int, body: UpdatePlaylistRequest):
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.smart_rules is not None:
        kwargs["smart_rules"] = body.smart_rules
    if kwargs:
        update_playlist(playlist_id, **kwargs)
    return {"ok": True}


@router.delete("/{playlist_id}")
def delete(request: Request, playlist_id: int):
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    delete_playlist(playlist_id)
    return {"ok": True}


# ── Tracks ───────────────────────────────────────────────────────

@router.post("/{playlist_id}/tracks")
def add_tracks(request: Request, playlist_id: int, body: AddTracksRequest):
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if not body.tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    add_playlist_tracks(playlist_id, body.tracks)
    return {"ok": True, "added": len(body.tracks)}


@router.delete("/{playlist_id}/tracks/{position}")
def remove_track(request: Request, playlist_id: int, position: int):
    _require_auth(request)
    remove_playlist_track(playlist_id, position)
    return {"ok": True}


@router.post("/{playlist_id}/reorder")
def reorder(request: Request, playlist_id: int, body: ReorderRequest):
    _require_auth(request)
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
    tracks = _execute_smart_rules(rules)

    # Replace existing tracks
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s", (playlist_id,))

    if tracks:
        add_playlist_tracks(playlist_id, tracks)

    return {"ok": True, "track_count": len(tracks)}


def _execute_smart_rules(rules: dict) -> list[dict]:
    """Execute smart playlist rules against the library DB."""
    match_mode = rules.get("match", "all")  # "all" or "any"
    rule_list = rules.get("rules", [])
    limit = rules.get("limit", 50)
    sort = rules.get("sort", "random")

    conditions = []
    params: list = []

    for rule in rule_list:
        field = rule.get("field", "")
        op = rule.get("op", "")
        value = rule.get("value")

        if field == "genre" and op == "contains":
            if isinstance(value, str) and "|" in value:
                genre_vals = [v.strip() for v in value.split("|") if v.strip()]
                or_parts = []
                for gv in genre_vals:
                    or_parts.append("(t.genre ILIKE %s OR a_artist.tags_json::text ILIKE %s)")
                    params.extend([f"%{gv}%", f"%{gv}%"])
                conditions.append(f"({' OR '.join(or_parts)})")
            else:
                conditions.append("(t.genre ILIKE %s OR a_artist.tags_json::text ILIKE %s)")
                params.extend([f"%{value}%", f"%{value}%"])
        elif field == "bpm" and op == "between" and isinstance(value, list):
            conditions.append("t.bpm BETWEEN %s AND %s")
            params.extend(value[:2])
        elif field == "energy" and op == "gte":
            conditions.append("t.energy >= %s")
            params.append(value)
        elif field == "energy" and op == "lte":
            conditions.append("t.energy <= %s")
            params.append(value)
        elif field == "year" and op == "between" and isinstance(value, list):
            conditions.append("t.year BETWEEN %s AND %s")
            params.extend([str(v) for v in value[:2]])
        elif field == "audio_key" and op == "eq":
            conditions.append("t.audio_key = %s")
            params.append(value)
        elif field == "danceability" and op == "gte":
            conditions.append("t.danceability >= %s")
            params.append(value)
        elif field == "valence" and op == "gte":
            conditions.append("t.valence >= %s")
            params.append(value)
        elif field == "artist" and op == "eq":
            if isinstance(value, str) and "|" in value:
                vals = [v.strip() for v in value.split("|") if v.strip()]
                conditions.append(f"t.artist IN ({','.join(['%s']*len(vals))})")
                params.extend(vals)
            else:
                conditions.append("t.artist = %s")
                params.append(value)
        elif field == "popularity" and op == "gte":
            conditions.append("t.popularity >= %s")
            params.append(int(value))
        elif field == "popularity" and op == "lte":
            conditions.append("t.popularity <= %s")
            params.append(int(value))
        elif field == "popularity" and op == "between" and isinstance(value, list):
            conditions.append("t.popularity BETWEEN %s AND %s")
            params.extend([int(v) for v in value[:2]])
        elif field == "format" and op == "eq":
            if isinstance(value, str) and "|" in value:
                vals = [v.strip() for v in value.split("|") if v.strip()]
                conditions.append(f"t.format IN ({','.join(['%s']*len(vals))})")
                params.extend(vals)
            else:
                conditions.append("t.format = %s")
                params.append(value)

    joiner = " AND " if match_mode == "all" else " OR "
    where = joiner.join(conditions) if conditions else "1=1"

    sort_map = {
        "random": "RANDOM()",
        "popularity": "t.popularity DESC NULLS LAST",
        "bpm": "t.bpm ASC NULLS LAST",
        "energy": "t.energy DESC NULLS LAST",
        "title": "t.title ASC",
    }
    sort_clause = sort_map.get(sort, "RANDOM()")

    query = f"""
        SELECT t.path, t.title, t.artist, t.album, t.duration
        FROM library_tracks t
        LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
        WHERE {where}
        ORDER BY {sort_clause}
        LIMIT %s
    """
    params.append(limit)

    with get_db_ctx() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    return [dict(r) for r in rows]


# ── Navidrome sync ───────────────────────────────────────────────

@router.post("/{playlist_id}/sync-navidrome")
def sync_to_navidrome(request: Request, playlist_id: int):
    """Create/update this playlist in Navidrome."""
    _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    task_id = create_task("sync_playlist_navidrome", {"playlist_id": playlist_id})
    return {"task_id": task_id}
