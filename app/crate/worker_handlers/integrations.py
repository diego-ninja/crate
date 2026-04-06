import json
import logging
from datetime import datetime, timezone
from crate.db import emit_task_event, get_db_ctx, get_task, update_task
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _handle_sync_user_navidrome(task_id: str, params: dict, config: dict) -> dict:
    from datetime import datetime, timezone

    from crate import navidrome
    from crate.db import get_user_by_id, upsert_user_external_identity

    user_id = params.get("user_id")
    username = (params.get("username") or "").strip()
    if not user_id or not username:
        return {"error": "Missing user_id or username"}

    user = get_user_by_id(int(user_id))
    if not user:
        return {"error": "User not found"}

    upsert_user_external_identity(
        user["id"],
        "navidrome",
        external_username=username,
        status="pending",
        last_task_id=task_id,
        last_error=None,
    )

    if not navidrome.ping():
        upsert_user_external_identity(
            user["id"],
            "navidrome",
            external_username=username,
            status="errored",
            last_task_id=task_id,
            last_error="Navidrome unavailable",
        )
        raise RuntimeError("Navidrome unavailable")

    try:
        navidrome.ensure_external_user(username)
        nd_user = navidrome.get_user(username)
    except Exception as exc:
        upsert_user_external_identity(
            user["id"],
            "navidrome",
            external_username=username,
            status="errored",
            last_task_id=task_id,
            last_error=str(exc)[:500],
        )
        raise

    identity = upsert_user_external_identity(
        user["id"],
        "navidrome",
        external_username=username,
        external_user_id=str(nd_user.get("id") or ""),
        status="synced",
        last_task_id=task_id,
        last_error=None,
        last_synced_at=datetime.now(timezone.utc).isoformat(),
        metadata={"source": "worker_sync"},
    )
    emit_task_event(
        task_id,
        "info",
        {"message": f"Navidrome user synced for {user['email']} as {username}"},
    )
    return {
        "user_id": user["id"],
        "username": username,
        "external_user_id": identity.get("external_user_id"),
    }


def _handle_sync_playlist_navidrome(task_id: str, params: dict, config: dict) -> dict:
    """Sync a Grooveyard playlist to Navidrome."""
    from thefuzz import fuzz

    from crate.db import get_playlist, get_playlist_tracks
    from crate.navidrome import create_playlist_as_user as nd_create_playlist
    from crate.navidrome import ping_as_user, search

    playlist_id = params.get("playlist_id")
    navidrome_username = params.get("navidrome_username")
    if not playlist_id:
        return {"error": "No playlist_id"}
    if not navidrome_username:
        return {"error": "No navidrome_username"}

    playlist = get_playlist(playlist_id)
    if not playlist:
        return {"error": "Playlist not found"}

    tracks = get_playlist_tracks(playlist_id)
    if not tracks:
        return {"error": "Empty playlist"}

    matched_ids = []
    unmatched = []

    for index, track in enumerate(tracks):
        artist = track.get("artist", "")
        title = track.get("title", "")
        if not artist or not title:
            unmatched.append(title or track.get("track_path", ""))
            continue

        if index % 5 == 0:
            update_task(task_id, progress=json.dumps({"phase": "matching", "done": index, "total": len(tracks)}))

        try:
            results = search(f"{artist} {title}", artist_count=0, album_count=0, song_count=10)
            songs = results.get("song", [])

            best_match = None
            best_score = 0
            for song in songs:
                artist_score = fuzz.ratio(artist.lower(), song.get("artist", "").lower())
                title_score = fuzz.ratio(title.lower(), song.get("title", "").lower())
                score = (artist_score + title_score) // 2
                if score > best_score:
                    best_score = score
                    best_match = song

            if best_match and best_score >= 70:
                matched_ids.append(best_match["id"])
            else:
                unmatched.append(f"{artist} - {title}")
        except Exception:
            unmatched.append(f"{artist} - {title}")

    if not matched_ids:
        return {"error": "No tracks matched in Navidrome", "unmatched": unmatched}

    try:
        if not ping_as_user(navidrome_username):
            raise RuntimeError(f"Navidrome user not available: {navidrome_username}")
        navidrome_id = nd_create_playlist(playlist["name"], matched_ids, navidrome_username)
    except Exception as exc:
        return {"error": f"Failed to create Navidrome playlist: {exc}"}

    emit_task_event(
        task_id,
        "info",
        {"message": f"Synced to Navidrome as {navidrome_username}: {len(matched_ids)} tracks matched"},
    )
    return {
        "navidrome_id": navidrome_id,
        "navidrome_username": navidrome_username,
        "matched": len(matched_ids),
        "unmatched": unmatched,
        "total": len(tracks),
    }


def _handle_sync_system_playlist_navidrome(task_id: str, params: dict, config: dict) -> dict:
    from thefuzz import fuzz

    from crate import navidrome
    from crate.db import get_playlist, get_playlist_tracks, set_playlist_navidrome_projection

    playlist_id = params.get("playlist_id")
    if not playlist_id:
        return {"error": "No playlist_id"}

    playlist = get_playlist(int(playlist_id))
    if not playlist:
        return {"error": "Playlist not found"}
    if playlist.get("scope") != "system":
        return {"error": "Not a system playlist"}

    set_playlist_navidrome_projection(
        int(playlist_id),
        status="syncing",
        error="",
        navidrome_public=True,
    )

    if not navidrome.ping():
        set_playlist_navidrome_projection(
            int(playlist_id),
            status="errored",
            error="Navidrome unavailable",
        )
        raise RuntimeError("Navidrome unavailable")

    tracks = get_playlist_tracks(int(playlist_id))
    if not tracks:
        set_playlist_navidrome_projection(
            int(playlist_id),
            status="errored",
            error="Playlist has no tracks",
        )
        raise RuntimeError("Playlist has no tracks")

    matched_ids: list[str] = []
    unmatched: list[str] = []

    for index, track in enumerate(tracks):
        if index % 10 == 0:
            update_task(
                task_id,
                progress=json.dumps({"phase": "matching", "done": index, "total": len(tracks)}),
            )

        existing_navidrome_id = (track.get("navidrome_id") or "").strip()
        if existing_navidrome_id:
            matched_ids.append(existing_navidrome_id)
            continue

        artist = (track.get("artist") or "").strip()
        title = (track.get("title") or "").strip()
        if not artist or not title:
            unmatched.append(title or track.get("track_path", ""))
            continue

        try:
            results = navidrome.search(
                f"{artist} {title}",
                artist_count=0,
                album_count=0,
                song_count=10,
            )
            songs = results.get("song", [])
            if isinstance(songs, dict):
                songs = [songs]

            best_match = None
            best_score = 0
            for song in songs:
                artist_score = fuzz.ratio(artist.lower(), song.get("artist", "").lower())
                title_score = fuzz.ratio(title.lower(), song.get("title", "").lower())
                score = (artist_score + title_score) // 2
                if score > best_score:
                    best_score = score
                    best_match = song

            if best_match and best_score >= 70:
                matched_ids.append(best_match["id"])
            else:
                unmatched.append(f"{artist} - {title}")
        except Exception:
            unmatched.append(f"{artist} - {title}")

    if not matched_ids:
        set_playlist_navidrome_projection(
            int(playlist_id),
            status="errored",
            error="No tracks matched in Navidrome",
        )
        raise RuntimeError("No tracks matched in Navidrome")

    try:
        navidrome_id = navidrome.create_or_update_public_playlist(
            playlist["name"],
            matched_ids,
            existing_playlist_id=playlist.get("navidrome_playlist_id"),
        )
    except Exception as exc:
        set_playlist_navidrome_projection(
            int(playlist_id),
            status="errored",
            error=str(exc)[:500],
        )
        raise

    set_playlist_navidrome_projection(
        int(playlist_id),
        navidrome_playlist_id=navidrome_id,
        navidrome_public=True,
        status="projected",
        error="",
        projected_at=datetime.now(timezone.utc).isoformat(),
    )
    emit_task_event(
        task_id,
        "info",
        {"message": f"Projected public playlist to Navidrome: {playlist['name']}"},
    )
    return {
        "playlist_id": int(playlist_id),
        "navidrome_id": navidrome_id,
        "matched": len(matched_ids),
        "unmatched": unmatched,
        "total": len(tracks),
    }


def _handle_map_navidrome_ids(task_id: str, params: dict, config: dict) -> dict:
    from crate.navidrome import map_library_ids

    result = map_library_ids()
    emit_task_event(
        task_id,
        "info",
        {"message": f"Mapped {result['artists']} artists, {result['albums']} albums, {result['tracks']} tracks"},
    )
    return result


def _handle_sync_shows(task_id: str, params: dict, config: dict) -> dict:
    """Sync shows from Ticketmaster to DB for all library artists."""
    from crate.db import delete_past_shows, get_library_artists, upsert_show
    from crate.ticketmaster import get_upcoming_shows as tm_get_shows
    from crate.ticketmaster import is_configured

    if not is_configured():
        return {"error": "Ticketmaster not configured"}

    artists, _ = get_library_artists(per_page=10000)
    total = len(artists)
    synced = 0
    shows_found = 0

    for index, artist in enumerate(artists):
        if is_cancelled(task_id):
            break
        name = artist["name"]
        if index % 10 == 0:
            update_task(
                task_id,
                progress=json.dumps({"phase": "fetching", "artist": name, "done": index, "total": total}),
            )

        try:
            events = tm_get_shows(name, limit=20)
            for event in events:
                external_id = event.get("id")
                if not external_id:
                    continue
                upsert_show(
                    external_id=external_id,
                    artist_name=name,
                    date=event.get("local_date") or event.get("date", "")[:10],
                    local_time=event.get("local_time"),
                    venue=event.get("venue"),
                    address_line1=event.get("address_line1"),
                    city=event.get("city"),
                    region=event.get("region"),
                    postal_code=event.get("postal_code"),
                    country=event.get("country"),
                    country_code=event.get("country_code"),
                    latitude=float(event["latitude"]) if event.get("latitude") else None,
                    longitude=float(event["longitude"]) if event.get("longitude") else None,
                    url=event.get("url"),
                    image_url=event.get("image"),
                    lineup=event.get("lineup"),
                    price_range=str(event["price_range"]) if event.get("price_range") else None,
                    status=event.get("status", "onsale"),
                )
                shows_found += 1
            synced += 1
        except Exception:
            log.debug("Failed to sync shows for %s", name, exc_info=True)

    deleted = delete_past_shows(days_old=30)
    return {"artists_checked": synced, "shows_found": shows_found, "old_deleted": deleted}


def _handle_backfill_similarities(task_id: str, params: dict, config: dict) -> dict:
    """Populate artist_similarities from existing similar_json on library_artists."""
    from crate.db import bulk_upsert_similarities, mark_library_status

    with get_db_ctx() as cur:
        cur.execute("SELECT name, similar_json FROM library_artists WHERE similar_json IS NOT NULL")
        rows = cur.fetchall()

    total = len(rows)
    upserted = 0
    for index, row in enumerate(rows):
        if is_cancelled(task_id):
            break
        similar_json = row["similar_json"]
        if not similar_json:
            continue
        try:
            similar = similar_json if isinstance(similar_json, list) else json.loads(similar_json)
        except Exception:
            continue
        if not isinstance(similar, list) or not similar:
            continue
        try:
            bulk_upsert_similarities(row["name"], similar)
            upserted += len(similar)
        except Exception:
            log.warning("backfill_similarities: failed for %s", row["name"], exc_info=True)
        if index % 50 == 0:
            update_task(task_id, progress=json.dumps({"phase": "backfill", "done": index + 1, "total": total}))

    try:
        updated = mark_library_status()
        log.info("backfill_similarities: marked %d rows in_library", updated)
    except Exception:
        log.warning("backfill_similarities: mark_library_status failed", exc_info=True)

    return {"artists_processed": total, "rows_upserted": upserted}


INTEGRATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_user_navidrome": _handle_sync_user_navidrome,
    "sync_playlist_navidrome": _handle_sync_playlist_navidrome,
    "sync_system_playlist_navidrome": _handle_sync_system_playlist_navidrome,
    "map_navidrome_ids": _handle_map_navidrome_ids,
    "sync_shows": _handle_sync_shows,
    "backfill_similarities": _handle_backfill_similarities,
}
