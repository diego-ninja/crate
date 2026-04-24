import logging
import shutil
import time
from pathlib import Path

from crate.db.audit import log_audit
from crate.db.cache_settings import get_setting
from crate.db.cache_store import delete_cache, get_cache, set_cache
from crate.db.events import emit_task_event
from crate.db.genres import set_album_genres
from crate.db.jobs.enrichment import (
    get_albums_without_mbid,
    get_album_names_for_artist,
    get_artists_with_mbid,
    persist_album_release_mbids as _db_persist_album_release_mbids,
    update_album_has_cover,
    update_album_mbid_and_propagate,
    update_album_path_after_reorganize,
    update_album_popularity,
    update_artist_content_hash,
)
from crate.db.repositories.library import get_library_albums, get_library_artist, get_library_artists, get_library_tracks
from crate.db.queries.tasks import get_task
from crate.storage_layout import looks_like_storage_id, resolve_artist_dir
from crate.task_progress import TaskProgress, emit_item_event, emit_progress, entity_label
from crate.worker_handlers import DEFAULT_AUDIO_EXTENSIONS, TaskHandler, is_cancelled

log = logging.getLogger(__name__)

ENRICHMENT_CACHE_PREFIXES = (
    "enrichment:",
    "lastfm:artist:",
    "fanart:artist:",
    "fanart:bg:",
    "fanart:all:",
    "nd:artist:",
    "spotify:artist:",
)


def _mark_processing(artist_name: str):
    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)


def _unmark_processing(artist_name: str):
    delete_cache(f"processing:{artist_name.lower()}")


from crate.content import compute_dir_hash as _compute_dir_hash


def _clean_album_lookup_name(album_name: str) -> str:
    import re

    return re.sub(r"^\d{4}\s*-\s*", "", album_name)


def _build_album_match_local_info(
    album: dict,
    artist_name: str,
    clean_album: str,
    tracks_db: list[dict],
    exts: set[str],
) -> dict:
    from crate.audio import get_audio_files
    from crate.matcher import _gather_local_info

    album_path = album.get("path", "")
    album_dir = Path(album_path) if album_path else None
    if album_dir and album_dir.is_dir():
        info = _gather_local_info(get_audio_files(album_dir, list(exts)))
        if not info.get("artist"):
            info["artist"] = artist_name
        if not info.get("album"):
            info["album"] = clean_album
        return info

    return {
        "artist": artist_name,
        "album": clean_album,
        "track_count": len(tracks_db) or album.get("track_count", 0),
        "tracks": [
            {
                "title": track.get("title", ""),
                "length_sec": int(track.get("duration", 0)),
                "tracknumber": str(track.get("track_number", "")),
                "filename": track.get("filename", ""),
            }
            for track in tracks_db
        ],
        "total_length": sum(int(track.get("duration", 0)) for track in tracks_db),
    }


def _find_best_album_release(
    artist_name: str,
    clean_album: str,
    track_count: int,
    local_info: dict,
    max_candidates: int,
) -> tuple[dict | None, int]:
    from crate.matcher import _get_release_detail, _score_match, _search_musicbrainz

    candidates = _search_musicbrainz(artist_name, clean_album, track_count)
    if not candidates:
        return None, 0

    best_release = None
    best_score = 0
    for candidate in candidates[:max_candidates]:
        release = _get_release_detail(candidate["mbid"])
        if not release:
            continue
        score = _score_match(local_info, release)
        if score > best_score:
            best_score = score
            best_release = release
        time.sleep(0.5)

    return best_release, best_score


def _auto_apply_album_release(
    task_id: str,
    album_dir: Path | None,
    artist_name: str,
    clean_album: str,
    exts: set[str],
    release: dict,
    score: int,
) -> bool:
    if not album_dir or not album_dir.is_dir():
        return False

    try:
        from crate.matcher import apply_match

        apply_result = apply_match(album_dir, exts, release)
        log.info(
            "Auto-applied MB tags for %s/%s (score=%d, updated=%d)",
            artist_name,
            clean_album,
            score,
            apply_result.get("updated", 0),
        )
        emit_task_event(
            task_id,
            "info",
            {"message": f"Auto-applied tags: {artist_name}/{clean_album} (score {score}%)"},
        )
        return True
    except Exception:
        log.warning("Auto-apply failed for %s/%s", artist_name, clean_album, exc_info=True)
        return False


def _persist_album_release_mbids(album_id: int, tracks_db: list[dict], release: dict) -> None:
    _db_persist_album_release_mbids(album_id, tracks_db, release)


def _write_album_release_tags(tracks_db: list[dict], release: dict) -> None:
    import mutagen

    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    mb_tracks = release.get("tracks", [])

    for index, db_track in enumerate(tracks_db):
        if index >= len(mb_tracks):
            break
        mb_track = mb_tracks[index]
        track_mbid = mb_track.get("mbid", "")
        track_path = db_track.get("path", "")
        if not track_path or not Path(track_path).is_file():
            continue
        try:
            audio = mutagen.File(track_path, easy=True)
            if audio is None:
                continue
            changed = False
            if release_mbid:
                audio["musicbrainz_albumid"] = release_mbid
                changed = True
            if track_mbid:
                audio["musicbrainz_trackid"] = track_mbid
                changed = True
            if release_group_id:
                audio["musicbrainz_releasegroupid"] = release_group_id
                changed = True
            if changed:
                audio.save()
        except Exception:
            log.warning("Failed to write MBID tags to %s", track_path)


def _sync_album_after_auto_apply(album_name: str, artist_name: str, album_dir: Path | None, config: dict) -> None:
    if not album_dir or not album_dir.is_dir():
        return
    try:
        from crate.library_sync import LibrarySync

        syncer = LibrarySync(config)
        syncer.sync_album(album_dir, artist_name)
    except Exception:
        log.warning("Re-sync after auto-apply failed for %s", album_name, exc_info=True)


def _handle_enrich_artists(task_id: str, params: dict, config: dict) -> dict:
    from crate.enrichment import enrich_artist

    all_artists, total = get_library_artists(per_page=10000)
    enriched = 0
    skipped = 0

    p = TaskProgress(phase="enriching", phase_count=1, total=total)

    for index, artist in enumerate(all_artists):
        if is_cancelled(task_id):
            break

        name = artist["name"]
        p.done = index + 1
        p.item = entity_label(artist=name)
        emit_progress(task_id, p)

        result = enrich_artist(name, config)
        if result.get("skipped"):
            skipped += 1
            emit_item_event(task_id, level="info", message=f"Skipped: {name}", artist=name)
        else:
            enriched += 1
            emit_item_event(task_id, level="info", message=f"Enriched: {name}", artist=name)

    return {"enriched": enriched, "skipped": skipped, "total": total}


def _handle_enrich_single(task_id: str, params: dict, config: dict) -> dict:
    """Enrich a single artist: all sources + photo + persist to DB."""
    from crate.enrichment import enrich_artist

    name = params.get("artist", "")
    if not name:
        return {"error": "No artist specified"}

    p = TaskProgress(phase="enriching", phase_count=1, total=1, item=entity_label(artist=name))
    emit_progress(task_id, p)
    result = enrich_artist(name, config, force=True)
    p.done = 1
    emit_progress(task_id, p, force=True)
    emit_item_event(task_id, level="info", message=f"Enriched: {name}", artist=name)
    return result


def _handle_reset_enrichment(task_id: str, params: dict, config: dict) -> dict:
    name = params.get("artist", "")
    lib = Path(config["library_path"])

    for prefix in ENRICHMENT_CACHE_PREFIXES:
        delete_cache(f"{prefix}{name.lower()}")

    artist = get_library_artist(name)
    folder = (artist.get("folder_name") if artist else None) or name
    artist_dir = lib / folder
    for photo in ("artist.jpg", "artist.png", "photo.jpg"):
        photo_path = artist_dir / photo
        if photo_path.exists():
            try:
                photo_path.unlink()
            except OSError:
                log.debug("Failed to delete photo %s", photo_path, exc_info=True)

    emit_task_event(task_id, "info", {"message": f"Reset enrichment for: {name}"})
    log_audit("reset_enrichment", "artist", name, task_id=task_id)

    result = _handle_enrich_single(task_id, {"artist": name}, config)
    return {"reset": name, "enrichment": result}


def _handle_enrich_mbids(task_id: str, params: dict, config: dict) -> dict:
    """Enrich albums and tracks with MusicBrainz IDs."""
    lib = Path(config["library_path"])
    exts = DEFAULT_AUDIO_EXTENSIONS
    artist_filter = params.get("artist")
    min_score = params.get("min_score", 70)

    if artist_filter:
        albums = get_library_albums(artist_filter)
    else:
        albums = get_albums_without_mbid()

    total = len(albums)
    enriched = 0
    skipped = 0
    failed = 0

    p = TaskProgress(phase="matching_mbids", phase_count=1, total=total)

    for index, album in enumerate(albums):
        if is_cancelled(task_id):
            break

        album_name = album.get("tag_album") or album.get("name", "")
        artist_name = album.get("artist", "")
        album_path = album.get("path", "")

        existing_mbid = album.get("musicbrainz_albumid")
        if existing_mbid and existing_mbid.strip():
            skipped += 1
            continue

        p.done = index
        p.item = entity_label(artist=artist_name, album=album_name)
        emit_progress(task_id, p)

        clean_album = _clean_album_lookup_name(album_name)
        tracks_db = get_library_tracks(album["id"]) if "id" in album else []
        track_count = len(tracks_db) or album.get("track_count", 0)

        album_dir = Path(album_path) if album_path else None
        local_info = _build_album_match_local_info(
            album,
            artist_name,
            clean_album,
            tracks_db,
            exts,
        )
        best_release, best_score = _find_best_album_release(
            artist_name,
            clean_album,
            track_count,
            local_info,
            max_candidates=3,
        )

        if not best_release or best_score < min_score:
            failed += 1
            time.sleep(0.5)
            continue

        auto_apply_threshold = int(get_setting("mb_auto_apply_threshold", "95"))
        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            _auto_apply_album_release(
                task_id,
                album_dir,
                artist_name,
                clean_album,
                exts,
                best_release,
                best_score,
            )

        _persist_album_release_mbids(album["id"], tracks_db, best_release)

        if best_score < auto_apply_threshold:
            _write_album_release_tags(tracks_db, best_release)

        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            _sync_album_after_auto_apply(album_name, artist_name, album_dir, config)

        enriched += 1
        emit_task_event(
            task_id,
            "album_matched",
            {
                "message": f"Matched: {artist_name} / {clean_album} (score {best_score}%)",
                "artist": artist_name,
                "album": clean_album,
                "mbid": best_release["mbid"],
                "score": best_score,
            },
        )
        log.info(
            "Enriched %s / %s (score=%d, mbid=%s)",
            artist_name,
            clean_album,
            best_score,
            best_release["mbid"],
        )
        time.sleep(1)

    return {"enriched": enriched, "skipped": skipped, "failed": failed, "total": total}


def _reorganize_artist_folders(
    artist_name: str, lib: Path, config: dict, task_id: str | None = None
):
    """Move album folders to Artist/Year/Album structure if not already organized."""
    import re as _re

    from crate.audio import get_audio_files, read_tags

    artist_row = get_library_artist(artist_name)
    artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=artist_name, existing_only=True)
    if artist_row and looks_like_storage_id(str(artist_row.get("folder_name") or "")):
        log.info("Skip folder reorganization for managed-storage artist %s", artist_name)
        return
    if not artist_dir or not artist_dir.is_dir():
        return
    if any(looks_like_storage_id(part.name) for part in artist_dir.iterdir() if part.is_dir()):
        log.info("Skip folder reorganization for %s because managed-storage album dirs were detected", artist_name)
        return

    year_prefix_re = _re.compile(r"^(\d{4})\s*[-–]\s*(.+)$")
    exts = DEFAULT_AUDIO_EXTENSIONS
    moved = 0

    for subdir in list(artist_dir.iterdir()):
        if not subdir.is_dir() or subdir.name.startswith("."):
            continue
        if subdir.name.isdigit() and len(subdir.name) == 4:
            continue

        match = year_prefix_re.match(subdir.name)
        if match:
            year = match.group(1)
            clean_name = match.group(2).strip()
        else:
            audio_files = get_audio_files(subdir, list(exts))
            if not audio_files:
                continue
            tags = read_tags(audio_files[0])
            year_tag = tags.get("date", "")[:4]
            if not year_tag or not year_tag.isdigit():
                continue
            year = year_tag
            clean_name = subdir.name

        target = artist_dir / year / clean_name
        if target == subdir:
            continue
        if target.exists():
            log.warning("Cannot reorganize %s: target %s already exists", subdir, target)
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(subdir), str(target))
            old_path = str(subdir)
            new_path = str(target)
            update_album_path_after_reorganize(old_path, new_path, clean_name)
            moved += 1
            log.info("Reorganized: %s -> %s", subdir.name, f"{year}/{clean_name}")
            emit_task_event(task_id, "info", {"message": f"Moved {subdir.name} -> {year}/{clean_name}"})
        except Exception:
            log.warning("Failed to reorganize %s", subdir, exc_info=True)

    if moved:
        log.info("Reorganized %d album folders for %s", moved, artist_name)


def _process_new_content_organize_folders(
    task_id: str,
    result: dict,
    artist_name: str,
    lib: Path,
    config: dict,
    p: TaskProgress,
) -> None:
    p.phase = "organize_folders"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        _reorganize_artist_folders(artist_name, lib, config, task_id)
        result["steps"]["organize_folders"] = True
    except Exception:
        log.warning("Folder reorganization failed for %s", artist_name, exc_info=True)
        result["steps"]["organize_folders"] = "failed"


def _process_new_content_enrich_artist(
    task_id: str,
    result: dict,
    artist_name: str,
    config: dict,
    p: TaskProgress,
) -> None:
    from crate.enrichment import enrich_artist

    p.phase = "enrich_artist"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        enrich_result = enrich_artist(artist_name, config)
        result["steps"]["enrich_artist"] = enrich_result.get("skipped", False)
        emit_task_event(
            task_id,
            "step_done",
            {"message": f"Enriched: {artist_name}", "step": "enrich_artist", "result": enrich_result},
        )
    except Exception:
        log.warning("Enrich artist failed for %s", artist_name, exc_info=True)
        result["steps"]["enrich_artist"] = "failed"


def _process_new_content_album_genres(
    task_id: str,
    result: dict,
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> list[dict]:
    from crate.db.queries.browse_artist import get_artist_genre_profile
    from crate.genre_indexer import derive_album_genres

    albums = []
    p.phase = "album_genres"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        albums = get_library_albums(artist_name)
        artist_profile = get_artist_genre_profile(artist_name, limit=8)
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = get_library_tracks(album["id"])
            genres = derive_album_genres(
                album.get("genre"),
                [track.get("genre") for track in tracks if track.get("genre")],
                artist_profile=artist_profile,
            )
            if genres:
                set_album_genres(album["id"], genres)
        result["steps"]["album_genres"] = True
    except Exception:
        log.warning("Album genre indexing failed", exc_info=True)
        result["steps"]["album_genres"] = "failed"
    return albums


def _process_new_content_album_mbids(
    task_id: str,
    result: dict,
    albums: list[dict],
    artist_name: str,
    album_folder: str,
    config: dict,
    p: TaskProgress,
) -> None:
    p.phase = "album_mbid"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        exts = DEFAULT_AUDIO_EXTENSIONS
        mbid_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            existing_mbid = album.get("musicbrainz_albumid")
            if existing_mbid and existing_mbid.strip():
                continue

            clean_name = _clean_album_lookup_name(album.get("tag_album") or album["name"])
            tracks_db = get_library_tracks(album["id"])
            track_count = album.get("track_count", 0)
            local_info = _build_album_match_local_info(
                album,
                artist_name,
                clean_name,
                tracks_db,
                exts,
            )
            best_release, best_score = _find_best_album_release(
                artist_name,
                clean_name,
                track_count,
                local_info,
                max_candidates=5,
            )

            if best_release and best_score >= 70:
                mbid = best_release["mbid"]
                update_album_mbid_and_propagate(album["id"], mbid)
                mbid_count += 1
            time.sleep(1)

        result["steps"]["album_mbid"] = mbid_count
    except Exception:
        log.warning("Album MBID lookup failed", exc_info=True)
        result["steps"]["album_mbid"] = "failed"


def _process_new_content_popularity(
    task_id: str,
    result: dict,
    albums: list[dict],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    from crate.popularity import (
        _lastfm_get,
        _normalize_popularity,
        _parse_int,
        refresh_artist_track_popularity_signals,
    )

    p.phase = "popularity"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        pop_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_name = _clean_album_lookup_name(album.get("tag_album") or album["name"])
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    update_album_popularity(album["id"], listeners, playcount)
                    pop_count += 1
            time.sleep(0.25)

        refresh_result = refresh_artist_track_popularity_signals(artist_name)
        track_pop = int(refresh_result.get("lastfm_matches", 0))
        spotify_track_pop = int(refresh_result.get("spotify_matches", 0))

        _normalize_popularity([artist_name])
        result["steps"]["popularity"] = {
            "albums": pop_count,
            "lastfm_track_matches": track_pop,
            "spotify_track_matches": spotify_track_pop,
        }
    except Exception:
        log.warning("Popularity failed", exc_info=True)
        result["steps"]["popularity"] = "failed"


def _process_new_content_missing_covers(
    task_id: str,
    result: dict,
    albums: list[dict],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    import requests as _requests

    from crate.artwork import fetch_cover_from_caa, save_cover

    p.phase = "covers"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        covers_fetched = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_dir = Path(album["path"]) if album.get("path") else None
            if not album_dir or not album_dir.is_dir():
                continue
            if any((album_dir / candidate).exists() for candidate in ("cover.jpg", "cover.png", "folder.jpg")):
                continue

            cover_data = None
            mbid = album.get("musicbrainz_albumid")
            if mbid and mbid.strip():
                cover_data = fetch_cover_from_caa(mbid)

            if not cover_data:
                try:
                    album_name = _clean_album_lookup_name(album.get("tag_album") or album["name"])
                    resp = _requests.get(
                        "https://api.deezer.com/search/album",
                        params={"q": f"{artist_name} {album_name}", "limit": 1},
                        timeout=10,
                    )
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        if data and data[0].get("cover_xl"):
                            img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                except Exception:
                    log.debug("Failed to fetch Deezer cover for %s / %s", artist_name, album_name, exc_info=True)

            if cover_data:
                save_cover(album_dir, cover_data)
                covers_fetched += 1
                update_album_has_cover(album["id"])

            time.sleep(0.3)
        result["steps"]["covers"] = covers_fetched
    except Exception:
        log.warning("Cover fetching failed", exc_info=True)
        result["steps"]["covers"] = "failed"


def _process_new_content_update_artist_hash(artist_dir: Path, artist_name: str) -> None:
    if not artist_dir.is_dir():
        return

    final_hash = _compute_dir_hash(artist_dir)
    update_artist_content_hash(artist_name, final_hash)


def _handle_process_new_content(task_id: str, params: dict, config: dict) -> dict:
    """Full pipeline for new content: enrich artist + index genres + analyze audio + bliss."""
    artist_name = params.get("artist", "")
    album_folder = params.get("album", "")

    _mark_processing(artist_name)
    try:
        return _process_new_content_inner(task_id, params, config, artist_name, album_folder)
    finally:
        _unmark_processing(artist_name)


def _process_new_content_inner(
    task_id: str, params: dict, config: dict, artist_name: str, album_folder: str
) -> dict:
    lib = Path(config["library_path"])
    result = {"artist": artist_name, "album": album_folder, "steps": {}}

    artist_row = get_library_artist(artist_name)
    folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
    force = params.get("force", False)
    artist_dir = lib / folder
    if artist_dir.is_dir() and not force:
        new_hash = _compute_dir_hash(artist_dir)
        old_hash = artist_row.get("content_hash") if artist_row else None
        if old_hash and new_hash == old_hash:
            log.info("Skipping %s - content unchanged (hash: %s)", artist_name, new_hash[:12])
            return {"artist": artist_name, "skipped": True, "reason": "content_unchanged"}

    # Ensure artist content is synced (may be missing after migration or fresh download)
    if artist_dir.is_dir():
        try:
            from crate.library_sync import LibrarySync
            sync = LibrarySync(config)
            sync.sync_artist(artist_dir)
        except Exception:
            log.warning("Pre-enrichment sync failed for %s", artist_name, exc_info=True)

    p = TaskProgress(phase="starting", phase_count=6, total=1, item=entity_label(artist=artist_name))
    emit_progress(task_id, p, force=True)

    _process_new_content_organize_folders(task_id, result, artist_name, lib, config, p)
    _process_new_content_enrich_artist(task_id, result, artist_name, config, p)
    albums = _process_new_content_album_genres(task_id, result, artist_name, album_folder, p)
    _process_new_content_album_mbids(task_id, result, albums, artist_name, album_folder, config, p)

    # Audio analysis and bliss are handled by background daemons (analysis_daemon.py).
    # New tracks enter library_tracks with analysis_state='pending' and bliss_state='pending'
    # and are picked up automatically. No need to enqueue anything here.
    result["steps"]["audio_analysis"] = "background_daemon"
    result["steps"]["bliss"] = "background_daemon"

    _process_new_content_popularity(task_id, result, albums, artist_name, album_folder, p)
    _process_new_content_missing_covers(task_id, result, albums, artist_name, album_folder, p)
    _process_new_content_update_artist_hash(artist_dir, artist_name)

    # Notify connected clients to refresh cached library data.
    # Worker runs in a separate process — POST to the API to broadcast.
    try:
        import requests as _req
        _artist_row = get_library_artist(artist_name)
        _scopes = ["library"]
        if _artist_row and _artist_row.get("id"):
            _scopes.append(f"artist:{_artist_row['id']}")
        _req.post("http://crate-api:8585/api/cache/invalidate", json={"scopes": _scopes}, timeout=3)
    except Exception:
        pass  # Cache invalidation is best-effort

    return result


def _handle_compute_completeness(task_id: str, params: dict, config: dict) -> dict:
    """Compute library completeness vs MusicBrainz for all artists with MBIDs."""
    import re
    import musicbrainzngs

    musicbrainzngs.set_useragent("crate", "1.0", "https://github.com/crate")
    year_re = re.compile(r"^\d{4}\s*[-–]\s*")

    artists = get_artists_with_mbid()

    total = len(artists)
    p = TaskProgress(phase="completeness", phase_count=1, total=total)
    results = []
    for index, artist in enumerate(artists):
        if is_cancelled(task_id):
            break
        p.done = index
        p.item = entity_label(artist=artist["name"])
        emit_progress(task_id, p)

        try:
            mb_data = get_cache(f"mb:albums:{artist['mbid']}", max_age_seconds=86400 * 7)
            if not mb_data:
                try:
                    mb_artist = musicbrainzngs.get_artist_by_id(artist["mbid"])["artist"]
                    mb_name = mb_artist.get("name", "")
                    from thefuzz import fuzz
                    if fuzz.ratio(artist["name"].lower(), mb_name.lower()) < 70:
                        log.debug("MBID mismatch: %s -> %s, skipping", artist["mbid"], mb_name)
                        continue
                except Exception:
                    pass

                result = musicbrainzngs.browse_release_groups(
                    artist=artist["mbid"], release_type=["album"], limit=100
                )
                mb_albums = result.get("release-group-list", [])
                mb_data = {
                    "count": result.get("release-group-count", len(mb_albums)),
                    "albums": [
                        {
                            "title": rg.get("title", ""),
                            "type": rg.get("primary-type", ""),
                            "year": rg.get("first-release-date", "")[:4] if rg.get("first-release-date") else "",
                        }
                        for rg in mb_albums
                    ],
                }
                set_cache(f"mb:albums:{artist['mbid']}", mb_data, ttl=604800)
                time.sleep(1)  # rate limit

            mb_count = mb_data["count"]
            local_count = artist["album_count"] or 0
            pct = round(local_count / mb_count * 100) if mb_count > 0 else 100

            local_names = get_album_names_for_artist(artist["name"])
            local_clean = {year_re.sub("", name).lower() for name in local_names}

            missing = [
                album for album in mb_data["albums"]
                if album["title"].lower() not in local_names and album["title"].lower() not in local_clean
            ]

            results.append({
                "artist_id": artist["id"],
                "artist_slug": artist["slug"],
                "artist": artist["name"],
                "has_photo": bool(artist["has_photo"]),
                "listeners": artist.get("listeners", 0),
                "local_count": local_count,
                "mb_count": mb_count,
                "pct": min(pct, 100),
                "missing": missing[:10],
            })
        except Exception:
            log.debug("Completeness check failed for %s", artist["name"], exc_info=True)

    results.sort(key=lambda item: item["pct"])
    set_cache("discover:completeness", results, ttl=86400)
    emit_task_event(task_id, "info", {"message": f"Completeness computed: {len(results)}/{total} artists checked"})
    return {"artists_checked": len(results), "total": total}


ENRICHMENT_TASK_HANDLERS: dict[str, TaskHandler] = {
    "enrich_artist": _handle_enrich_single,
    "enrich_artists": _handle_enrich_artists,
    "reset_enrichment": _handle_reset_enrichment,
    "enrich_mbids": _handle_enrich_mbids,
    "process_new_content": _handle_process_new_content,
    "compute_completeness": _handle_compute_completeness,
}
