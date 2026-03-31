"""User personal library: follows, saved albums, likes, play history, feed."""

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from crate.api.auth import _require_auth

router = APIRouter(prefix="/api/me", tags=["me"])


# ── Models ───────────────────────────────────────────────────

class FollowRequest(BaseModel):
    artist_name: str

class SaveAlbumRequest(BaseModel):
    album_id: int

class LikeTrackRequest(BaseModel):
    track_id: int | None = None
    track_path: str | None = None

class RecordPlayRequest(BaseModel):
    track_id: int | None = None
    track_path: str
    title: str = ""
    artist: str = ""
    album: str = ""


# ── Library Summary ──────────────────────────────────────────

@router.get("")
def my_library(request: Request):
    """Get counts for user's personal library."""
    user = _require_auth(request)
    from crate.db.user_library import get_user_library_counts
    return get_user_library_counts(user["id"])


@router.get("/sync")
def my_sync_status(request: Request):
    user = _require_auth(request)
    from crate import navidrome
    from crate.db import get_user_external_identity

    identity = get_user_external_identity(user["id"], "navidrome")
    return {
        "navidrome_connected": navidrome.ping(),
        "navidrome": identity or {
            "provider": "navidrome",
            "status": "unlinked",
            "external_username": None,
            "last_error": None,
            "last_task_id": None,
            "last_synced_at": None,
        },
    }


@router.get("/followed-playlists")
def my_followed_playlists(request: Request):
    user = _require_auth(request)
    from crate.db import get_followed_system_playlists, get_playlist_followers_count

    playlists = get_followed_system_playlists(user["id"])
    results = []
    for playlist in playlists:
        item = dict(playlist)
        item["follower_count"] = get_playlist_followers_count(item["id"])
        item["is_followed"] = True
        results.append(item)
    return results


# ── Follows ──────────────────────────────────────────────────

@router.get("/follows")
def list_follows(request: Request):
    user = _require_auth(request)
    from crate.db.user_library import get_followed_artists
    return get_followed_artists(user["id"])

@router.post("/follows")
def follow(request: Request, body: FollowRequest):
    user = _require_auth(request)
    from crate.db.user_library import follow_artist
    added = follow_artist(user["id"], body.artist_name)
    return {"ok": True, "added": added}

@router.delete("/follows/{artist_name}")
def unfollow(request: Request, artist_name: str):
    user = _require_auth(request)
    from crate.db.user_library import unfollow_artist
    removed = unfollow_artist(user["id"], artist_name)
    if not removed:
        raise HTTPException(status_code=404, detail="Not following this artist")
    return {"ok": True}

@router.get("/follows/{artist_name}")
def is_following_check(request: Request, artist_name: str):
    user = _require_auth(request)
    from crate.db.user_library import is_following
    return {"following": is_following(user["id"], artist_name)}


# ── Saved Albums ─────────────────────────────────────────────

@router.get("/albums")
def list_saved_albums(request: Request):
    user = _require_auth(request)
    from crate.db.user_library import get_saved_albums
    return get_saved_albums(user["id"])

@router.post("/albums")
def save_album_endpoint(request: Request, body: SaveAlbumRequest):
    user = _require_auth(request)
    from crate.db.user_library import save_album
    added = save_album(user["id"], body.album_id)
    return {"ok": True, "added": added}

@router.delete("/albums/{album_id}")
def unsave_album_endpoint(request: Request, album_id: int):
    user = _require_auth(request)
    from crate.db.user_library import unsave_album
    removed = unsave_album(user["id"], album_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Album not in library")
    return {"ok": True}


# ── Liked Tracks ─────────────────────────────────────────────

@router.get("/likes")
def list_likes(request: Request, limit: int = 100):
    user = _require_auth(request)
    from crate.db.user_library import get_liked_tracks
    return get_liked_tracks(user["id"], limit=limit)

@router.post("/likes")
def like(request: Request, body: LikeTrackRequest):
    user = _require_auth(request)
    from crate.db.user_library import like_track
    added = like_track(user["id"], track_id=body.track_id, track_path=body.track_path)
    if added is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"ok": True, "added": added}

@router.delete("/likes")
def unlike(request: Request, body: LikeTrackRequest):
    user = _require_auth(request)
    from crate.db.user_library import unlike_track
    removed = unlike_track(user["id"], track_id=body.track_id, track_path=body.track_path)
    return {"ok": True, "removed": removed}


# ── Play History ─────────────────────────────────────────────

@router.get("/history")
def history(request: Request, limit: int = 50):
    user = _require_auth(request)
    from crate.db.user_library import get_play_history
    return get_play_history(user["id"], limit=limit)

@router.post("/history")
def record(request: Request, body: RecordPlayRequest):
    user = _require_auth(request)
    from crate.db.user_library import record_play
    record_play(
        user["id"],
        track_path=body.track_path,
        title=body.title,
        artist=body.artist,
        album=body.album,
        track_id=body.track_id,
    )
    return {"ok": True}

@router.get("/stats")
def stats(request: Request):
    user = _require_auth(request)
    from crate.db.user_library import get_play_stats
    return get_play_stats(user["id"])


# ── Feed ─────────────────────────────────────────────────────

@router.get("/feed")
def feed(request: Request, limit: int = 30):
    """Personalized feed: new releases from followed artists + new library additions + upcoming shows."""
    user = _require_auth(request)
    from crate.db.user_library import get_followed_artists
    from crate.db.core import get_db_ctx

    followed = get_followed_artists(user["id"])
    followed_names = {f["artist_name"] for f in followed}

    items = []
    with get_db_ctx() as cur:
        if followed_names:
            placeholders = ",".join(["%s"] * len(followed_names))
            cur.execute(f"""
                SELECT 'new_album' AS type, la.artist, la.name AS title, la.year, la.has_cover,
                       la.updated_at AS date
                FROM library_albums la
                WHERE la.artist IN ({placeholders})
                AND la.updated_at > (NOW() AT TIME ZONE 'UTC' - INTERVAL '30 days')::text
                ORDER BY la.updated_at DESC
                LIMIT %s
            """, list(followed_names) + [limit])
            for r in cur.fetchall():
                items.append(dict(r))

            cur.execute(f"""
                SELECT 'show' AS type, s.artist_name AS artist, s.venue AS title,
                       s.city, s.country, s.date, s.url, s.image_url
                FROM shows s
                WHERE s.artist_name IN ({placeholders})
                AND s.date >= CURRENT_DATE::text
                ORDER BY s.date
                LIMIT %s
            """, list(followed_names) + [limit])
            for r in cur.fetchall():
                items.append(dict(r))

        cur.execute("""
            SELECT 'release' AS type, nr.artist_name AS artist, nr.album_title AS title,
                   nr.cover_url, nr.year, nr.status, nr.detected_at AS date
            FROM new_releases nr
            WHERE nr.status != 'dismissed'
            ORDER BY nr.detected_at DESC
            LIMIT %s
        """, (limit,))
        for r in cur.fetchall():
            items.append(dict(r))

    items.sort(key=lambda x: x.get("date", ""), reverse=True)
    return items[:limit]
