import logging
import re
import shutil
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from crate.audio import get_audio_files, read_tags
from crate.db.cache_settings import get_setting
from crate.db.cache_store import delete_cache, set_cache
from crate.db.events import emit_task_event
from crate.db.jobs.acquisition import update_artist_latest_release_date
from crate.db.repositories.library import (
    delete_quarantined_album,
    get_library_album,
    get_library_artist,
    get_library_artists,
    get_library_tracks,
    quarantine_album,
    unquarantine_album,
)
from crate.db.releases import mark_release_downloaded, mark_release_downloading, upsert_new_release
from crate.db.queries.tasks import get_task
from crate.db.repositories.tasks import create_task, create_task_dedup
from crate.db.tidal import get_tidal_download, update_tidal_download
from crate.db.repositories.user_library import follow_artist, like_track, save_album
from crate.task_progress import TaskProgress, emit_progress, emit_item_event, entity_label
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
    from crate.library_sync import LibrarySync
    from crate.m4a_fix import repair_tidal_artifacts
    from crate.tidal import download, get_album_track_count, get_album_tracks, inspect_download_tree, move_to_library

    from crate.tidal import ensure_auth
    if not ensure_auth():
        if download_id:
            update_tidal_download(download_id, status="failed", error="Tidal auth expired")
        return {"error": "Tidal authentication expired — refresh in Settings", "phase": "auth"}

    # Quarantine old album if this is a quality upgrade
    upgrade_album_id = params.get("upgrade_album_id")
    if upgrade_album_id:
        if quarantine_album(int(upgrade_album_id), task_id):
            emit_task_event(task_id, "info", {"message": f"Quarantined existing album #{upgrade_album_id} for upgrade"})

    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    desc = f"{artist_name} - {album_name}" if artist_name else url
    emit_task_event(task_id, "info", {"message": f"Downloading from Tidal: {desc}"})

    p = TaskProgress(phase="downloading", phase_count=3, item=entity_label(artist=artist_name, album=album_name))
    emit_progress(task_id, p, force=True)

    def _dl_progress(data):
        p.done = data.get("done", p.done)
        if data.get("total"):
            p.total = data["total"]
        track = data.get("track")
        if track:
            p.item = track
            emit_item_event(task_id, message=f"Downloaded: {track}", title=track)
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

    def _cleanup_progress(data):
        p.phase = "cleanup"
        p.done = data.get("done", p.done)
        p.total = data.get("total", p.total)
        emit_progress(task_id, p)

    def _refresh_result(current_result: dict) -> dict:
        refreshed = inspect_download_tree(Path(current_result["path"]))
        merged = dict(current_result)
        merged.update(refreshed)
        return merged

    def _repair_result(current_result: dict) -> tuple[dict, dict]:
        repair = repair_tidal_artifacts(
            Path(current_result["path"]),
            allow_lossy_rename=True,
            progress_callback=_cleanup_progress,
        )
        refreshed = _refresh_result(current_result)
        refreshed["repair_summary"] = repair
        return refreshed, repair

    def _is_lossless_request(requested_quality: str) -> bool:
        return (requested_quality or "").lower() in {"high", "max", "lossless"}

    def _run_normal_fallback(current_result: dict, reason: str) -> dict:
        emit_task_event(task_id, "warn", {"message": reason})
        fallback = download(
            url,
            quality="normal",
            task_id=f"{task_id}_normal",
            progress_callback=_dl_progress,
        )
        if not fallback.get("success"):
            return {"error": fallback.get("error", "Fallback download failed"), "phase": "download"}
        fallback, fallback_repair = _repair_result(fallback)
        fallback["quality_fallback"] = "normal"
        fallback["repair_summary"] = fallback_repair
        try:
            shutil.rmtree(current_result.get("path", ""), ignore_errors=True)
        except Exception:
            log.debug("Failed to remove abandoned Tidal staging dir %s", current_result.get("path"), exc_info=True)
        emit_task_event(
            task_id,
            "info",
            {"message": "Tidal delivered lossy/incomplete lossless output; using clean M4A fallback instead"},
        )
        return fallback

    result, repair = _repair_result(result)

    if repair.get("deleted"):
        mb = repair["bytes_freed"] / (1024 * 1024)
        emit_task_event(task_id, "info", {
            "message": f"Cleaned up {repair['deleted']} Tidal temp artifacts ({mb:.0f} MB)",
        })
    if repair.get("remuxed_to_flac") or repair.get("renamed_to_flac"):
        recovered = repair.get("remuxed_to_flac", 0) + repair.get("renamed_to_flac", 0)
        emit_task_event(task_id, "info", {
            "message": f"Recovered {recovered} lossless files from Tidal wrappers before import",
        })
    if repair.get("renamed_to_m4a"):
        emit_task_event(task_id, "warn", {
            "message": f"Normalized {repair['renamed_to_m4a']} AAC/ALAC files to M4A so they can be served directly",
        })

    if _is_lossless_request(quality) and repair.get("unrecoverable"):
        fallback = _run_normal_fallback(
            result,
            "Lossless Tidal output contained unrecoverable temp/AAC wrappers; retrying in normal quality",
        )
        if fallback.get("error"):
            if download_id:
                update_tidal_download(download_id, status="failed", error=str(fallback["error"])[:200])
            return fallback
        result = fallback
        repair = result.get("repair_summary", {})

    # Validate track count for album downloads and retry if partial
    content_type = params.get("content_type", "album")
    if content_type == "album" and result.get("success"):
        album_id = url.rstrip("/").split("/")[-1]
        expected = get_album_track_count(album_id)
        if not expected:
            expected = len(get_album_tracks(album_id) or []) or None
        actual_audio = result.get("audio_file_count", result.get("file_count", 0))
        if expected and actual_audio < expected:
            emit_task_event(task_id, "warn", {
                "message": f"Partial download: got {actual_audio}/{expected} tracks, retrying..."
            })
            retry_result = download(url, quality=quality, task_id=f"{task_id}_retry", progress_callback=_dl_progress)
            if retry_result.get("success"):
                retry_result, retry_repair = _repair_result(retry_result)
                retry_audio = retry_result.get("audio_file_count", 0)
                if retry_audio > actual_audio:
                    try:
                        shutil.rmtree(result.get("path", ""), ignore_errors=True)
                    except Exception:
                        log.debug("Failed to remove abandoned Tidal retry dir %s", result.get("path"), exc_info=True)
                    result = retry_result
                    repair = retry_repair
                    emit_task_event(task_id, "info", {
                        "message": f"Retry improved: {retry_audio}/{expected} tracks"
                    })
                else:
                    emit_task_event(task_id, "warn", {
                        "message": f"Retry didn't improve: still {actual_audio}/{expected} tracks"
                    })
            actual_audio = result.get("audio_file_count", result.get("file_count", 0))
            if actual_audio < expected and _is_lossless_request(quality):
                fallback = _run_normal_fallback(
                    result,
                    f"Lossless download only produced {actual_audio}/{expected} usable tracks; retrying in normal quality",
                )
                if fallback.get("error"):
                    if download_id:
                        update_tidal_download(download_id, status="failed", error=str(fallback["error"])[:200])
                    return fallback
                result = fallback
                repair = result.get("repair_summary", {})
                actual_audio = result.get("audio_file_count", result.get("file_count", 0))
            if actual_audio < expected:
                message = f"Partial Tidal download: got {actual_audio}/{expected} tracks"
                if result.get("errors"):
                    message = f"{message}. {result['errors'][-1]}"
                if download_id:
                    update_tidal_download(download_id, status="failed", error=message[:200])
                return {"error": message, "phase": "download"}

    if download_id:
        update_tidal_download(download_id, status="processing")
    if result.get("warning"):
        emit_task_event(task_id, "info", {"message": f"Tidal reported partial issues but files were produced: {result['warning']}"})

    invalid_audio = list(result.get("invalid_audio_files") or [])
    temp_artifacts = list(result.get("temp_artifact_files") or [])
    if invalid_audio or temp_artifacts:
        artifact_count = len(invalid_audio) + len(temp_artifacts)
        message = f"Tidal download produced invalid staging artifacts ({artifact_count} files); import aborted"
        details = invalid_audio[:2] + temp_artifacts[:2]
        emit_task_event(task_id, "warn", {"message": message, "files": details})
        error_detail = result.get("errors", [])[-1] if result.get("errors") else message
        if download_id:
            update_tidal_download(download_id, status="failed", error=str(error_detail)[:200])
        return {"error": message, "phase": "cleanup", "invalid_files": details}

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
        # Download Tidal cover for specific album if provided
        cover_url = params.get("cover_url", "")
        current_album = params.get("album", "")
        if cover_url and current_album and modified_artists:
            for current_artist in modified_artists:
                artist_row = get_library_artist(current_artist)
                found_artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=current_artist, existing_only=True)
                if not found_artist_dir:
                    continue
                # Search all subdirs for the album (V2: subdirs are UUIDs)
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
            artist_row = get_library_artist(current_artist)
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

    # Clean up quarantined album DB records after successful upgrade
    # (files not deleted — new download may share the same directory)
    if upgrade_album_id:
        try:
            deleted = delete_quarantined_album(int(upgrade_album_id))
            if deleted:
                emit_task_event(task_id, "info", {"message": f"Replaced old album records (id={upgrade_album_id})"})
        except Exception:
            log.warning("Failed to clean up quarantined album %s", upgrade_album_id, exc_info=True)

    return {
        "success": True,
        "url": url,
        "quality": result.get("quality_fallback", quality),
        "requested_quality": quality,
        "files": result.get("file_count", 0),
        "artists": modified_artists,
    }


def _handle_tidal_download(task_id: str, params: dict, config: dict) -> dict:
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
        # Restore quarantined album on failure
        upgrade_album_id = params.get("upgrade_album_id")
        if upgrade_album_id:
            try:
                unquarantine_album(int(upgrade_album_id))
                log.info("Restored quarantined album %s after download failure", upgrade_album_id)
            except Exception:
                log.warning("Failed to unquarantine album %s", upgrade_album_id, exc_info=True)
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
    seen_completed: set[str] = set()

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

        # Emit per-track events for newly completed files
        for dl in user_downloads:
            fname = dl.get("filename", "")
            if _soulseek_download_completed(dl) and fname not in seen_completed:
                seen_completed.add(fname)
                emit_item_event(task_id, message=f"Downloaded: {fname}", title=fname)
            elif _soulseek_download_active(dl) and fname not in seen_completed:
                pct = dl.get("percentComplete", 0)
                speed = dl.get("averageSpeed", 0)
                if pct > 0:
                    speed_str = f"{speed // 1024} KB/s" if speed < 1048576 else f"{speed / 1048576:.1f} MB/s"
                    p.item = f"{fname} ({pct}% @ {speed_str})"

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

    # Quarantine old album if this is a quality upgrade
    upgrade_album_id = params.get("upgrade_album_id")
    if upgrade_album_id:
        if quarantine_album(int(upgrade_album_id), task_id):
            emit_task_event(task_id, "info", {"message": f"Quarantined existing album #{upgrade_album_id} for upgrade"})

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
        # Incomplete download — restore quarantined album
        if upgrade_album_id:
            try:
                unquarantine_album(int(upgrade_album_id))
            except Exception:
                log.warning("Failed to unquarantine album %s", upgrade_album_id, exc_info=True)
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

    # Clean up quarantined album after successful upgrade
    if upgrade_album_id and moved > 0:
        try:
            deleted = delete_quarantined_album(int(upgrade_album_id))
            if deleted:
                emit_task_event(task_id, "info", {"message": f"Replaced old album records (id={upgrade_album_id})"})
        except Exception:
            log.warning("Failed to clean up quarantined album %s", upgrade_album_id, exc_info=True)
    elif upgrade_album_id and moved == 0:
        # Download produced no files — restore the old album
        try:
            unquarantine_album(int(upgrade_album_id))
        except Exception:
            log.warning("Failed to unquarantine album %s", upgrade_album_id, exc_info=True)

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
        artist_row = get_library_artist(artist)
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
    """Fix Tidal download artifacts in the library.

    Kept under the legacy task name for compatibility, but the repair now
    covers more than ``*.m4a`` leftovers:

    - temp ``tmp*`` files and zero-byte artifacts
    - raw FLAC streams with the wrong extension
    - MP4 containers carrying real FLAC that can be remuxed losslessly
    - named AAC/ALAC containers that should be served as ``.m4a`` instead
      of pretending to be ``.flac``
    """
    from crate.m4a_fix import repair_tidal_artifacts

    lib = Path(config.get("library_path", "/music"))
    dry_run = bool(params.get("dry_run", False))

    emit_task_event(task_id, "info", {"message": "Scanning library for Tidal download artifacts..."})

    p_remux = TaskProgress(phase="repairing", phase_count=1)

    def _remux_cleanup_progress(data):
        p_remux.phase = data.get("phase", p_remux.phase)
        p_remux.done = data.get("done", p_remux.done)
        p_remux.total = data.get("total", p_remux.total)
        p_remux.item = data.get("file", p_remux.item)
        emit_progress(task_id, p_remux)

    summary = repair_tidal_artifacts(
        lib,
        allow_lossy_rename=True,
        progress_callback=_remux_cleanup_progress,
        dry_run=dry_run,
    )

    deleted = summary["deleted"]
    bytes_freed = summary["bytes_freed"]
    recovered_lossless = summary["remuxed_to_flac"] + summary["renamed_to_flac"]
    renamed_to_m4a = summary["renamed_to_m4a"]
    failed = summary["unrecoverable"]
    mb_freed = bytes_freed / (1024 * 1024)

    emit_task_event(task_id, "info", {
        "message": (
            f"Tidal artifact fix complete: {deleted} temp files deleted ({mb_freed:.0f} MB freed), "
            f"{recovered_lossless} lossless files recovered, {renamed_to_m4a} files normalized to M4A, "
            f"{failed} unrecoverable"
        ),
    })
    if summary["lossy_files"]:
        emit_task_event(task_id, "warn", {
            "message": "Some Tidal files are only available as AAC/ALAC wrappers and will be served as M4A",
            "files": summary["lossy_files"][:5],
        })
    if summary["unrecoverable_files"]:
        emit_task_event(task_id, "warn", {
            "message": "Some Tidal artifacts could not be repaired automatically",
            "files": summary["unrecoverable_files"][:5],
        })

    if (deleted > 0 or recovered_lossless > 0 or renamed_to_m4a > 0) and not dry_run:
        from crate.library_sync import start_scan
        try:
            start_scan()
        except Exception:
            log.debug("Failed to start scan after M4A fix", exc_info=True)

    return {
        "deleted": deleted,
        "bytes_freed": bytes_freed,
        "converted": recovered_lossless,
        "failed": failed,
        "renamed_to_m4a": renamed_to_m4a,
        "lossy_files": summary["lossy_files"],
        "unrecoverable_files": summary["unrecoverable_files"],
        "m4a_only_albums": 0,
        "dry_run": dry_run,
    }


def _handle_import_queue_item(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.import_queue_read_models import mark_import_queue_item_imported
    from crate.importer import ImportQueue

    source_path = str(params.get("source_path") or "").strip()
    if not source_path:
        return {"error": "source_path is required"}

    queue = ImportQueue(config)
    artist = params.get("artist")
    album = params.get("album")
    emit_task_event(task_id, "info", {"message": f"Importing staged album from {source_path}"})
    result = queue.import_item(source_path, artist, album)
    if result.get("error"):
        emit_task_event(task_id, "error", {"message": result["error"], "source_path": source_path})
        return result

    mark_import_queue_item_imported(source_path, result=result)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Imported staged album to {result.get('dest')}",
            "source_path": source_path,
            "dest": result.get("dest"),
            "status": result.get("status"),
        },
    )
    start_scan()
    return result


def _handle_import_queue_all(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.import_queue_read_models import list_import_queue_items, mark_import_queue_item_imported
    from crate.importer import ImportQueue

    items = list_import_queue_items(status="pending", limit=5000)
    if not items:
        emit_task_event(task_id, "info", {"message": "No pending staged imports"})
        return {"status": "noop", "imported": 0, "failed": 0, "results": []}

    queue = ImportQueue(config)
    progress = TaskProgress(phase="importing", phase_count=1, total=len(items), done=0)
    emit_progress(task_id, progress, force=True)
    results: list[dict] = []
    imported = 0
    failed = 0

    for index, item in enumerate(items, start=1):
        if is_cancelled(task_id):
            emit_task_event(task_id, "warning", {"message": "Import-all cancelled"})
            break

        result = queue.import_item(item["source_path"], item.get("artist"), item.get("album"))
        result["source"] = item.get("source")
        result["source_path"] = item["source_path"]
        results.append(result)
        if result.get("error"):
            failed += 1
            emit_task_event(
                task_id,
                "error",
                {
                    "message": result["error"],
                    "source_path": item["source_path"],
                },
            )
        else:
            imported += 1
            mark_import_queue_item_imported(
                item["source_path"],
                result=result,
                source=item.get("source"),
            )
            emit_item_event(
                task_id,
                level="info",
                message=f"Imported {item.get('artist') or 'Unknown Artist'} — {item.get('album') or 'Unknown Album'}",
                artist=item.get("artist"),
                album=item.get("album"),
            )

        progress.done = index
        progress.item = entity_label(artist=item.get("artist"), album=item.get("album"))
        emit_progress(task_id, progress)

    if imported > 0:
        start_scan()

    return {
        "status": "completed",
        "imported": imported,
        "failed": failed,
        "results": results,
    }


def _handle_import_queue_remove(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.import_queue_read_models import remove_import_queue_item
    from crate.importer import ImportQueue

    source_path = str(params.get("source_path") or "").strip()
    if not source_path:
        return {"error": "source_path is required"}

    queue = ImportQueue(config)
    emit_task_event(task_id, "info", {"message": f"Removing staged source {source_path}"})
    ok = queue.remove_source(source_path)
    if ok:
        remove_import_queue_item(source_path)
        emit_task_event(task_id, "info", {"message": "Staged source removed", "source_path": source_path})
    else:
        emit_task_event(task_id, "warning", {"message": "Staged source not found", "source_path": source_path})
    return {"removed": ok, "source_path": source_path}


ACQUISITION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "tidal_download": _handle_tidal_download,
    "check_new_releases": _handle_check_new_releases,
    "soulseek_download": _handle_soulseek_download,
    "cleanup_incomplete_downloads": _handle_cleanup_incomplete_downloads,
    "library_upload": _handle_library_upload,
    "import_queue_item": _handle_import_queue_item,
    "import_queue_all": _handle_import_queue_all,
    "import_queue_remove": _handle_import_queue_remove,
    "remux_m4a_dash": _handle_remux_m4a_dash,
}
