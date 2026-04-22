"""User personal library: follows, saved albums, likes, play history, feed."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api._deps import artist_name_from_id, coerce_date as _coerce_date
from crate.api.auth import _require_auth
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

router = APIRouter(prefix="/api/me", tags=["me"])

_ME_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


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

@router.get(
    "",
    response_model=UserLibraryCountsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get counts for the current user's library",
)
def my_library(request: Request):
    """Get counts for user's personal library."""
    user = _require_auth(request)
    from crate.db.user_library import get_user_library_counts
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

@router.get(
    "/follows",
    response_model=list[FollowedArtistResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List followed artists",
)
def list_follows(request: Request):
    user = _require_auth(request)
    from crate.db.user_library import get_followed_artists
    return get_followed_artists(user["id"])

@router.post(
    "/follows",
    response_model=FollowMutationResponse,
    responses=_ME_RESPONSES,
    summary="Follow an artist by name",
)
def follow(request: Request, body: FollowRequest):
    user = _require_auth(request)
    from crate.db.user_library import follow_artist
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
    from crate.db.user_library import unfollow_artist
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
    from crate.db.user_library import is_following
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
    from crate.db.user_library import get_saved_albums
    return get_saved_albums(user["id"])

@router.post(
    "/albums",
    response_model=SaveAlbumResponse,
    responses=_ME_RESPONSES,
    summary="Save an album to the user's library",
)
def save_album_endpoint(request: Request, body: SaveAlbumRequest):
    user = _require_auth(request)
    from crate.db.user_library import save_album
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
    from crate.db.user_library import unsave_album
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
    from crate.db.user_library import get_liked_tracks
    return get_liked_tracks(user["id"], limit=limit)

@router.post(
    "/likes",
    response_model=LikeMutationResponse,
    responses=_ME_RESPONSES,
    summary="Like a track",
)
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

@router.delete(
    "/likes",
    response_model=UnlikeMutationResponse,
    responses=_ME_RESPONSES,
    summary="Remove a track like",
)
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

@router.get(
    "/history",
    response_model=list[PlayHistoryEntryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List recent play history",
)
def history(request: Request, limit: int = 50):
    user = _require_auth(request)
    from crate.db.user_library import get_play_history
    return get_play_history(user["id"], limit=limit)

@router.post(
    "/history",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Record a legacy play-history entry",
)
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


@router.post(
    "/now-playing",
    response_model=OkResponse,
    responses=_ME_RESPONSES,
    summary="Update ephemeral now-playing state for the current user",
)
def update_now_playing(request: Request, body: NowPlayingRequest):
    user = _require_auth(request)
    from crate.db import delete_cache, set_cache

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
    from crate.db.user_library import get_play_stats
    return get_play_stats(user["id"])


@router.get(
    "/stats/overview",
    response_model=StatsOverviewResponse,
    responses=_ME_RESPONSES,
    summary="Get a listening stats overview for a time window",
)
def stats_overview(request: Request, window: str = Query("30d")):
    user = _require_auth(request)
    from crate.db.user_library import get_stats_overview

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
    from crate.db.user_library import get_stats_trends

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
    from crate.db.user_library import get_top_tracks

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
    from crate.db.user_library import get_top_artists

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
    from crate.db.user_library import get_top_albums

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
    from crate.db.user_library import get_top_genres

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
    from crate.db.user_library import get_replay_mix

    try:
        return get_replay_mix(user["id"], window=window, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/home/hero",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the home hero artist card",
)
def home_hero(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_hero
    cache_key = f"home:hero:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=600)
    if cached is not None:
        return cached
    result = get_home_hero(user["id"])
    set_cache(cache_key, result, ttl=600)
    return result


@router.get(
    "/home/recently-played",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get recently played items for home",
)
def home_recently_played(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_recently_played
    cache_key = f"home:recently_played:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=60)
    if cached is not None:
        return cached
    result = {"items": get_home_recently_played(user["id"])}
    set_cache(cache_key, result, ttl=60)
    return result


@router.get(
    "/home/mixes",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get personalized mixes for home",
)
def home_mixes(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_mixes
    cache_key = f"home:mixes:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached is not None:
        return cached
    result = {"items": get_home_mixes(user["id"])}
    set_cache(cache_key, result, ttl=300)
    return result


@router.get(
    "/home/suggested-albums",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get suggested albums for home",
)
def home_suggested_albums(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_suggested_albums
    cache_key = f"home:suggested_albums:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached is not None:
        return cached
    result = {"items": get_home_suggested_albums(user["id"])}
    set_cache(cache_key, result, ttl=300)
    return result


@router.get(
    "/home/recommended-tracks",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get recommended tracks for home",
)
def home_recommended_tracks(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_recommended_tracks
    cache_key = f"home:recommended_tracks:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached is not None:
        return cached
    result = {"items": get_home_recommended_tracks(user["id"])}
    set_cache(cache_key, result, ttl=300)
    return result


@router.get(
    "/home/radio-stations",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get radio stations for home",
)
def home_radio_stations(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_radio_stations
    cache_key = f"home:radio_stations:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached is not None:
        return cached
    result = {"items": get_home_radio_stations(user["id"])}
    set_cache(cache_key, result, ttl=300)
    return result


@router.get(
    "/home/favorite-artists",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get favorite artists for home",
)
def home_favorite_artists(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_favorite_artists
    cache_key = f"home:favorite_artists:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached is not None:
        return cached
    result = {"items": get_home_favorite_artists(user["id"])}
    set_cache(cache_key, result, ttl=300)
    return result


@router.get(
    "/home/essentials",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get essentials playlists for home",
)
def home_essentials(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_essentials
    cache_key = f"home:essentials:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=600)
    if cached is not None:
        return cached
    result = {"items": get_home_essentials(user["id"])}
    set_cache(cache_key, result, ttl=600)
    return result


@router.get(
    "/home/discovery",
    response_model=HomeDiscoveryResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Build the personalized home discovery payload (compat)",
)
def home_discovery(request: Request):
    user = _require_auth(request)
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_discovery
    import logging

    cache_key = f"home:discovery:{user['id']}"

    # The discovery payload is the most expensive endpoint in the whole
    # API (~10 heavy queries, JOINs across genres + similarities + follows).
    # A 60 s cache prevents hammering the DB on quick navigations (open
    # home → go to album → come back → home). Pull-to-refresh bypasses
    # this via the `?fresh=1` param.
    fresh = request.query_params.get("fresh") == "1"
    if not fresh:
        cached = get_cache(cache_key, max_age_seconds=600)
        if cached is not None:
            return cached

    try:
        result = get_home_discovery(user["id"])
        set_cache(cache_key, result, ttl=600)
        return result
    except Exception as exc:
        # If the heavy computation fails (timeout, data edge case, pool
        # exhaustion), return the last successful payload rather than a
        # blank 500 that hides the entire home. Stale-but-visible is
        # strictly better than broken-and-empty.
        logging.getLogger(__name__).warning(
            "home/discovery failed for user %s, falling back to cache: %s",
            user["id"],
            exc,
        )
        stale = get_cache(cache_key, max_age_seconds=3600)
        if stale is not None:
            return stale
        raise


@router.get(
    "/home/mixes/{mix_id}",
    response_model=HomeCardResponse,
    responses=_ME_RESPONSES,
    summary="Get one personalized home mix",
)
def home_mix_detail(request: Request, mix_id: str, limit: int = Query(40, ge=1, le=80)):
    user = _require_auth(request)
    from crate.db.home import get_home_playlist

    mix = get_home_playlist(user["id"], mix_id, limit=limit)
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
    from crate.db import get_cache, set_cache
    from crate.db.home import get_home_playlist

    # Cache home playlists for 5 minutes — they're expensive to compute
    cache_key = f"home_playlist:{user['id']}:{playlist_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=300)
    if cached:
        return cached

    playlist = get_home_playlist(user["id"], playlist_id, limit=limit)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    set_cache(cache_key, playlist, ttl=300)
    return playlist


@router.get(
    "/home/sections/{section_id}",
    response_model=HomeSectionResponse,
    responses=_ME_RESPONSES,
    summary="Get one expanded home section",
)
def home_section_detail(request: Request, section_id: str, limit: int = Query(42, ge=1, le=120)):
    user = _require_auth(request)
    from crate.db.home import get_home_section

    section = get_home_section(user["id"], section_id, limit=limit)
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
    # Debounce stats refresh — at most once per 10 minutes per user
    from crate.db import get_cache, set_cache
    debounce_key = f"stats_refresh_debounce:{user['id']}"
    if not get_cache(debounce_key, max_age_seconds=600):
        create_task_dedup("refresh_user_listening_stats", {"user_id": user["id"]})
        set_cache(debounce_key, True, ttl=600)
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
    from crate.db.user_library import get_followed_artists
    from crate.db.queries.user import get_feed_new_albums, get_feed_shows, get_feed_new_releases

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
    from crate.db.user_library import get_followed_artists
    from crate.db import get_attending_show_ids
    from crate.db.queries.user import get_upcoming_releases, get_upcoming_shows, get_artist_genres_for_names

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
    from crate.db.auth import get_user_by_id
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
    from crate.db import attend_show

    return {"ok": True, "added": attend_show(user["id"], show_id)}


@router.delete(
    "/shows/{show_id}/attendance",
    response_model=ShowAttendanceRemoveResponse,
    responses=_ME_RESPONSES,
    summary="Remove the current user's attendance for a show",
)
def unattend_show_endpoint(request: Request, show_id: int):
    user = _require_auth(request)
    from crate.db import unattend_show

    return {"ok": True, "removed": unattend_show(user["id"], show_id)}


@router.post(
    "/shows/{show_id}/reminders",
    response_model=ShowReminderCreateResponse,
    responses=_ME_RESPONSES,
    summary="Create a reminder for an upcoming show",
)
def create_show_reminder_endpoint(request: Request, show_id: int, body: ShowReminderRequest):
    user = _require_auth(request)
    from crate.db import create_show_reminder

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
    from crate.db.auth import update_user
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


@router.get(
    "/scrobble/status",
    response_model=ScrobbleStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get scrobble service connection status",
)
def scrobble_status(request: Request):
    """Get current scrobble service connections."""
    user = _require_auth(request)
    from crate.db.queries.user import get_scrobble_identities
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


@router.delete(
    "/scrobble/listenbrainz",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Disconnect ListenBrainz",
)
def disconnect_listenbrainz(request: Request):
    """Disconnect ListenBrainz."""
    user = _require_auth(request)
    from crate.db.auth import unlink_user_external_identity
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


@router.delete(
    "/scrobble/lastfm",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Disconnect Last.fm scrobbling",
)
def disconnect_lastfm(request: Request):
    """Disconnect Last.fm scrobbling."""
    user = _require_auth(request)
    from crate.db.auth import unlink_user_external_identity
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
    from crate.db.queries.user import update_user_location

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
        update_user_location(user["id"], fields, values)

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
