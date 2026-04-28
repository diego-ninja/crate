"""User personal library: follows, saved albums, likes, play history, feed."""

import asyncio
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import StreamingResponse

from crate.api._deps import artist_name_from_id, coerce_date as _coerce_date, json_dumps
from crate.api.auth import _require_auth
from crate.api.cache_events import (
    get_invalidation_events_since,
    get_latest_invalidation_event_id,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import OkResponse
from crate.api.schemas.me import (
    ChangePasswordRequest,
    CitySearchResultResponse,
    FollowMutationResponse,
    FollowRequest,
    FeedItemResponse,
    FollowedArtistResponse,
    FollowedPlaylistResponse,
    FollowingStateResponse,
    GeolocationResponse,
    HomeCardResponse,
    HomeDiscoveryResponse,
    HomeSectionResponse,
    LastfmCallbackRequest,
    LastfmAuthUrlResponse,
    LikeMutationResponse,
    LikeTrackRequest,
    LikedTrackResponse,
    LibraryPlaylistsPageResponse,
    ListenBrainzConnectResponse,
    ListenBrainzConnectRequest,
    LocationPreferencesResponse,
    PlayEventRecordedResponse,
    PlayHistoryEntryResponse,
    PlayStatsResponse,
    NowPlayingRequest,
    RecordPlayEventRequest,
    RecordPlayRequest,
    ReplayMixResponse,
    SaveAlbumRequest,
    SaveAlbumResponse,
    SavedAlbumResponse,
    ShowReminderRequest,
    ShowAttendanceAddResponse,
    ShowAttendanceRemoveResponse,
    ShowReminderCreateResponse,
    ScrobbleStatusResponse,
    StatsDashboardResponse,
    StatsOverviewResponse,
    StatsTrendsResponse,
    SyncStatusResponse,
    TopAlbumsResponse,
    TopArtistsResponse,
    TopGenresResponse,
    TopTracksResponse,
    UnlikeMutationResponse,
    MeUpcomingResponse,
    UpdateProfileRequest,
    UpdateProfileResponse,
    UpdateLocationBody,
    UserLibraryCountsResponse,
)
from crate.db.repositories.auth import (
    get_user_by_id,
    unlink_user_external_identity,
    update_user,
    update_user_location,
    upsert_user_external_identity,
)
from crate.db.cache_store import delete_cache, get_cache, set_cache
from crate.db.home import get_cached_home_discovery, get_home_playlist, get_home_section
from crate.db.repositories.playlists import get_followed_system_playlists, get_playlists
from crate.db.snapshot_events import snapshot_channel
from crate.db.queries.user import (
    get_artist_genres_for_names,
    get_feed_new_albums,
    get_feed_new_releases,
    get_feed_shows,
    get_scrobble_identities,
    get_upcoming_releases,
    get_upcoming_shows,
)
from crate.db.queries.shows import get_attending_show_ids, get_show_reminders
from crate.db.queries.user_library import (
    get_followed_artists,
    get_liked_tracks,
    get_play_history,
    get_play_stats,
    get_replay_mix,
    get_saved_albums,
    get_stats_overview,
    get_stats_trends,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
    get_user_library_counts,
    is_following,
)
from crate.db.repositories.shows import attend_show, create_show_reminder, unattend_show
from crate.db.repositories.user_library import (
    follow_artist,
    like_track,
    record_play,
    record_play_event,
    save_album,
    unfollow_artist,
    unlike_track,
    unsave_album,
)

router = APIRouter(prefix="/api/me", tags=["me"])

_ME_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_STATS_DASHBOARD_CACHE_TTL_SECONDS = 90


def _record_home_endpoint_metric(name: str, value: float = 1.0) -> None:
    try:
        from crate.metrics import record, record_counter

        if name.endswith(".ms"):
            record(name, value)
        else:
            record_counter(name)
    except Exception:
        return


def _get_cached_home_endpoint_response(
    *,
    cache_key: str,
    max_age_seconds: int,
    ttl: int,
    compute,
):
    cached = get_cache(cache_key, max_age_seconds=max_age_seconds)
    if cached is not None:
        _record_home_endpoint_metric("home.endpoint_cache.hit")
        return cached

    _record_home_endpoint_metric("home.endpoint_cache.miss")
    started = time.monotonic()
    result = compute()
    elapsed_ms = (time.monotonic() - started) * 1000
    _record_home_endpoint_metric("home.endpoint_compute.ms", elapsed_ms)

    if result is not None:
        set_cache(cache_key, result, ttl=ttl)
    return result


def _get_home_discovery_payload(user_id: int, *, fresh: bool = False) -> dict:
    payload = get_cached_home_discovery(user_id, fresh=fresh)
    return payload if isinstance(payload, dict) else {}


def _get_home_discovery_items(user_id: int, key: str, *, fresh: bool = False) -> list[dict]:
    payload = _get_home_discovery_payload(user_id, fresh=fresh)
    items = payload.get(key)
    return items if isinstance(items, list) else []


_HOME_DISCOVERY_INVALIDATION_SCOPES = {
    "home",
    "follows",
    "likes",
    "saved_albums",
    "history",
    "library",
    "playlists",
    "curation",
    "shows",
    "upcoming",
}
_HOME_DISCOVERY_INVALIDATION_PREFIXES = ("artist:", "album:", "playlist:", "home:user:")


def _is_home_discovery_invalidation(scope: str, user_id: int) -> bool:
    if scope in _HOME_DISCOVERY_INVALIDATION_SCOPES:
        return True
    if scope.startswith("home:user:"):
        return scope == f"home:user:{user_id}"
    return scope.startswith(_HOME_DISCOVERY_INVALIDATION_PREFIXES)


async def _home_discovery_stream(user_id: int, last_event_id: int, *, include_initial: bool = True):
    heartbeat_counter = 0
    if include_initial:
        yield f"data: {json_dumps(_get_home_discovery_payload(user_id))}\n\n"

    try:
        import redis.asyncio as aioredis

        redis = aioredis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
        pubsub = redis.pubsub()
        await pubsub.subscribe(snapshot_channel("home:discovery", str(user_id)))
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(_get_home_discovery_payload(user_id))}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            await asyncio.sleep(1)
            heartbeat_counter += 1
            refresh = False

            for event in get_invalidation_events_since(last_event_id):
                last_event_id = int(event.get("id") or last_event_id)
                scope = str(event.get("scope") or "").strip()
                if _is_home_discovery_invalidation(scope, user_id):
                    refresh = True

            if refresh:
                yield f"id: {last_event_id}\ndata: {json_dumps(_get_home_discovery_payload(user_id, fresh=True))}\n\n"
                heartbeat_counter = 0
            elif heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"


def _probable_setlists_for_artists(artist_names: list[str]) -> dict[str, list[dict]]:
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


def _get_cached_stats_dashboard(
    user_id: int,
    *,
    window: str,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> dict:
    cache_key = (
        f"listen:stats_dashboard:{user_id}:{window}:"
        f"{tracks_limit}:{artists_limit}:{albums_limit}:{genres_limit}:{replay_limit}"
    )
    cached = get_cache(cache_key, max_age_seconds=_STATS_DASHBOARD_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    payload = {
        "window": window,
        "overview": get_stats_overview(user_id, window=window),
        "trends": get_stats_trends(user_id, window=window),
        "top_tracks": {"window": window, "items": get_top_tracks(user_id, window=window, limit=tracks_limit)},
        "top_artists": {"window": window, "items": get_top_artists(user_id, window=window, limit=artists_limit)},
        "top_albums": {"window": window, "items": get_top_albums(user_id, window=window, limit=albums_limit)},
        "top_genres": {"window": window, "items": get_top_genres(user_id, window=window, limit=genres_limit)},
        "replay": get_replay_mix(user_id, window=window, limit=replay_limit),
    }
    set_cache(cache_key, payload, ttl=_STATS_DASHBOARD_CACHE_TTL_SECONDS)
    return payload


def _build_upcoming_insights(
    user_id: int,
    shows: list[dict],
    attending_show_ids: set[int],
) -> list[dict]:
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

@router.get(
    "",
    response_model=UserLibraryCountsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get counts for the current user's library",
)
def my_library(request: Request):
    """Get counts for user's personal library."""
    user = _require_auth(request)
    return get_user_library_counts(user["id"])


@router.get(
    "/sync",
    response_model=SyncStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get external sync status",
)
def my_sync_status(request: Request):
    """External service sync status. Returns an empty service list for backwards compat."""
    _require_auth(request)
    return {"services": []}


@router.get(
    "/followed-playlists",
    response_model=list[FollowedPlaylistResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List followed system playlists",
)
def my_followed_playlists(request: Request):
    user = _require_auth(request)
    playlists = get_followed_system_playlists(user["id"])
    results = []
    for playlist in playlists:
        item = dict(playlist)
        item["follower_count"] = int(item.get("follower_count") or 0)
        item["is_followed"] = True
        results.append(item)
    return results


@router.get(
    "/playlists-page",
    response_model=LibraryPlaylistsPageResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the bundled Listen playlists-library page payload",
)
def my_playlists_page(request: Request):
    user = _require_auth(request)
    return {
        "playlists": get_playlists(user_id=user["id"]),
        "followed_curated_playlists": my_followed_playlists(request),
    }


# ── Follows ──────────────────────────────────────────────────

@router.get(
    "/follows",
    response_model=list[FollowedArtistResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List followed artists",
)
def list_follows(request: Request):
    user = _require_auth(request)
    return get_followed_artists(user["id"])

@router.post(
    "/follows",
    response_model=FollowMutationResponse,
    responses=_ME_RESPONSES,
    summary="Follow an artist by name",
)
def follow(request: Request, body: FollowRequest):
    user = _require_auth(request)
    added = follow_artist(user["id"], body.artist_name)
    return {"ok": True, "added": added}


@router.post(
    "/follows/artists/{artist_id}",
    response_model=FollowMutationResponse,
    responses=_ME_RESPONSES,
    summary="Follow an artist by library id",
)
def follow_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return follow(request, FollowRequest(artist_name=artist_name))

@router.delete(
    "/follows/{artist_name}",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Unfollow an artist by name",
)
def unfollow(request: Request, artist_name: str):
    user = _require_auth(request)
    removed = unfollow_artist(user["id"], artist_name)
    if not removed:
        raise HTTPException(status_code=404, detail="Not following this artist")
    return {"ok": True}


@router.delete(
    "/follows/artists/{artist_id}",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Unfollow an artist by library id",
)
def unfollow_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return unfollow(request, artist_name)

@router.get(
    "/follows/{artist_name}",
    response_model=FollowingStateResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Check whether the current user follows an artist by name",
)
def is_following_check(request: Request, artist_name: str):
    user = _require_auth(request)
    return {"following": is_following(user["id"], artist_name)}


@router.get(
    "/follows/artists/{artist_id}",
    response_model=FollowingStateResponse,
    responses=_ME_RESPONSES,
    summary="Check whether the current user follows an artist by library id",
)
def is_following_check_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    return is_following_check(request, artist_name)


# ── Saved Albums ─────────────────────────────────────────────

@router.get(
    "/albums",
    response_model=list[SavedAlbumResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List saved albums",
)
def list_saved_albums(request: Request):
    user = _require_auth(request)
    return get_saved_albums(user["id"])

@router.post(
    "/albums",
    response_model=SaveAlbumResponse,
    responses=_ME_RESPONSES,
    summary="Save an album to the user's library",
)
def save_album_endpoint(request: Request, body: SaveAlbumRequest):
    user = _require_auth(request)
    added = save_album(user["id"], body.album_id)
    return {"ok": True, "added": added}

@router.delete(
    "/albums/{album_id}",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Remove a saved album",
)
def unsave_album_endpoint(request: Request, album_id: int):
    user = _require_auth(request)
    removed = unsave_album(user["id"], album_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Album not in library")
    return {"ok": True}


# ── Liked Tracks ─────────────────────────────────────────────

@router.get(
    "/likes",
    response_model=list[LikedTrackResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List liked tracks",
)
def list_likes(request: Request, limit: int = 100):
    user = _require_auth(request)
    return get_liked_tracks(user["id"], limit=limit)

@router.post(
    "/likes",
    response_model=LikeMutationResponse,
    responses=_ME_RESPONSES,
    summary="Like a track",
)
def like(request: Request, body: LikeTrackRequest):
    user = _require_auth(request)
    added = like_track(
        user["id"],
        track_id=body.track_id,
        track_path=body.track_path,
        track_storage_id=body.track_storage_id,
    )
    if added is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"ok": True, "added": added}

@router.delete(
    "/likes",
    response_model=UnlikeMutationResponse,
    responses=_ME_RESPONSES,
    summary="Remove a track like",
)
def unlike(request: Request, body: LikeTrackRequest):
    user = _require_auth(request)
    removed = unlike_track(
        user["id"],
        track_id=body.track_id,
        track_path=body.track_path,
        track_storage_id=body.track_storage_id,
    )
    return {"ok": True, "removed": removed}


# ── Play History ─────────────────────────────────────────────

@router.get(
    "/history",
    response_model=list[PlayHistoryEntryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List recent play history",
)
def history(request: Request, limit: int = 50):
    user = _require_auth(request)
    return get_play_history(user["id"], limit=limit)

@router.post(
    "/history",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Record a deprecated legacy play-history entry",
)
def record(request: Request, body: RecordPlayRequest):
    user = _require_auth(request)
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


@router.post(
    "/now-playing",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Update ephemeral now-playing state for the current user",
)
def update_now_playing(request: Request, body: NowPlayingRequest):
    user = _require_auth(request)
    cache_key = f"now_playing:{user['id']}"
    if not body.playing:
        delete_cache(cache_key)
        return {"ok": True}

    payload = {
        "track_id": body.track_id,
        "track_storage_id": body.track_storage_id,
        "track_path": body.track_path,
        "title": body.title,
        "artist": body.artist,
        "album": body.album,
        "started_at": (body.started_at or datetime.now(timezone.utc)).isoformat(),
        "heartbeat_at": datetime.now(timezone.utc).isoformat(),
        "device_type": body.device_type,
        "app_platform": body.app_platform,
    }
    set_cache(cache_key, payload, ttl=90)
    return {"ok": True}

@router.get(
    "/stats",
    response_model=PlayStatsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get all-time listening stats",
)
def stats(request: Request):
    user = _require_auth(request)
    return get_play_stats(user["id"])


@router.get(
    "/stats/overview",
    response_model=StatsOverviewResponse,
    responses=_ME_RESPONSES,
    summary="Get a listening stats overview for a time window",
)
def stats_overview(request: Request, window: str = Query("30d")):
    user = _require_auth(request)
    try:
        return get_stats_overview(user["id"], window=window)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/trends",
    response_model=StatsTrendsResponse,
    responses=_ME_RESPONSES,
    summary="Get daily listening trends for a time window",
)
def stats_trends(request: Request, window: str = Query("30d")):
    user = _require_auth(request)
    try:
        return get_stats_trends(user["id"], window=window)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/top-tracks",
    response_model=TopTracksResponse,
    responses=_ME_RESPONSES,
    summary="Get top tracks for a time window",
)
def stats_top_tracks(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    try:
        return {"window": window, "items": get_top_tracks(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/top-artists",
    response_model=TopArtistsResponse,
    responses=_ME_RESPONSES,
    summary="Get top artists for a time window",
)
def stats_top_artists(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    try:
        return {"window": window, "items": get_top_artists(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/top-albums",
    response_model=TopAlbumsResponse,
    responses=_ME_RESPONSES,
    summary="Get top albums for a time window",
)
def stats_top_albums(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    try:
        return {"window": window, "items": get_top_albums(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/top-genres",
    response_model=TopGenresResponse,
    responses=_ME_RESPONSES,
    summary="Get top genres for a time window",
)
def stats_top_genres(request: Request, window: str = Query("30d"), limit: int = Query(20, ge=1, le=100)):
    user = _require_auth(request)
    try:
        return {"window": window, "items": get_top_genres(user["id"], window=window, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/replay",
    response_model=ReplayMixResponse,
    responses=_ME_RESPONSES,
    summary="Build a replay mix from recent listening",
)
def stats_replay(request: Request, window: str = Query("30d"), limit: int = Query(30, ge=1, le=100)):
    user = _require_auth(request)
    try:
        return get_replay_mix(user["id"], window=window, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/stats/dashboard",
    response_model=StatsDashboardResponse,
    responses=_ME_RESPONSES,
    summary="Get a listen-optimized stats dashboard payload for a time window",
)
def stats_dashboard(
    request: Request,
    window: str = Query("30d"),
    tracks_limit: int = Query(10, ge=1, le=100),
    artists_limit: int = Query(8, ge=1, le=100),
    albums_limit: int = Query(8, ge=1, le=100),
    genres_limit: int = Query(8, ge=1, le=100),
    replay_limit: int = Query(30, ge=1, le=100),
):
    user = _require_auth(request)
    try:
        return _get_cached_stats_dashboard(
            user["id"],
            window=window,
            tracks_limit=tracks_limit,
            artists_limit=artists_limit,
            albums_limit=albums_limit,
            genres_limit=genres_limit,
            replay_limit=replay_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/home/hero",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the home hero artist card",
)
def home_hero(request: Request):
    user = _require_auth(request)
    payload = _get_home_discovery_payload(user["id"], fresh=request.query_params.get("fresh") == "1")
    return payload.get("hero")


@router.get(
    "/home/recently-played",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get recently played items for home",
)
def home_recently_played(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "recently_played", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/mixes",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get personalized mixes for home",
)
def home_mixes(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "custom_mixes", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/suggested-albums",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get suggested albums for home",
)
def home_suggested_albums(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "suggested_albums", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/recommended-tracks",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get recommended tracks for home",
)
def home_recommended_tracks(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "recommended_tracks", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/radio-stations",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get radio stations for home",
)
def home_radio_stations(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "radio_stations", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/favorite-artists",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get favorite artists for home",
)
def home_favorite_artists(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "favorite_artists", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/essentials",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get essentials playlists for home",
)
def home_essentials(request: Request):
    user = _require_auth(request)
    return {"items": _get_home_discovery_items(user["id"], "essentials", fresh=request.query_params.get("fresh") == "1")}


@router.get(
    "/home/discovery",
    response_model=HomeDiscoveryResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Build the personalized home discovery payload (compat)",
)
def home_discovery(request: Request):
    user = _require_auth(request)
    fresh = request.query_params.get("fresh") == "1"
    return get_cached_home_discovery(user["id"], fresh=fresh)


@router.get(
    "/home/discovery-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream personalized home discovery snapshot updates",
)
async def home_discovery_stream(request: Request, initial: bool = Query(True)):
    user = _require_auth(request)
    last_event_id_str = request.headers.get("Last-Event-ID", "0")
    try:
        last_event_id = int(last_event_id_str)
    except (TypeError, ValueError):
        last_event_id = get_latest_invalidation_event_id()

    return StreamingResponse(
        _home_discovery_stream(user["id"], last_event_id, include_initial=initial),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/home/mixes/{mix_id}",
    response_model=HomeCardResponse,
    responses=_ME_RESPONSES,
    summary="Get one personalized home mix",
)
def home_mix_detail(request: Request, mix_id: str, limit: int = Query(40, ge=1, le=80)):
    user = _require_auth(request)
    mix = _get_cached_home_endpoint_response(
        cache_key=f"home_mix:{user['id']}:{mix_id}:{limit}",
        max_age_seconds=300,
        ttl=300,
        compute=lambda: get_home_playlist(user["id"], mix_id, limit=limit),
    )
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    return mix


@router.get(
    "/home/playlists/{playlist_id}",
    response_model=HomeCardResponse,
    responses=_ME_RESPONSES,
    summary="Get one personalized home playlist",
)
def home_playlist_detail(request: Request, playlist_id: str, limit: int = Query(40, ge=1, le=80)):
    user = _require_auth(request)
    playlist = _get_cached_home_endpoint_response(
        cache_key=f"home_playlist:{user['id']}:{playlist_id}:{limit}",
        max_age_seconds=300,
        ttl=300,
        compute=lambda: get_home_playlist(user["id"], playlist_id, limit=limit),
    )
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.get(
    "/home/sections/{section_id}",
    response_model=HomeSectionResponse,
    responses=_ME_RESPONSES,
    summary="Get one expanded home section",
)
def home_section_detail(request: Request, section_id: str, limit: int = Query(42, ge=1, le=120)):
    user = _require_auth(request)
    section = _get_cached_home_endpoint_response(
        cache_key=f"home_section:{user['id']}:{section_id}:{limit}",
        max_age_seconds=300,
        ttl=300,
        compute=lambda: get_home_section(user["id"], section_id, limit=limit),
    )
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


@router.post(
    "/play-events",
    response_model=PlayEventRecordedResponse,
    responses=_ME_RESPONSES,
    summary="Record a rich play event",
)
def record_play_event_endpoint(request: Request, body: RecordPlayEventRequest):
    user = _require_auth(request)
    event_id = record_play_event(
        user["id"],
        client_event_id=body.client_event_id,
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
    return {"ok": True, "id": event_id}


# ── Feed ─────────────────────────────────────────────────────

@router.get(
    "/feed",
    response_model=list[FeedItemResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List the personalized activity feed",
)
def feed(request: Request, limit: int = 30):
    """Personalized feed: new releases from followed artists + new library additions + upcoming shows."""
    user = _require_auth(request)
    followed = get_followed_artists(user["id"])
    followed_names = [f["artist_name"] for f in followed if f.get("artist_name")]

    items: list[dict] = []
    recent_day_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    today = datetime.now(timezone.utc).date()

    if followed_names:
        items.extend(get_feed_new_albums(followed_names, recent_day_cutoff, limit))
        items.extend(get_feed_shows(followed_names, today, limit))

    items.extend(get_feed_new_releases(limit))

    def _feed_sort_key(item: dict):
        value = item.get("date")
        normalized = _coerce_date(value)
        # Keep rows with missing dates at the bottom.
        return normalized or date.min

    items.sort(key=_feed_sort_key, reverse=True)
    return items[:limit]


@router.get(
    "/upcoming",
    response_model=MeUpcomingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List upcoming releases and shows for followed artists",
)
def upcoming(request: Request, limit: int = 120):
    """Upcoming releases and shows for followed artists."""
    user = _require_auth(request)
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

    # Resolve user location for show filtering.
    # The middleware user dict only has JWT fields (id, email, role) — location
    # fields are in the DB, so we read the full user record here.
    full_user = get_user_by_id(user["id"]) or {}
    user_lat, user_lon, user_radius = None, None, 60
    location_mode = full_user.get("show_location_mode") or "fixed"
    if location_mode == "near_me":
        from crate.geolocation import detect_location_from_ip, get_client_ip
        geo = detect_location_from_ip(get_client_ip(request))
        if geo:
            user_lat, user_lon = geo["latitude"], geo["longitude"]
    else:
        user_lat = full_user.get("latitude")
        user_lon = full_user.get("longitude")
    user_radius = full_user.get("show_radius_km") or 60

    items: list[dict] = []
    setlist_map: dict[str, list[dict]] = {}

    releases = get_upcoming_releases(followed_names, today, recent_cutoff, limit)
    for release in releases:
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

    shows = get_upcoming_shows(followed_names, today, user_lat, user_lon, user_radius, limit)
    attending_show_ids = get_attending_show_ids(
        user["id"],
        [show["id"] for show in shows if show.get("id") is not None],
    )

    genre_map = get_artist_genres_for_names(followed_names)

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


@router.post(
    "/shows/{show_id}/attendance",
    response_model=ShowAttendanceAddResponse,
    responses=_ME_RESPONSES,
    summary="Mark the current user as attending a show",
)
def attend_show_endpoint(request: Request, show_id: int):
    user = _require_auth(request)
    return {"ok": True, "added": attend_show(user["id"], show_id)}


@router.delete(
    "/shows/{show_id}/attendance",
    response_model=ShowAttendanceRemoveResponse,
    responses=_ME_RESPONSES,
    summary="Remove the current user's attendance for a show",
)
def unattend_show_endpoint(request: Request, show_id: int):
    user = _require_auth(request)
    return {"ok": True, "removed": unattend_show(user["id"], show_id)}


@router.post(
    "/shows/{show_id}/reminders",
    response_model=ShowReminderCreateResponse,
    responses=_ME_RESPONSES,
    summary="Create a reminder for an upcoming show",
)
def create_show_reminder_endpoint(request: Request, show_id: int, body: ShowReminderRequest):
    user = _require_auth(request)
    if body.reminder_type not in {"one_month", "one_week", "show_prep"}:
        raise HTTPException(status_code=400, detail="Unsupported reminder type")

    return {"ok": True, "added": create_show_reminder(user["id"], show_id, body.reminder_type)}


# ── Profile ─────────────────────────────────────────────────────

@router.put(
    "/profile",
    response_model=UpdateProfileResponse,
    responses=_ME_RESPONSES,
    summary="Update the current user's profile",
)
def update_profile(request: Request, body: UpdateProfileRequest):
    _require_auth(request)
    user = request.state.user
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    updated = update_user(user["id"], name=name)
    return {"ok": True, "name": updated["name"] if updated else name}


@router.put(
    "/password",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Change the current user's password",
)
def change_password(request: Request, body: ChangePasswordRequest):
    user = _require_auth(request)
    current = body.current_password
    new_pw = body.new_password
    if not new_pw or len(new_pw) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    import bcrypt
    db_user = get_user_by_id(user["id"])
    if not db_user or not db_user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Cannot change password for this account")
    if not bcrypt.checkpw(current.encode(), db_user["password_hash"].encode()):
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    new_hash = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    update_user(user["id"], password_hash=new_hash)
    return {"ok": True}


# ── Scrobble Services ──────────────────────────────────────────


@router.get(
    "/scrobble/status",
    response_model=ScrobbleStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get scrobble service connection status",
)
def scrobble_status(request: Request):
    """Get current scrobble service connections."""
    user = _require_auth(request)
    rows = get_scrobble_identities(user["id"])

    result = {}
    for row in rows:
        meta = row.get("metadata_json") or {}
        result[row["provider"]] = {
            "connected": row["status"] == "linked",
            "username": meta.get("username") or meta.get("name"),
        }
    return result

@router.post(
    "/scrobble/listenbrainz",
    response_model=ListenBrainzConnectResponse,
    responses=_ME_RESPONSES,
    summary="Connect ListenBrainz with a personal token",
)
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

    upsert_user_external_identity(
        user_id=user["id"],
        provider="listenbrainz",
        external_user_id=lb_user,
        external_username=lb_user,
        status="linked",
        metadata={"token": body.token, "username": lb_user},
    )
    return {"ok": True, "username": lb_user}


@router.delete(
    "/scrobble/listenbrainz",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Disconnect ListenBrainz",
)
def disconnect_listenbrainz(request: Request):
    """Disconnect ListenBrainz."""
    user = _require_auth(request)
    unlink_user_external_identity(user["id"], "listenbrainz")
    return {"ok": True}


@router.get(
    "/scrobble/lastfm/auth-url",
    response_model=LastfmAuthUrlResponse,
    responses=_ME_RESPONSES,
    summary="Get the Last.fm API key for browser auth",
)
def lastfm_auth_url(request: Request):
    """Return the Last.fm API key so the frontend can build the auth URL."""
    import os
    _require_auth(request)
    api_key = os.environ.get("LASTFM_APIKEY", "")
    if not api_key:
        raise HTTPException(status_code=501, detail="Last.fm API key not configured")
    return {"api_key": api_key}

@router.post(
    "/scrobble/lastfm",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Exchange a Last.fm auth token for a stored session",
)
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

    upsert_user_external_identity(
        user_id=user["id"],
        provider="lastfm",
        external_user_id=session_key[:8],
        external_username="",
        status="linked",
        metadata={"session_key": session_key},
    )
    return {"ok": True}


@router.delete(
    "/scrobble/lastfm",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Disconnect Last.fm scrobbling",
)
def disconnect_lastfm(request: Request):
    """Disconnect Last.fm scrobbling."""
    user = _require_auth(request)
    unlink_user_external_identity(user["id"], "lastfm")
    return {"ok": True}


# ── Location / Shows Preferences ──────────────────────────────


@router.get(
    "/geolocation",
    response_model=GeolocationResponse,
    responses=_ME_RESPONSES,
    summary="Detect the user's location from their IP address",
)
def detect_geolocation(request: Request):
    """Detect user's city from their IP address."""
    _require_auth(request)
    from crate.geolocation import detect_location_from_ip, get_client_ip
    ip = get_client_ip(request)
    result = detect_location_from_ip(ip)
    if not result:
        raise HTTPException(status_code=404, detail="Could not detect location")
    return result


@router.get(
    "/location",
    response_model=LocationPreferencesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get saved show-location preferences",
)
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

@router.put(
    "/location",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Update saved show-location preferences",
)
def update_location(request: Request, body: UpdateLocationBody):
    """Update the user's location preferences.

    If only city is provided, geocodes it to fill lat/lon/country.
    """
    user = _require_auth(request)
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

    updates: dict[str, object] = {}
    if city is not None:
        updates["city"] = city
    if country is not None:
        updates["country"] = country
    if country_code is not None:
        updates["country_code"] = country_code
    if lat is not None:
        updates["latitude"] = lat
    if lon is not None:
        updates["longitude"] = lon
    if radius is not None:
        updates["show_radius_km"] = radius
    if mode is not None:
        updates["show_location_mode"] = mode

    if updates:
        update_user_location(user["id"], **updates)

    return {"ok": True}


@router.get(
    "/cities/search",
    response_model=list[CitySearchResultResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="Search cities for show-location autocomplete",
)
def search_cities_endpoint(request: Request, q: str = Query("", min_length=2)):
    """Search cities for autocomplete."""
    _require_auth(request)
    from crate.geolocation import search_cities
    return search_cities(q, limit=5)
