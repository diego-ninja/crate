"""User personal library: follows, saved albums, likes, play history, feed."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, field_validator, model_validator

from crate.api.auth import _require_auth
from crate.api._deps import artist_name_from_id, coerce_date as _coerce_date

router = APIRouter(prefix="/api/me", tags=["me"])


# ── Models ───────────────────────────────────────────────────

class FollowRequest(BaseModel):
    artist_name: str

class SaveAlbumRequest(BaseModel):
    album_id: int

class LikeTrackRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None

class RecordPlayRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""


class RecordPlayEventRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    started_at: datetime
    ended_at: datetime
    played_seconds: float = 0
    track_duration_seconds: float | None = None
    completion_ratio: float | None = None
    was_skipped: bool = False
    was_completed: bool = False
    play_source_type: str | None = None
    play_source_id: str | None = None
    play_source_name: str | None = None
    context_artist: str | None = None
    context_album: str | None = None
    context_playlist_id: int | None = None
    device_type: str | None = None
    app_platform: str | None = None

    @field_validator("played_seconds")
    @classmethod
    def _validate_played_seconds(cls, value: float) -> float:
        if value < 0:
            raise ValueError("played_seconds must be >= 0")
        return value

    @field_validator("track_duration_seconds")
    @classmethod
    def _validate_track_duration(cls, value: float | None) -> float | None:
        if value is not None and value <= 0:
            raise ValueError("track_duration_seconds must be > 0")
        return value

    @field_validator("completion_ratio")
    @classmethod
    def _validate_completion_ratio(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("completion_ratio must be between 0 and 1")
        return value

    @model_validator(mode="after")
    def _validate_consistency(self):
        if self.started_at > self.ended_at:
            raise ValueError("started_at must be <= ended_at")
        if self.was_skipped and self.was_completed:
            raise ValueError("was_skipped and was_completed cannot both be true")
        if self.track_duration_seconds and self.completion_ratio is not None:
            derived = min(1.0, max(0.0, self.played_seconds / self.track_duration_seconds))
            if abs(derived - self.completion_ratio) > 0.15:
                raise ValueError("completion_ratio does not match played_seconds and track_duration_seconds")
        return self


class ShowReminderRequest(BaseModel):
    reminder_type: str


def _probable_setlists_for_artists(artist_names: list[str]) -> dict[str, list[dict]]:
    from crate.db import get_cache

    result: dict[str, list[dict]] = {}
    missing: list[str] = []
    for artist_name in artist_names:
        cached = get_cache(f"setlistfm:probable:{artist_name.lower()}", max_age_seconds=86400 * 7)
        songs = cached.get("songs") if isinstance(cached, dict) else None
        if songs:
            result[artist_name] = songs
        else:
            missing.append(artist_name)

    # Lazy-fetch from setlist.fm for artists not yet cached
    if missing:
        from crate.setlistfm import get_probable_setlist
        for artist_name in missing:
            try:
                songs = get_probable_setlist(artist_name)
                if songs:
                    result[artist_name] = songs
            except Exception:
                pass

    return result


def _build_upcoming_insights(
    user_id: int,
    shows: list[dict],
    attending_show_ids: set[int],
) -> list[dict]:
    from crate.db import get_show_reminders
    from crate.db.user_library import get_top_artists

    if not shows:
        return []

    reminders = get_show_reminders(user_id, [show["id"] for show in shows if show.get("id") is not None])
    reminder_keys = {(row["show_id"], row["reminder_type"]) for row in reminders}
    hot_artists = {
        row["artist_name"]
        for row in get_top_artists(user_id, window="30d", limit=12)
        if row.get("artist_name")
    }

    today = datetime.now(timezone.utc).date()
    insights: list[dict] = []
    sortable_shows = [(show, _coerce_date(show.get("date")) or today) for show in shows]
    sortable_shows.sort(key=lambda pair: pair[1])
    for show, show_date in sortable_shows:
        show_id = show.get("id")
        if not show_id or show_id not in attending_show_ids:
            continue

        if _coerce_date(show.get("date")) is None:
            continue

        date_str = show_date.isoformat()
        days_until = (show_date - today).days
        artist_name = show.get("artist_name") or ""
        has_setlist = bool(show.get("probable_setlist"))

        if 7 < days_until <= 30 and (show_id, "one_month") not in reminder_keys:
            insights.append({
                "type": "one_month",
                "show_id": show_id,
                "artist": artist_name,
                "artist_id": show.get("artist_id"),
                "artist_slug": show.get("artist_slug"),
                "date": date_str,
                "title": show.get("venue") or artist_name,
                "subtitle": f"{days_until} days to go",
                "message": f"{artist_name} is coming up in about a month.",
                "has_setlist": has_setlist,
            })

        if 1 < days_until <= 7 and (show_id, "one_week") not in reminder_keys:
            insights.append({
                "type": "one_week",
                "show_id": show_id,
                "artist": artist_name,
                "artist_id": show.get("artist_id"),
                "artist_slug": show.get("artist_slug"),
                "date": date_str,
                "title": show.get("venue") or artist_name,
                "subtitle": f"{days_until} days to go",
                "message": f"{artist_name} is coming up this week.",
                "has_setlist": has_setlist,
            })

        if has_setlist and days_until <= 30 and (show_id, "show_prep") not in reminder_keys:
            weight = "high" if artist_name in hot_artists else "normal"
            insights.append({
                "type": "show_prep",
                "show_id": show_id,
                "artist": artist_name,
                "artist_id": show.get("artist_id"),
                "artist_slug": show.get("artist_slug"),
                "date": date_str,
                "title": f"{artist_name} probable setlist",
                "subtitle": "Show prep",
                "message": "Warm up with the likely setlist before the show.",
                "has_setlist": True,
                "weight": weight,
            })

    insights.sort(key=lambda item: (item.get("date", ""), item.get("type", "")))
    return insights[:8]


# ── Library Summary ──────────────────────────────────────────

@router.get("")
def my_library(request: Request):
    """Get counts for user's personal library."""
    user = _require_auth(request)
    from crate.db.user_library import get_user_library_counts
    return get_user_library_counts(user["id"])


@router.get("/sync")
def my_sync_status(request: Request):
    """External service sync status. Returns an empty service list for backwards compat."""
    _require_auth(request)
    return {"services": []}


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


@router.post("/follows/artists/{artist_id}")
def follow_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return follow(request, FollowRequest(artist_name=artist_name))

@router.delete("/follows/{artist_name}")
def unfollow(request: Request, artist_name: str):
    user = _require_auth(request)
    from crate.db.user_library import unfollow_artist
    removed = unfollow_artist(user["id"], artist_name)
    if not removed:
        raise HTTPException(status_code=404, detail="Not following this artist")
    return {"ok": True}


@router.delete("/follows/artists/{artist_id}")
def unfollow_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return unfollow(request, artist_name)

@router.get("/follows/{artist_name}")
def is_following_check(request: Request, artist_name: str):
    user = _require_auth(request)
    from crate.db.user_library import is_following
    return {"following": is_following(user["id"], artist_name)}


@router.get("/follows/artists/{artist_id}")
def is_following_check_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return is_following_check(request, artist_name)


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
    added = like_track(
        user["id"],
        track_id=body.track_id,
        track_path=body.track_path,
        track_storage_id=body.track_storage_id,
    )
    if added is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"ok": True, "added": added}

@router.delete("/likes")
def unlike(request: Request, body: LikeTrackRequest):
    user = _require_auth(request)
    from crate.db.user_library import unlike_track
    removed = unlike_track(
        user["id"],
        track_id=body.track_id,
        track_path=body.track_path,
        track_storage_id=body.track_storage_id,
    )
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
    # Legacy endpoint kept for recently-played surfaces while /play-events becomes the
    # canonical telemetry path. Remove once remaining callers are migrated.
    record_play(
        user["id"],
        track_path=body.track_path or "",
        title=body.title,
        artist=body.artist,
        album=body.album,
        track_id=body.track_id,
        track_storage_id=body.track_storage_id,
    )
    return {"ok": True}

@router.get("/stats")
def stats(request: Request):
    user = _require_auth(request)
    from crate.db.user_library import get_play_stats
    return get_play_stats(user["id"])


@router.get("/stats/overview")
def stats_overview(request: Request, window: str = Query("30d")):
    user = _require_auth(request)
    from crate.db.user_library import get_stats_overview

    try:
        return get_stats_overview(user["id"], window=window)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/trends")
def stats_trends(request: Request, window: str = Query("30d")):
    user = _require_auth(request)
    from crate.db.user_library import get_stats_trends

    try:
        return get_stats_trends(user["id"], window=window)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/top-tracks")
def stats_top_tracks(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    from crate.db.user_library import get_top_tracks

    try:
        return {"window": window, "items": get_top_tracks(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/top-artists")
def stats_top_artists(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    from crate.db.user_library import get_top_artists

    try:
        return {"window": window, "items": get_top_artists(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/top-albums")
def stats_top_albums(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    from crate.db.user_library import get_top_albums

    try:
        return {"window": window, "items": get_top_albums(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/top-genres")
def stats_top_genres(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    from crate.db.user_library import get_top_genres

    try:
        return {"window": window, "items": get_top_genres(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/stats/replay")
def stats_replay(request: Request, window: str = Query("30d"), limit: int = Query(30, ge=1, le=100)):
    user = _require_auth(request)
    from crate.db.user_library import get_replay_mix

    try:
        return get_replay_mix(user["id"], window=window, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/home/discovery")
def home_discovery(request: Request):
    user = _require_auth(request)
    from crate.db.home import get_home_discovery

    return get_home_discovery(user["id"])


@router.get("/home/mixes/{mix_id}")
def home_mix_detail(request: Request, mix_id: str, limit: int = Query(40, ge=1, le=80)):
    user = _require_auth(request)
    from crate.db.home import get_home_playlist

    mix = get_home_playlist(user["id"], mix_id, limit=limit)
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    return mix


@router.get("/home/playlists/{playlist_id}")
def home_playlist_detail(request: Request, playlist_id: str, limit: int = Query(40, ge=1, le=80)):
    user = _require_auth(request)
    from crate.db.home import get_home_playlist

    playlist = get_home_playlist(user["id"], playlist_id, limit=limit)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.get("/home/sections/{section_id}")
def home_section_detail(request: Request, section_id: str, limit: int = Query(42, ge=1, le=120)):
    user = _require_auth(request)
    from crate.db.home import get_home_section

    section = get_home_section(user["id"], section_id, limit=limit)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


@router.post("/play-events")
def record_play_event_endpoint(request: Request, body: RecordPlayEventRequest):
    user = _require_auth(request)
    from crate.db import create_task_dedup
    from crate.db.user_library import record_play_event

    event_id = record_play_event(
        user["id"],
        track_id=body.track_id,
        track_path=body.track_path,
        track_storage_id=body.track_storage_id,
        title=body.title,
        artist=body.artist,
        album=body.album,
        started_at=body.started_at.isoformat(),
        ended_at=body.ended_at.isoformat(),
        played_seconds=body.played_seconds,
        track_duration_seconds=body.track_duration_seconds,
        completion_ratio=body.completion_ratio,
        was_skipped=body.was_skipped,
        was_completed=body.was_completed,
        play_source_type=body.play_source_type,
        play_source_id=body.play_source_id,
        play_source_name=body.play_source_name,
        context_artist=body.context_artist,
        context_album=body.context_album,
        context_playlist_id=body.context_playlist_id,
        device_type=body.device_type,
        app_platform=body.app_platform,
    )
    create_task_dedup("refresh_user_listening_stats", {"user_id": user["id"]})
    return {"ok": True, "id": event_id}


# ── Feed ─────────────────────────────────────────────────────

@router.get("/feed")
def feed(request: Request, limit: int = 30):
    """Personalized feed: new releases from followed artists + new library additions + upcoming shows."""
    user = _require_auth(request)
    from crate.db.user_library import get_followed_artists
    from crate.db.core import get_db_ctx

    followed = get_followed_artists(user["id"])
    followed_names = [f["artist_name"] for f in followed if f.get("artist_name")]

    items = []
    recent_day_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    today = datetime.now(timezone.utc).date()
    with get_db_ctx() as cur:
        if followed_names:
            placeholders = ",".join(["%s"] * len(followed_names))
            cur.execute(f"""
                SELECT 'new_album' AS type, la.artist, la.name AS title, la.year, la.has_cover,
                       la.updated_at AS date
                FROM library_albums la
                WHERE la.artist IN ({placeholders})
                AND la.updated_at >= %s
                ORDER BY la.updated_at DESC
                LIMIT %s
            """, list(followed_names) + [recent_day_cutoff, limit])
            for r in cur.fetchall():
                items.append(dict(r))

            cur.execute(f"""
                SELECT 'show' AS type, s.artist_name AS artist, s.venue AS title,
                       s.city, s.country, s.date, s.url, s.image_url
                FROM shows s
                WHERE s.artist_name IN ({placeholders})
                AND s.date >= %s
                ORDER BY s.date
                LIMIT %s
            """, list(followed_names) + [today, limit])
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

    def _feed_sort_key(item: dict):
        value = item.get("date")
        normalized = _coerce_date(value)
        # Keep rows with missing dates at the bottom.
        return normalized or date.min

    items.sort(key=_feed_sort_key, reverse=True)
    return items[:limit]


@router.get("/upcoming")
def upcoming(request: Request, limit: int = 120):
    """Upcoming releases and shows for followed artists."""
    user = _require_auth(request)
    from crate.db.user_library import get_followed_artists
    from crate.db.core import get_db_ctx
    from crate.db import get_attending_show_ids

    followed = get_followed_artists(user["id"])
    followed_names = [f["artist_name"] for f in followed if f.get("artist_name")]
    if not followed_names:
        return {
            "items": [],
            "insights": [],
            "summary": {
                "followed_artists": 0,
                "show_count": 0,
                "release_count": 0,
                "attending_count": 0,
                "insight_count": 0,
            },
        }

    today = datetime.now(timezone.utc).date()
    recent_cutoff = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    placeholders = ",".join(["%s"] * len(followed_names))

    # Resolve user location for show filtering
    user_lat, user_lon, user_radius = None, None, 60
    location_mode = user.get("show_location_mode") or "fixed"
    if location_mode == "near_me":
        from crate.geolocation import detect_location_from_ip, get_client_ip
        geo = detect_location_from_ip(get_client_ip(request))
        if geo:
            user_lat, user_lon = geo["latitude"], geo["longitude"]
    else:
        user_lat = user.get("latitude")
        user_lon = user.get("longitude")
    user_radius = user.get("show_radius_km") or 60

    items: list[dict] = []
    setlist_map: dict[str, list[dict]] = {}
    with get_db_ctx() as cur:
        cur.execute(
            f"""
            SELECT
                nr.id,
                nr.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                nr.album_title,
                nr.cover_url,
                nr.status,
                nr.tidal_url,
                nr.release_type,
                nr.release_date,
                nr.detected_at
            FROM new_releases nr
            LEFT JOIN library_artists la ON la.name = nr.artist_name
            WHERE nr.artist_name IN ({placeholders})
              AND nr.status != 'dismissed'
              AND (
                (nr.release_date IS NOT NULL AND nr.release_date >= %s)
                OR nr.detected_at >= %s
              )
            ORDER BY COALESCE(nr.release_date, (nr.detected_at AT TIME ZONE 'UTC')::date) ASC
            LIMIT %s
            """,
            followed_names + [today, recent_cutoff, limit],
        )
        for release in cur.fetchall():
            scheduled_date = _coerce_date(release.get("release_date"))
            fallback_date = scheduled_date or _coerce_date(release.get("detected_at"))
            items.append(
                {
                    "type": "release",
                    "date": fallback_date.isoformat() if fallback_date else "",
                    "artist": release.get("artist_name", ""),
                    "artist_id": release.get("artist_id"),
                    "artist_slug": release.get("artist_slug"),
                    "title": release.get("album_title", ""),
                    "subtitle": release.get("release_type") or "Album",
                    "cover_url": release.get("cover_url"),
                    "status": release.get("status", "detected"),
                    "tidal_url": release.get("tidal_url"),
                    "release_id": release.get("id"),
                    "is_upcoming": bool(scheduled_date and scheduled_date >= today),
                }
            )

        cur.execute(
            f"""
            SELECT
                   s.id,
                   s.artist_name,
                   la.id AS artist_id,
                   la.slug AS artist_slug,
                   s.venue,
                   s.address_line1,
                   s.city,
                   s.region,
                   s.postal_code,
                   s.country,
                   s.country_code,
                   s.date,
                   s.local_time,
                   s.url, s.image_url, s.lineup, s.latitude, s.longitude,
                   s.source, s.lastfm_attendance, s.lastfm_url, s.tickets_url
            FROM shows s
            LEFT JOIN library_artists la ON la.name = s.artist_name
            WHERE s.artist_name IN ({placeholders})
              AND s.date >= %s
              AND s.status != 'cancelled'
              {"AND (s.latitude BETWEEN %s AND %s AND s.longitude BETWEEN %s AND %s OR s.latitude IS NULL)" if user_lat else ""}
            ORDER BY s.date ASC
            LIMIT %s
            """,
            followed_names + [today] + (
                [user_lat - user_radius / 111.0, user_lat + user_radius / 111.0,
                 user_lon - user_radius / 70.0, user_lon + user_radius / 70.0]
                if user_lat else []
            ) + [limit],
        )
        shows = cur.fetchall()
        attending_show_ids = get_attending_show_ids(
            user["id"],
            [show["id"] for show in shows if show.get("id") is not None],
        )

        cur.execute(
            f"""
            SELECT ag.artist_name, g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name IN ({placeholders})
            ORDER BY ag.weight DESC
            """,
            followed_names,
        )
        genre_map: dict[str, list[str]] = {}
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])

    show_artists = sorted({show["artist_name"] for show in shows if show.get("artist_name")})
    if show_artists:
        setlist_map = _probable_setlists_for_artists(show_artists)

    for show in shows:
        artist_name = show.get("artist_name", "")
        items.append(
            {
                "id": show.get("id"),
                "type": "show",
                "date": show.get("date"),
                "time": show.get("local_time"),
                "artist": artist_name,
                "artist_id": show.get("artist_id"),
                "artist_slug": show.get("artist_slug"),
                "title": show.get("venue") or "",
                "subtitle": f"{show.get('city', '')}, {show.get('country', '')}".strip(", "),
                "cover_url": show.get("image_url"),
                "status": "onsale",
                "url": show.get("url"),
                "venue": show.get("venue"),
                "address_line1": show.get("address_line1"),
                "city": show.get("city"),
                "region": show.get("region"),
                "postal_code": show.get("postal_code"),
                "country": show.get("country"),
                "country_code": show.get("country_code"),
                "latitude": show.get("latitude"),
                "longitude": show.get("longitude"),
                "lineup": show.get("lineup"),
                "genres": genre_map.get(artist_name, [])[:3],
                "source": show.get("source"),
                "lastfm_attendance": show.get("lastfm_attendance"),
                "lastfm_url": show.get("lastfm_url"),
                "tickets_url": show.get("tickets_url"),
                "probable_setlist": (setlist_map.get(artist_name) or [])[:8],
                "user_attending": show.get("id") in attending_show_ids,
                "is_upcoming": True,
            }
        )

    enriched_shows = [
        {
            **dict(show),
            "probable_setlist": (setlist_map.get(show.get("artist_name", "")) or [])[:8],
        }
        for show in shows
    ]
    insights = _build_upcoming_insights(user["id"], enriched_shows, attending_show_ids)

    return {
        "items": items,
        "insights": insights,
        "summary": {
            "followed_artists": len(followed_names),
            "show_count": len([item for item in items if item["type"] == "show"]),
            "release_count": len([item for item in items if item["type"] == "release"]),
            "attending_count": len(attending_show_ids),
            "insight_count": len(insights),
        },
    }


@router.post("/shows/{show_id}/attendance")
def attend_show_endpoint(request: Request, show_id: int):
    user = _require_auth(request)
    from crate.db import attend_show

    return {"ok": True, "added": attend_show(user["id"], show_id)}


@router.delete("/shows/{show_id}/attendance")
def unattend_show_endpoint(request: Request, show_id: int):
    user = _require_auth(request)
    from crate.db import unattend_show

    return {"ok": True, "removed": unattend_show(user["id"], show_id)}


@router.post("/shows/{show_id}/reminders")
def create_show_reminder_endpoint(request: Request, show_id: int, body: ShowReminderRequest):
    user = _require_auth(request)
    from crate.db import create_show_reminder

    if body.reminder_type not in {"one_month", "one_week", "show_prep"}:
        raise HTTPException(status_code=400, detail="Unsupported reminder type")

    return {"ok": True, "added": create_show_reminder(user["id"], show_id, body.reminder_type)}


# ── Profile ─────────────────────────────────────────────────────

@router.put("/profile")
def update_profile(request: Request, body: dict):
    _require_auth(request)
    user = request.state.user
    from crate.db.auth import update_user
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    updated = update_user(user["id"], name=name)
    return {"ok": True, "name": updated["name"] if updated else name}


@router.put("/password")
def change_password(request: Request, body: dict):
    user = _require_auth(request)
    current = body.get("current_password", "")
    new_pw = body.get("new_password", "")
    if not new_pw or len(new_pw) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    from crate.db.auth import get_user_by_id
    import bcrypt
    db_user = get_user_by_id(user["id"])
    if not db_user or not db_user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Cannot change password for this account")
    if not bcrypt.checkpw(current.encode(), db_user["password_hash"].encode()):
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    new_hash = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    from crate.db.auth import update_user
    update_user(user["id"], password_hash=new_hash)
    return {"ok": True}


# ── Scrobble Services ──────────────────────────────────────────


@router.get("/scrobble/status")
def scrobble_status(request: Request):
    """Get current scrobble service connections."""
    user = _require_auth(request)
    from crate.db import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT provider, status, metadata_json
            FROM user_external_identities
            WHERE user_id = %s AND provider IN ('lastfm', 'listenbrainz')
        """, (user["id"],))
        rows = cur.fetchall()

    result = {}
    for row in rows:
        meta = row.get("metadata_json") or {}
        result[row["provider"]] = {
            "connected": row["status"] == "linked",
            "username": meta.get("username") or meta.get("name"),
        }
    return result


class ListenBrainzConnectRequest(BaseModel):
    token: str


@router.post("/scrobble/listenbrainz")
def connect_listenbrainz(request: Request, body: ListenBrainzConnectRequest):
    """Connect ListenBrainz with a personal API token."""
    user = _require_auth(request)
    import requests as req

    # Validate the token
    try:
        resp = req.get(
            "https://api.listenbrainz.org/1/validate-token",
            headers={"Authorization": f"Token {body.token}"},
            timeout=10,
        )
        if resp.status_code != 200 or not resp.json().get("valid"):
            raise HTTPException(status_code=400, detail="Invalid ListenBrainz token")
        lb_user = resp.json().get("user_name", "")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Could not validate token with ListenBrainz")

    from crate.db.auth import upsert_user_external_identity
    upsert_user_external_identity(
        user_id=user["id"],
        provider="listenbrainz",
        external_user_id=lb_user,
        external_username=lb_user,
        status="linked",
        metadata={"token": body.token, "username": lb_user},
    )
    return {"ok": True, "username": lb_user}


@router.delete("/scrobble/listenbrainz")
def disconnect_listenbrainz(request: Request):
    """Disconnect ListenBrainz."""
    user = _require_auth(request)
    from crate.db.auth import unlink_user_external_identity
    unlink_user_external_identity(user["id"], "listenbrainz")
    return {"ok": True}


@router.get("/scrobble/lastfm/auth-url")
def lastfm_auth_url(request: Request):
    """Return the Last.fm API key so the frontend can build the auth URL."""
    import os
    _require_auth(request)
    api_key = os.environ.get("LASTFM_APIKEY", "")
    if not api_key:
        raise HTTPException(status_code=501, detail="Last.fm API key not configured")
    return {"api_key": api_key}


class LastfmCallbackRequest(BaseModel):
    token: str


@router.post("/scrobble/lastfm")
def connect_lastfm(request: Request, body: LastfmCallbackRequest):
    """Exchange Last.fm auth token for a session key and store it."""
    import os
    user = _require_auth(request)
    api_key = os.environ.get("LASTFM_APIKEY", "")
    api_secret = os.environ.get("LASTFM_API_SECRET", "")
    if not api_key or not api_secret:
        raise HTTPException(status_code=501, detail="Last.fm API not fully configured")

    from crate.scrobble import lastfm_get_session
    session_key = lastfm_get_session(api_key, api_secret, body.token)
    if not session_key:
        raise HTTPException(status_code=400, detail="Failed to get Last.fm session — token may have expired")

    from crate.db.auth import upsert_user_external_identity
    upsert_user_external_identity(
        user_id=user["id"],
        provider="lastfm",
        external_user_id=session_key[:8],
        external_username="",
        status="linked",
        metadata={"session_key": session_key},
    )
    return {"ok": True}


@router.delete("/scrobble/lastfm")
def disconnect_lastfm(request: Request):
    """Disconnect Last.fm scrobbling."""
    user = _require_auth(request)
    from crate.db.auth import unlink_user_external_identity
    unlink_user_external_identity(user["id"], "lastfm")
    return {"ok": True}


# ── Location / Shows Preferences ──────────────────────────────


@router.get("/geolocation")
def detect_geolocation(request: Request):
    """Detect user's city from their IP address."""
    _require_auth(request)
    from crate.geolocation import detect_location_from_ip, get_client_ip
    ip = get_client_ip(request)
    result = detect_location_from_ip(ip)
    if not result:
        raise HTTPException(status_code=404, detail="Could not detect location")
    return result


@router.get("/location")
def get_location(request: Request):
    """Get the user's saved location preferences."""
    user = _require_auth(request)
    return {
        "city": user.get("city"),
        "country": user.get("country"),
        "country_code": user.get("country_code"),
        "latitude": user.get("latitude"),
        "longitude": user.get("longitude"),
        "show_radius_km": user.get("show_radius_km") or 60,
        "show_location_mode": user.get("show_location_mode") or "fixed",
    }


class UpdateLocationBody(BaseModel):
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    show_radius_km: int | None = None
    show_location_mode: str | None = None


@router.put("/location")
def update_location(request: Request, body: UpdateLocationBody):
    """Update the user's location preferences.

    If only city is provided, geocodes it to fill lat/lon/country.
    """
    user = _require_auth(request)
    from crate.db.core import get_db_ctx

    city = (body.city or "").strip() or None
    lat = body.latitude
    lon = body.longitude
    country = (body.country or "").strip() or None
    country_code = (body.country_code or "").strip().upper() or None

    # Geocode if city provided without coordinates
    if city and (lat is None or lon is None):
        from crate.geolocation import geocode_city
        geo = geocode_city(city)
        if geo:
            lat = geo["latitude"]
            lon = geo["longitude"]
            country = country or geo.get("country")
            country_code = country_code or geo.get("country_code")

    radius = body.show_radius_km
    if radius is not None:
        radius = max(10, min(radius, 500))

    mode = body.show_location_mode
    if mode and mode not in ("fixed", "near_me"):
        raise HTTPException(status_code=422, detail="show_location_mode must be 'fixed' or 'near_me'")

    fields: list[str] = []
    values: list[object] = []
    if city is not None:
        fields.append("city = %s"); values.append(city)
    if country is not None:
        fields.append("country = %s"); values.append(country)
    if country_code is not None:
        fields.append("country_code = %s"); values.append(country_code)
    if lat is not None:
        fields.append("latitude = %s"); values.append(lat)
    if lon is not None:
        fields.append("longitude = %s"); values.append(lon)
    if radius is not None:
        fields.append("show_radius_km = %s"); values.append(radius)
    if mode is not None:
        fields.append("show_location_mode = %s"); values.append(mode)

    if fields:
        values.append(user["id"])
        with get_db_ctx() as cur:
            cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = %s", values)

    return {"ok": True}


@router.get("/cities/search")
def search_cities_endpoint(request: Request, q: str = Query("", min_length=2)):
    """Search cities for autocomplete."""
    _require_auth(request)
    from crate.geolocation import search_cities
    return search_cities(q, limit=5)
