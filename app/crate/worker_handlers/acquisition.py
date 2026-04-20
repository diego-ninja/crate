import logging
import re
import shutil
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from crate.audio import get_audio_files, read_tags
from crate.db import create_task, create_task_dedup, emit_task_event, get_setting, get_task
from crate.task_progress import TaskProgress, emit_progress, emit_item_event, entity_label
from crate.db.jobs.acquisition import update_artist_latest_release_date
from crate.db.user_library import follow_artist, like_track, save_album
from crate.storage_import import resolve_import_album_target
from crate.storage_layout import resolve_artist_dir
from crate.worker_handlers import TaskHandler, is_cancelled, start_scan

log = logging.getLogger(__name__)


def _sanitize_import_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "Unknown"


def _normalize_artist_folder_key(name: str) -> str:
    return re.sub(r"^[.\s]+", "", (name or "").strip()).casefold()


def _safe_artist_folder_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[.\s]+", "", cleaned)
    cleaned = cleaned.rstrip(" .")
    return cleaned or "Unknown Artist"


def _resolve_library_artist_folder_name(lib: Path, preferred_artist: str = "", staged_artist: str = "") -> str:
    from crate.db import get_library_artist

    candidates = [
        preferred_artist,
        staged_artist,
        _safe_artist_folder_name(preferred_artist),
        _safe_artist_folder_name(staged_artist),
    ]
    seen: set[str] = set()
    filtered_candidates: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        key = candidate.casefold()
        if key in seen:
            continue
        seen.add(key)
        filtered_candidates.append(candidate)

    existing_dirs = [d.name for d in lib.iterdir() if d.is_dir()]
    existing_by_exact: dict[str, str] = {}
    existing_by_normalized: dict[str, str] = {}
    for name in existing_dirs:
        exact_key = name.casefold()
        normalized_key = _normalize_artist_folder_key(name)
        current_exact = existing_by_exact.get(exact_key)
        current_normalized = existing_by_normalized.get(normalized_key)
        if current_exact is None or (current_exact.startswith(".") and not name.startswith(".")):
            existing_by_exact[exact_key] = name
        if current_normalized is None or (current_normalized.startswith(".") and not name.startswith(".")):
            existing_by_normalized[normalized_key] = name

    for candidate in filtered_candidates:
        exact = existing_by_exact.get(candidate.casefold())
        if exact:
            return exact
    for candidate in filtered_candidates:
        normalized = existing_by_normalized.get(_normalize_artist_folder_key(candidate))
        if normalized:
            return normalized

    for candidate in filtered_candidates:
        existing = get_library_artist(candidate)
        if existing and existing.get("folder_name"):
            return existing["folder_name"]

    return _safe_artist_folder_name(preferred_artist or staged_artist)


def _resolve_tidal_preferred_artist_name(url: str, params: dict, download_id: int | None) -> str:
    from crate.db.tidal import get_tidal_download

    if params.get("artist"):
        return params["artist"]

    row = get_tidal_download(download_id) if download_id else None
    content_type = (params.get("content_type") or (row or {}).get("content_type") or "").lower()

    if row and row.get("artist"):
        return row["artist"]
    if content_type == "artist":
        if row and row.get("title"):
            return row["title"]
        if params.get("album"):
            return params["album"]
    if "/artist/" in url and row and row.get("title"):
        return row["title"]
    return ""


def _align_tidal_staged_artist_dirs(processing_path: str, lib: Path, preferred_artist: str) -> list[str]:
    processing_root = Path(processing_path)
    if not processing_root.is_dir():
        return []

    artist_dirs = [p for p in processing_root.iterdir() if p.is_dir()]
    if not artist_dirs:
        return []

    if preferred_artist and len(artist_dirs) == 1:
        current_dir = artist_dirs[0]
        target_name = _resolve_library_artist_folder_name(lib, preferred_artist, current_dir.name)
        if current_dir.name != target_name:
            target_dir = processing_root / target_name
            if not target_dir.exists():
                current_dir.rename(target_dir)
                artist_dirs = [target_dir]
            else:
                for child in list(current_dir.iterdir()):
                    shutil.move(str(child), str(target_dir / child.name))
                try:
                    current_dir.rmdir()
                except OSError:
                    pass
                artist_dirs = [target_dir]

    return [p.name for p in artist_dirs]


def _find_album_dirs_recursive(root: Path, extensions: set[str]) -> list[Path]:
    album_dirs: list[Path] = []
    seen: set[str] = set()
    for directory in sorted([root, *root.rglob("*")]):
        if not directory.is_dir():
            continue
        tracks = get_audio_files(directory, list(extensions))
        if not tracks:
            continue
        key = str(directory.resolve())
        if key not in seen:
            seen.add(key)
            album_dirs.append(directory)
    return album_dirs


def _safe_extract_zip(zip_path: Path, dest_dir: Path):
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            member_path = (dest_dir / member.filename).resolve()
            if not str(member_path).startswith(str(dest_dir.resolve())):
                raise ValueError(f"Unsafe zip entry: {member.filename}")
        archive.extractall(dest_dir)


def _group_loose_audio_files(raw_dir: Path, grouped_dir: Path, extensions: set[str]) -> int:
    moved = 0
    grouped_dir.mkdir(parents=True, exist_ok=True)
    for file_path in sorted(raw_dir.iterdir()):
        if not file_path.is_file() or file_path.suffix.lower() not in extensions:
            continue
        tags = read_tags(file_path)
        artist = _sanitize_import_name(tags.get("albumartist") or tags.get("artist") or "Unknown Artist")
        album = _sanitize_import_name(tags.get("album") or "Singles")
        target_dir = grouped_dir / artist / album
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(file_path), str(target_dir / file_path.name))
        moved += 1
    return moved


def _seed_uploaded_library(user_id: int | None, imported_albums: list[dict]):
    from crate.db import get_library_album, get_library_tracks

    if not user_id:
        return

    seen_artists: set[str] = set()
    seen_album_ids: set[int] = set()
    seen_track_ids: set[int] = set()

    for item in imported_albums:
        artist = item.get("artist") or ""
        album = item.get("album") or ""
        if artist and artist not in seen_artists:
            follow_artist(user_id, artist)
            seen_artists.add(artist)

        if not artist or not album:
            continue

        album_row = get_library_album(artist, album)
        if not album_row:
            continue

        album_id = album_row["id"]
        if album_id not in seen_album_ids:
            save_album(user_id, album_id)
            seen_album_ids.add(album_id)

        for track in get_library_tracks(album_id):
            track_id = track.get("id")
            if track_id and track_id not in seen_track_ids:
                like_track(user_id, track_id=track_id)
                seen_track_ids.add(track_id)


def _tidal_download_inner(task_id, params, config, url, quality, download_id, lib):
    from crate.db import delete_cache, mark_release_downloaded, set_cache, update_tidal_download
    from crate.library_sync import LibrarySync
    from crate.tidal import download, move_to_library

    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    desc = f"{artist_name} - {album_name}" if artist_name else url
    emit_task_event(task_id, "info", {"message": f"Downloading from Tidal: {desc}"})

    p = TaskProgress(phase="downloading", phase_count=3, item=entity_label(artist=artist_name, album=album_name))
    emit_progress(task_id, p, force=True)

    def _dl_progress(data):
        p.done = data.get("done", p.done)
        p.total = data.get("total", p.total)
        p.item = data.get("track", p.item)
        emit_progress(task_id, p)

    result = download(
        url,
        quality=quality,
        task_id=task_id,
        progress_callback=_dl_progress,
    )

    if not result.get("success"):
        if download_id:
            update_tidal_download(download_id, status="failed", error=result.get("error", "Download failed"))
        return {"error": result.get("error", "Download failed"), "phase": "download"}

    if download_id:
        update_tidal_download(download_id, status="processing")
    if result.get("warning"):
        emit_task_event(task_id, "info", {"message": f"Tidal reported partial issues but files were produced: {result['warning']}"})

    # Clean up tiddl intermediate M4A files before moving to the library.
    # tiddl fetches raw DASH streams as .m4a, converts to .flac, but
    # sometimes leaves the intermediates behind.  If we move them into
    # the library, sync indexes them as ghost tracks with no metadata.
    from crate.m4a_fix import cleanup_tidal_intermediates

    def _cleanup_progress(data):
        p.phase = "cleanup"
        p.done = data.get("done", p.done)
        p.total = data.get("total", p.total)
        emit_progress(task_id, p)

    cleanup = cleanup_tidal_intermediates(
        Path(result["path"]),
        progress_callback=_cleanup_progress,
    )
    if cleanup.get("deleted"):
        mb = cleanup["bytes_freed"] / (1024 * 1024)
        emit_task_event(task_id, "info", {
            "message": f"Cleaned up {cleanup['deleted']} tiddl intermediate M4A files ({mb:.0f} MB)",
        })

    preferred_artist_name = _resolve_tidal_preferred_artist_name(url, params, download_id)
    staged_artists = _align_tidal_staged_artist_dirs(result["path"], lib, preferred_artist_name)

    emit_task_event(
        task_id,
        "info",
        {"message": f"Moving {result.get('file_count', 0)} files to library"},
    )
    p.phase = "moving"
    p.phase_index = 1
    p.done = 0
    p.total = result.get("file_count", 0)
    emit_progress(task_id, p, force=True)

    # Suppress the library_watcher for the artists we're about to write to
    # /music. Otherwise the watcher sees the new files, enqueues its own
    # process_new_content which runs _reorganize_artist_folders in a parallel
    # worker, moving Album/ -> YYYY/Album/ and yanking the filesystem out
    # from under the sync_artist iterator below — FileNotFoundError, task
    # fails, Dramatiq retries the whole 5 GB download.
    #
    # The processing key is cross-process via Redis/PG cache. We inspect
    # the processing directory directly to enumerate the target artist
    # names (tiddl writes to /tmp/.../<task_id>/<ArtistName>/) because the
    # params.artist field is empty for artist-wide URL downloads.
    processing_root = Path(result["path"])
    if not staged_artists and processing_root.is_dir():
        staged_artists = [p.name for p in processing_root.iterdir() if p.is_dir()]
    for staged in staged_artists:
        set_cache(f"processing:{staged.lower()}", True, ttl=3600)

    try:
        modified_artists = move_to_library(result["path"], str(lib))
        # move_to_library may have canonicalized names slightly differently;
        # make sure every emitted artist has a processing mark too.
        for current_artist in modified_artists:
            set_cache(f"processing:{current_artist.lower()}", True, ttl=3600)
    except Exception:
        for staged in staged_artists:
            delete_cache(f"processing:{staged.lower()}")
        raise

    if not modified_artists:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No files moved")
        return {"error": "No files were moved", "phase": "move"}

    # All post-move work runs under the processing flag so the watcher's
    # debounce loop treats any filesystem activity as ours and stays out.
    try:
        from crate.db import get_library_artist as _get_artist

        # Download Tidal cover for specific album if provided
        cover_url = params.get("cover_url", "")
        current_album = params.get("album", "")
        if cover_url and current_album and modified_artists:
            for current_artist in modified_artists:
                artist_row = _get_artist(current_artist)
                found_artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=current_artist, existing_only=True)
                if not found_artist_dir:
                    continue
                # Search all subdirs for the album (V2: subdirs are UUIDs)
                from crate.db import get_library_album
                album_row = get_library_album(current_artist, current_album)
                if album_row and album_row.get("path"):
                    album_dir = Path(album_row["path"])
                else:
                    album_dir = found_artist_dir / current_album
                if album_dir.is_dir():
                    cover_path = album_dir / "cover.jpg"
                    if not cover_path.exists():
                        try:
                            import requests
                            resp = requests.get(cover_url, timeout=15)
                            if resp.status_code == 200 and len(resp.content) > 1000:
                                cover_path.write_bytes(resp.content)
                                log.info("Downloaded Tidal cover for %s/%s", current_artist, current_album)
                        except Exception:
                            log.debug("Failed to download Tidal cover", exc_info=True)

        emit_task_event(
            task_id,
            "info",
            {"message": f"Syncing {', '.join(modified_artists)} to library"},
        )
        p.phase = "syncing"
        p.phase_index = 2
        p.done = 0
        p.total = len(modified_artists)
        emit_progress(task_id, p, force=True)
        sync = LibrarySync(config)
        for current_artist in modified_artists:
            artist_row = _get_artist(current_artist)
            found_artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=current_artist, existing_only=True)
            if found_artist_dir and found_artist_dir.is_dir():
                try:
                    sync.sync_artist(found_artist_dir)
                except Exception:
                    # Sync failures here must not trigger a Dramatiq retry —
                    # the files are already on disk, re-downloading 5 GB
                    # would be pointless. The next process_new_content pass
                    # (queued below) will pick them up.
                    log.warning("Sync failed for %s", current_artist, exc_info=True)

        from crate.content import queue_process_new_content_if_needed
        for current_artist in modified_artists:
            try:
                queue_process_new_content_if_needed(
                    current_artist, library_path=config.get("library_path"), force=True
                )
            except Exception:
                log.debug("Failed to queue process_new_content for Tidal artist %s", current_artist, exc_info=True)
    finally:
        # Let the watcher react to any remaining file changes from the
        # queued process_new_content as normal.
        for name in set(staged_artists) | set(modified_artists):
            delete_cache(f"processing:{name.lower()}")

    try:

        start_scan()
    except Exception:
        log.debug("Failed to start library scan after Tidal download", exc_info=True)

    emit_task_event(
        task_id,
        "info",
        {"message": f"Download complete: {len(modified_artists)} artists", "artists": modified_artists},
    )
    now = datetime.now(timezone.utc).isoformat()
    if download_id:
        update_tidal_download(download_id, status="completed", completed_at=now)

    new_release_id = params.get("new_release_id")
    if new_release_id:
        try:
            mark_release_downloaded(new_release_id)
        except Exception:
            log.debug("Failed to mark release %s as downloaded", new_release_id, exc_info=True)

    return {
        "success": True,
        "url": url,
        "quality": quality,
        "files": result.get("file_count", 0),
        "artists": modified_artists,
    }


def _handle_tidal_download(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import update_tidal_download

    url = params.get("url", "")
    quality = params.get("quality", "max")
    download_id = params.get("download_id")
    lib = Path(config["library_path"])

    if not url:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No URL")
        return {"error": "No URL provided"}

    if download_id:
        update_tidal_download(download_id, status="downloading", task_id=task_id)

    try:
        return _tidal_download_inner(task_id, params, config, url, quality, download_id, lib)
    except Exception as exc:
        if download_id:
            try:
                update_tidal_download(download_id, status="failed", error=str(exc)[:200])
            except Exception:
                log.debug("Failed to update tidal_download %s status to failed", download_id, exc_info=True)
        raise


def _update_new_releases_progress(
    task_id: str,
    p: TaskProgress,
    artist_name: str,
    done: int,
    new_count: int,
) -> None:
    p.done = done
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p)


def _find_tidal_release_match(artist_name: str, title: str) -> dict:
    from crate import tidal as tidal_mod

    try:
        tidal_results = tidal_mod.search(f"{artist_name} {title}", content_type="albums", limit=3)
        for tidal_album in tidal_results.get("albums", []):
            title_match = tidal_album.get("title", "").lower()
            if title.lower() in title_match or title_match in title.lower():
                return {
                    "tidal_url": tidal_album.get("url", ""),
                    "tidal_id": str(tidal_album.get("id", "")),
                    "cover_url": tidal_album.get("cover", ""),
                    "tracks": tidal_album.get("tracks", 0),
                    "quality": tidal_album.get("quality", ""),
                }
    except Exception:
        log.debug("Tidal search failed for %s - %s", artist_name, title, exc_info=True)

    return {"tidal_url": "", "tidal_id": "", "cover_url": "", "tracks": 0, "quality": ""}


def _register_new_release(
    task_id: str,
    artist_name: str,
    release: dict,
    today: str,
    known_date: str,
    auto_download: bool,
) -> tuple[int, bool]:
    from crate.db import mark_release_downloading, upsert_new_release

    release_date = release.get("first_release_date", "")
    if not release_date:
        return 0, False

    is_future = release_date >= today
    is_new = release_date > known_date
    if not is_future and not is_new:
        return 0, True

    title = release.get("title", "")
    year = release.get("year", "")
    if not title:
        return 0, False

    artist_credit = release.get("artist-credit", "")
    if isinstance(artist_credit, str) and "various" in artist_credit.lower():
        return 0, False

    tidal_data = _find_tidal_release_match(artist_name, title)
    release_id = upsert_new_release(
        artist_name=artist_name,
        album_title=title,
        tidal_id=tidal_data["tidal_id"],
        tidal_url=tidal_data["tidal_url"],
        cover_url=tidal_data["cover_url"],
        year=year,
        tracks=tidal_data["tracks"],
        quality=tidal_data["quality"],
        release_date=release_date,
        release_type=release.get("type", "Album"),
        mb_release_group_id=release.get("mbid", ""),
    )
    emit_task_event(
        task_id,
        "new_release_found",
        {"message": f"New: {artist_name} - {title} ({year})", "artist": artist_name, "album": title},
    )
    try:
        from crate.telegram import notify_new_release
        notify_new_release(artist_name, title, year)
    except Exception:
        pass

    if auto_download and tidal_data["tidal_url"] and not is_future:
        mark_release_downloading(release_id)
        create_task(
            "tidal_download",
            {
                "url": tidal_data["tidal_url"],
                "artist": artist_name,
                "album": title,
                "quality": get_setting("tidal_quality", "max"),
                "new_release_id": release_id,
            },
        )

    return 1, False


def _handle_check_new_releases(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import get_library_artists
    from crate.musicbrainz_ext import get_artist_releases as mb_get_releases

    auto_download = get_setting("auto_download_new_releases", "false").lower() == "true"

    all_artists, total = get_library_artists(per_page=10000)
    if not all_artists:
        return {"checked": 0, "new_releases": 0}

    new_count = 0
    checked = 0

    p = TaskProgress(phase="checking", phase_count=1, total=total)

    for i, artist in enumerate(all_artists):
        if is_cancelled(task_id):
            break

        name = artist["name"]
        mbid = artist.get("mbid")

        if i % 5 == 0:
            _update_new_releases_progress(task_id, p, name, i, new_count)

        if not mbid:
            continue

        try:
            mb_releases = mb_get_releases(mbid)
            if not mb_releases:
                checked += 1
                continue

            latest_mb = mb_releases[0]
            latest_mb_date = latest_mb.get("first_release_date", "")
            if not latest_mb_date:
                checked += 1
                continue

            known_date = artist.get("latest_release_date") or ""
            today = time.strftime("%Y-%m-%d")

            if not known_date:
                update_artist_latest_release_date(name, latest_mb_date)
                known_date = today

            has_new = False
            for release in mb_releases:
                added_count, should_stop = _register_new_release(
                    task_id,
                    name,
                    release,
                    today,
                    known_date,
                    auto_download,
                )
                if should_stop:
                    break
                if added_count:
                    new_count += added_count
                    has_new = True

            if has_new or latest_mb_date > known_date:
                update_artist_latest_release_date(name, latest_mb_date)

            checked += 1
            time.sleep(1)
        except Exception:
            log.debug("New release check failed for %s", name, exc_info=True)

    return {"checked": checked, "new_releases": new_count}


def _search_alternate_peers(task_id: str, artist: str, skip_username: str, failed_files: list[dict], config: dict):
    import re
    from crate import soulseek

    quality_filter = get_setting("soulseek_quality", "flac")

    for failed in failed_files:
        filename = failed.get("filename", "")
        if not filename:
            continue
        track_name = re.sub(r"^\d+[\s._-]*", "", filename)
        track_name = re.sub(r"\.[^.]+$", "", track_name)
        search_query = f"{artist} {track_name}"

        emit_task_event(task_id, "info", {"message": f"Searching alternate peer for: {track_name}"})
        alt_search_id = soulseek.start_search(search_query)
        if not alt_search_id:
            continue

        time.sleep(12)
        alt_results = soulseek.get_search_results(alt_search_id, quality_filter)

        found = False
        for result in alt_results:
            if result.get("username") == skip_username:
                continue
            for file_info in result.get("files", []):
                file_name = file_info.get("filename", "").replace("\\", "/").split("/")[-1]
                if track_name.lower() in file_name.lower():
                    try:
                        download_result = soulseek.download_files(result["username"], [file_info])
                        if download_result.get("enqueued"):
                            emit_task_event(
                                task_id,
                                "info",
                                {"message": f"Downloading {track_name} from {result['username']}"},
                            )
                            found = True
                            break
                    except Exception:
                        log.debug("Failed to download %s from %s via soulseek", track_name, result["username"], exc_info=True)
            if found:
                break
        if not found:
            emit_task_event(task_id, "info", {"message": f"No alternate source for: {track_name}"})

    alt_wait = 0
    while alt_wait < 120:
        time.sleep(5)
        alt_wait += 5
        all_downloads = soulseek.get_downloads()
        active = [
            download
            for download in all_downloads
            if "Completed" not in download.get("state", "")
            and "Errored" not in download.get("state", "")
            and "Rejected" not in download.get("state", "")
        ]
        if not active:
            break


def _soulseek_download_completed(download: dict) -> bool:
    state = download.get("state", "")
    return "Completed" in state and "Errored" not in state and "Rejected" not in state


def _soulseek_download_failed(download: dict) -> bool:
    state = download.get("state", "")
    return "Errored" in state or "Rejected" in state


def _soulseek_download_active(download: dict) -> bool:
    state = download.get("state", "")
    return "Completed" not in state and "Errored" not in state and "Rejected" not in state


def _infer_soulseek_artist_name(artist: str, original_files: list[str]) -> str:
    if artist and len(artist) > 2:
        return artist

    for file_path in original_files:
        parts = file_path.replace("\\", "/").split("/")
        for part in parts:
            if " - " in part and len(part) > 5:
                candidate = part.split(" - ")[0].strip()
                if len(candidate) > 2:
                    return candidate

    return artist


def _poll_soulseek_download_completion(
    task_id: str,
    artist: str,
    username: str,
    file_count: int,
    config: dict,
) -> list[dict] | dict:
    from crate import soulseek

    max_wait = 900
    max_retries = 3
    elapsed = 0
    retries_done = 0
    completed_files: list[dict] = []

    p = TaskProgress(phase="downloading", phase_count=1, total=file_count, item=entity_label(artist=artist))

    while elapsed < max_wait:
        if is_cancelled(task_id):
            return {"status": "cancelled"}

        time.sleep(5)
        elapsed += 5
        downloads = soulseek.get_downloads()
        user_downloads = [download for download in downloads if download.get("username") == username]
        if not user_downloads:
            break

        completed = sum(1 for download in user_downloads if _soulseek_download_completed(download))
        failed = [download for download in user_downloads if _soulseek_download_failed(download)]
        in_progress = sum(1 for download in user_downloads if _soulseek_download_active(download))
        p.done = completed
        p.errors = len(failed)
        emit_progress(task_id, p)

        if completed >= file_count:
            return [download for download in user_downloads if _soulseek_download_completed(download)]

        if failed and in_progress == 0 and retries_done < max_retries:
            retryable = [download for download in failed if "Rejected" not in download.get("state", "")]
            if retryable:
                retries_done += 1
                emit_task_event(
                    task_id,
                    "info",
                    {
                        "message": f"Retrying {len(retryable)} errored files (attempt {retries_done}/{max_retries})"
                    },
                )
                for download in retryable:
                    full_path = download.get("fullPath", "")
                    if not full_path:
                        continue
                    try:
                        soulseek.download_files(
                            username,
                            [{"filename": full_path, "size": download.get("size", 0)}],
                        )
                    except Exception:
                        log.debug("Failed to retry soulseek download for %s", full_path, exc_info=True)
                time.sleep(5)
            else:
                retries_done = max_retries
            continue

        if failed and in_progress == 0 and retries_done >= max_retries:
            emit_task_event(
                task_id,
                "info",
                {"message": f"{len(failed)} files failed. Searching alternate peers..."},
            )
            _search_alternate_peers(task_id, artist, username, failed, config)
            all_downloads = soulseek.get_downloads()
            return [download for download in all_downloads if _soulseek_download_completed(download)]

    return completed_files


def _move_soulseek_completed_files(
    config: dict,
    artist: str,
    album: str,
    completed_files: list[dict],
) -> int:
    import re

    lib = Path(config["library_path"])
    slsk_download_dir = Path("/downloads/soulseek")
    moved = 0

    clean_album = re.sub(r"^\d{4}\s*[-–]\s*", "", album).strip()
    clean_album = re.sub(r"\s*[\[\(](?:FLAC|flac|MP3|320).*?[\]\)]", "", clean_album).strip()
    if not clean_album:
        clean_album = album
    clean_album = _sanitize_import_name(clean_album)
    _, target_dir, managed_track_names = resolve_import_album_target(lib, artist, clean_album)
    target_dir.mkdir(parents=True, exist_ok=True)

    if not slsk_download_dir.is_dir():
        return 0

    for download in completed_files:
        full_path = download.get("fullPath", "")
        local_name = full_path.replace("\\", "/").split("/")[-1] if full_path else download.get(
            "filename", ""
        )

        found = None
        for file_path in slsk_download_dir.rglob(local_name):
            if file_path.is_file():
                found = file_path
                break

        if found:
            dest = (
                target_dir / f"{uuid.uuid4()}{found.suffix.lower()}"
                if managed_track_names
                else target_dir / found.name
            )
            try:
                shutil.move(str(found), str(dest))
                moved += 1
                log.info("Moved %s -> %s", found.name, dest)
            except Exception as exc:
                log.warning("Failed to move %s: %s", found.name, exc)

    return moved


def _handle_soulseek_download(task_id: str, params: dict, config: dict) -> dict:
    from crate import soulseek

    artist = params.get("artist", "")
    album = params.get("album", "")
    file_count = params.get("file_count", 0)
    username = params.get("username", "")
    find_alternate = params.get("find_alternate", False)
    original_files = params.get("files", [])

    emit_task_event(
        task_id,
        "info",
        {"message": f"Downloading from {username}: {artist} - {album} ({file_count} files)"},
    )

    if find_alternate:
        emit_task_event(
            task_id,
            "info",
            {"message": f"Searching alternate peers for {len(original_files)} file(s)..."},
        )

        artist = _infer_soulseek_artist_name(artist, original_files)

        fake_failed = [
            {"filename": file_path.replace("\\", "/").split("/")[-1], "fullPath": file_path}
            for file_path in original_files
        ]
        _search_alternate_peers(task_id, artist, username, fake_failed, config)

        all_downloads = soulseek.get_downloads()
        completed_files = [
            download
            for download in all_downloads
            if _soulseek_download_completed(download)
        ]

    if not find_alternate:
        poll_result = _poll_soulseek_download_completion(
            task_id,
            artist,
            username,
            file_count,
            config,
        )
        if isinstance(poll_result, dict):
            return poll_result
        completed_files = poll_result

    all_complete = len(completed_files) >= file_count
    moved = 0

    if not all_complete:
        if completed_files and artist:
            moved = _move_soulseek_completed_files(config, artist, album, completed_files)
            emit_task_event(
                task_id,
                "info",
                {
                    "message": f"Album incomplete: moved {moved}/{file_count} completed files to library."
                },
            )
        else:
            emit_task_event(
                task_id,
                "info",
                {
                    "message": f"Album incomplete: {len(completed_files)}/{file_count} files. Not moving to library."
                },
            )
        if artist and moved > 0:
            from crate.content import queue_process_new_content_if_needed
            if queue_process_new_content_if_needed(
                artist, library_path=config.get("library_path"), force=True
            ):
                emit_task_event(task_id, "info", {"message": f"Processing partial content for {artist}"})
        return {
            "artist": artist,
            "album": album,
            "source": "soulseek",
            "moved": moved,
            "completed": len(completed_files),
            "incomplete": True,
            "partial": moved > 0,
        }

    if completed_files and artist:
        moved = _move_soulseek_completed_files(config, artist, album, completed_files)

        import re

        year_match = re.search(r"(\d{4})", album)
        year = year_match.group(1) if year_match else ""
        clean_album = re.sub(r"^\d{4}\s*[-–]\s*", "", album).strip()
        clean_album = re.sub(r"\s*[\[\(](?:FLAC|flac|MP3|320).*?[\]\)]", "", clean_album).strip()
        if not clean_album:
            clean_album = album
        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Moved {moved} files to {artist}/{year}/{clean_album}"
                if year
                else f"Moved {moved} files to {artist}/{clean_album}"
            },
        )

    if artist and moved > 0:
        from crate.content import queue_process_new_content_if_needed
        if queue_process_new_content_if_needed(
            artist, library_path=config.get("library_path"), force=True
        ):
            emit_task_event(task_id, "info", {"message": f"Processing new content for {artist}"})

    return {
        "artist": artist,
        "album": album,
        "source": "soulseek",
        "moved": moved,
        "completed": len(completed_files),
    }


def _handle_cleanup_incomplete_downloads(task_id: str, params: dict, config: dict) -> dict:
    import datetime as dt

    emit_task_event(task_id, "info", {"message": "Starting cleanup of incomplete downloads..."})

    downloads_dir = Path(config.get("downloads_path", "/downloads/soulseek"))
    if not downloads_dir.exists():
        return {"cleaned": 0, "message": "Downloads dir not found"}

    cleaned = 0
    details = []

    for user_dir in downloads_dir.iterdir():
        if not user_dir.is_dir():
            continue
        for album_dir in user_dir.iterdir():
            if not album_dir.is_dir():
                continue
            audio_files = [
                file_path
                for file_path in album_dir.iterdir()
                if file_path.suffix.lower() in (".flac", ".mp3", ".ogg", ".opus", ".m4a")
            ]
            if 0 < len(audio_files) < 3:
                age = dt.datetime.now() - dt.datetime.fromtimestamp(album_dir.stat().st_mtime)
                if age.total_seconds() > 48 * 3600:
                    shutil.rmtree(album_dir, ignore_errors=True)
                    details.append(str(album_dir))
                    cleaned += 1
            elif len(audio_files) == 0:
                shutil.rmtree(album_dir, ignore_errors=True)
                cleaned += 1

        if user_dir.exists() and not any(user_dir.iterdir()):
            user_dir.rmdir()

    from crate.soulseek import clear_completed_downloads, clear_errored_downloads

    clear_completed_downloads()
    clear_errored_downloads()

    emit_task_event(task_id, "info", {"message": f"Cleanup complete: {cleaned} incomplete downloads removed"})
    return {"cleaned": cleaned, "details": details}


def _handle_library_upload(task_id: str, params: dict, config: dict) -> dict:
    from crate.importer import ImportQueue
    from crate.library_sync import LibrarySync

    staging_dir = Path(params.get("staging_dir", ""))
    uploader_user_id = params.get("uploader_user_id")
    if not staging_dir.exists():
        return {"error": "Upload staging not found"}

    raw_dir = staging_dir / "raw"
    extracted_dir = staging_dir / "extracted"
    grouped_dir = staging_dir / "grouped"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))

    emit_task_event(task_id, "info", {"message": "Preparing uploaded files"})
    p_upload = TaskProgress(phase="preparing", phase_count=3)
    emit_progress(task_id, p_upload, force=True)

    zip_count = 0
    for file_path in sorted(raw_dir.iterdir()):
        if not file_path.is_file() or file_path.suffix.lower() != ".zip":
            continue
        zip_target = extracted_dir / file_path.stem
        zip_target.mkdir(parents=True, exist_ok=True)
        _safe_extract_zip(file_path, zip_target)
        zip_count += 1

    loose_audio_count = _group_loose_audio_files(raw_dir, grouped_dir, extensions)

    candidate_roots = [path for path in [grouped_dir, extracted_dir] if path.exists()]
    album_dirs: list[Path] = []
    seen_album_dirs: set[str] = set()
    for root in candidate_roots:
        for album_dir in _find_album_dirs_recursive(root, extensions):
            key = str(album_dir.resolve())
            if key not in seen_album_dirs:
                seen_album_dirs.add(key)
                album_dirs.append(album_dir)

    if not album_dirs:
        shutil.rmtree(staging_dir, ignore_errors=True)
        return {"error": "No supported audio files found in upload"}

    queue = ImportQueue(config)
    imported_albums: list[dict] = []

    p_upload.phase = "importing"
    p_upload.phase_index = 1
    p_upload.total = len(album_dirs)
    p_upload.done = 0
    emit_progress(task_id, p_upload, force=True)
    for index, album_dir in enumerate(album_dirs, start=1):
        if is_cancelled(task_id):
            break

        result = queue.import_item(str(album_dir))
        if result.get("error"):
            imported_albums.append({"source_path": str(album_dir), "error": result["error"]})
            continue

        dest = Path(result["dest"])
        artist = dest.parent.name
        album = dest.name
        imported_albums.append(
            {
                "source_path": str(album_dir),
                "dest": str(dest),
                "artist": artist,
                "album": album,
                "status": result.get("status", "imported"),
            }
        )
        emit_item_event(task_id, level="info", message=f"Imported {artist} — {album}", artist=artist, album=album)
        p_upload.done = index
        p_upload.item = entity_label(artist=artist, album=album)
        emit_progress(task_id, p_upload)

    modified_artists = sorted({item["artist"] for item in imported_albums if item.get("artist")})
    lib = Path(config["library_path"])
    sync = LibrarySync(config)

    emit_task_event(task_id, "info", {"message": "Syncing imported music to library", "artists": modified_artists})
    p_upload.phase = "syncing"
    p_upload.phase_index = 2
    p_upload.done = 0
    p_upload.total = len(modified_artists)
    emit_progress(task_id, p_upload, force=True)
    for artist in modified_artists:
        from crate.db import get_library_artist as _get_artist_fn
        artist_row = _get_artist_fn(artist)
        found_dir = resolve_artist_dir(lib, artist_row, fallback_name=artist, existing_only=True)
        if found_dir and found_dir.is_dir():
            try:
                sync.sync_artist(found_dir)
            except Exception:
                log.warning("Sync failed for uploaded artist %s", artist, exc_info=True)

    _seed_uploaded_library(uploader_user_id, imported_albums)

    from crate.content import queue_process_new_content_if_needed
    for artist in modified_artists:
        try:
            queue_process_new_content_if_needed(
                artist, library_path=config.get("library_path"), force=True
            )
        except Exception:
            log.debug("Failed to queue process_new_content for uploaded artist %s", artist, exc_info=True)

    try:

        start_scan()
    except Exception:
        log.debug("Failed to start library scan after library upload", exc_info=True)

    shutil.rmtree(staging_dir, ignore_errors=True)
    return {
        "success": True,
        "albums_imported": len([item for item in imported_albums if item.get("dest")]),
        "artists": modified_artists,
        "zip_archives": zip_count,
        "loose_audio_files": loose_audio_count,
        "imported_albums": imported_albums,
    }


def _handle_remux_m4a_dash(task_id: str, params: dict, config: dict) -> dict:
    """Fix tiddl intermediate M4A files in the library.

    tiddl fetches raw DASH streams as .m4a, converts to .flac with tags,
    but sometimes leaves the intermediates behind.  These ghost files
    have no metadata, zero duration, and pollute the library.

    For each album directory:
    - If FLAC files already exist alongside → delete the M4A intermediates
    - If M4A-only (conversion failed) → remux to native FLAC via ffmpeg
    """
    from crate.m4a_fix import cleanup_tidal_intermediates, is_tidal_intermediate, remux_m4a_dash_to_flac

    lib = Path(config.get("library_path", "/music"))
    dry_run = bool(params.get("dry_run", False))

    emit_task_event(task_id, "info", {"message": "Scanning library for tiddl intermediate M4A files..."})

    p_remux = TaskProgress(phase="cleanup", phase_count=2)

    def _remux_cleanup_progress(data):
        p_remux.done = data.get("done", p_remux.done)
        p_remux.total = data.get("total", p_remux.total)
        emit_progress(task_id, p_remux)

    # Phase 1: cleanup intermediates where FLACs exist
    cleanup = cleanup_tidal_intermediates(
        lib,
        progress_callback=_remux_cleanup_progress,
    )

    deleted = cleanup["deleted"]
    bytes_freed = cleanup["bytes_freed"]

    # Phase 2: find M4A-only albums (conversion failed) and remux
    m4a_only: dict[Path, list[Path]] = {}
    for f in lib.rglob("*.m4a"):
        if f.is_file() and is_tidal_intermediate(f):
            parent = f.parent
            has_flac = any(x.suffix.lower() == ".flac" for x in parent.iterdir() if x.is_file())
            if not has_flac:
                m4a_only.setdefault(parent, []).append(f)

    converted = 0
    failed = 0
    total_remux = sum(len(files) for files in m4a_only.values())

    if total_remux and not dry_run:
        emit_task_event(task_id, "info", {
            "message": f"Found {total_remux} M4A files in {len(m4a_only)} albums with no FLACs — remuxing",
        })
        p_remux.phase = "remuxing"
        p_remux.phase_index = 1
        p_remux.done = 0
        p_remux.total = total_remux
        done = 0
        for album_dir, m4a_files in m4a_only.items():
            try:
                rel = album_dir.relative_to(lib)
                parts = rel.parts
                artist_guess = parts[0] if len(parts) >= 2 else ""
                album_guess = parts[1] if len(parts) >= 3 else ""
            except ValueError:
                artist_guess = ""
                album_guess = ""

            for m4a_path in m4a_files:
                done += 1
                p_remux.done = done
                p_remux.item = m4a_path.name
                emit_progress(task_id, p_remux)
                if remux_m4a_dash_to_flac(m4a_path, artist=artist_guess, album=album_guess):
                    converted += 1
                else:
                    failed += 1

    mb_freed = bytes_freed / (1024 * 1024)
    emit_task_event(task_id, "info", {
        "message": (
            f"M4A fix complete: {deleted} intermediates deleted ({mb_freed:.0f} MB freed), "
            f"{converted} remuxed to FLAC, {failed} failed"
        ),
    })

    if (deleted > 0 or converted > 0) and not dry_run:
        from crate.library_sync import start_scan
        try:
            start_scan()
        except Exception:
            log.debug("Failed to start scan after M4A fix", exc_info=True)

    return {
        "deleted": deleted,
        "bytes_freed": bytes_freed,
        "converted": converted,
        "failed": failed,
        "m4a_only_albums": len(m4a_only),
        "dry_run": dry_run,
    }


ACQUISITION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "tidal_download": _handle_tidal_download,
    "check_new_releases": _handle_check_new_releases,
    "soulseek_download": _handle_soulseek_download,
    "cleanup_incomplete_downloads": _handle_cleanup_incomplete_downloads,
    "library_upload": _handle_library_upload,
    "remux_m4a_dash": _handle_remux_m4a_dash,
}
