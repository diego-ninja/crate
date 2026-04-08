import json
import logging
import re
import shutil
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from crate.audio import get_audio_files, read_tags
from crate.db import create_task, create_task_dedup, emit_task_event, get_db_ctx, get_setting, get_task, update_task
from crate.db.user_library import follow_artist, like_track, save_album
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _sanitize_import_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "Unknown"


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
    from crate.db import mark_release_downloaded, update_tidal_download
    from crate.library_sync import LibrarySync
    from crate.tidal import download, move_to_library

    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    desc = f"{artist_name} - {album_name}" if artist_name else url
    emit_task_event(task_id, "info", {"message": f"Downloading from Tidal: {desc}"})
    update_task(
        task_id,
        progress=json.dumps(
            {"phase": "downloading", "artist": artist_name, "album": album_name, "url": url}
        ),
    )
    result = download(
        url,
        quality=quality,
        task_id=task_id,
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
    )

    if not result.get("success"):
        if download_id:
            update_tidal_download(download_id, status="failed", error=result.get("error", "Download failed"))
        return {"error": result.get("error", "Download failed"), "phase": "download"}

    if download_id:
        update_tidal_download(download_id, status="processing")
    emit_task_event(
        task_id,
        "info",
        {"message": f"Moving {result.get('file_count', 0)} files to library"},
    )
    update_task(task_id, progress=json.dumps({"phase": "moving", "files": result.get("file_count", 0)}))
    modified_artists = move_to_library(result["path"], str(lib))

    if not modified_artists:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No files moved")
        return {"error": "No files were moved", "phase": "move"}

    cover_url = params.get("cover_url", "")
    if cover_url and modified_artists:
        for current_artist in modified_artists:
            current_album = params.get("album", "")
            if not current_album:
                continue
            album_dir = lib / current_artist / current_album
            if not album_dir.is_dir():
                artist_dir = lib / current_artist
                if artist_dir.is_dir():
                    for candidate in artist_dir.iterdir():
                        if candidate.is_dir() and current_album.lower() in candidate.name.lower():
                            album_dir = candidate
                            break
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
    update_task(task_id, progress=json.dumps({"phase": "syncing", "artists": modified_artists}))
    sync = LibrarySync(config)
    for current_artist in modified_artists:
        artist_dir = lib / current_artist
        if artist_dir.is_dir():
            try:
                sync.sync_artist(artist_dir)
            except Exception:
                log.warning("Sync failed for %s", current_artist, exc_info=True)

    from crate.content import queue_process_new_content_if_needed
    for current_artist in modified_artists:
        try:
            queue_process_new_content_if_needed(
                current_artist, library_path=config.get("library_path"), force=True
            )
        except Exception:
            log.debug("Failed to queue process_new_content for Tidal artist %s", current_artist, exc_info=True)

    try:
        from crate.navidrome import start_scan

        start_scan()
    except Exception:
        log.debug("Failed to start Navidrome scan after Tidal download", exc_info=True)

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
    artist_name: str,
    done: int,
    total: int,
    new_count: int,
) -> None:
    update_task(
        task_id,
        progress=json.dumps(
            {
                "phase": "checking",
                "artist": artist_name,
                "done": done,
                "total": total,
                "new_releases": new_count,
            }
        ),
    )


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

    for i, artist in enumerate(all_artists):
        if is_cancelled(task_id):
            break

        name = artist["name"]
        mbid = artist.get("mbid")

        if i % 5 == 0:
            _update_new_releases_progress(task_id, name, i, total, new_count)

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
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
                        (latest_mb_date, name),
                    )
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
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
                        (latest_mb_date, name),
                    )

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
        update_task(
            task_id,
            progress=json.dumps(
                {
                    "completed": completed,
                    "errored": len(failed),
                    "in_progress": in_progress,
                    "total": file_count,
                    "artist": artist,
                }
            ),
        )

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

    year = ""
    year_match = re.search(r"(\d{4})", album)
    if year_match:
        year = year_match.group(1)

    clean_album = re.sub(r"^\d{4}\s*[-–]\s*", "", album).strip()
    clean_album = re.sub(r"\s*[\[\(](?:FLAC|flac|MP3|320).*?[\]\)]", "", clean_album).strip()
    if not clean_album:
        clean_album = album

    target_dir = lib / artist / year / clean_album if year else lib / artist / clean_album
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
            dest = target_dir / found.name
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
        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Album incomplete: {len(completed_files)}/{file_count} files. Not moving to library."
            },
        )
        return {
            "artist": artist,
            "album": album,
            "source": "soulseek",
            "moved": 0,
            "completed": len(completed_files),
            "incomplete": True,
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
    update_task(task_id, progress=json.dumps({"phase": "preparing"}))

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

    update_task(task_id, progress=json.dumps({"phase": "importing", "albums_total": len(album_dirs), "albums_done": 0}))
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
        emit_task_event(
            task_id,
            "info",
            {"message": f"Imported {artist} — {album}", "artist": artist, "album": album},
        )
        update_task(
            task_id,
            progress=json.dumps(
                {"phase": "importing", "albums_total": len(album_dirs), "albums_done": index, "artist": artist, "album": album}
            ),
        )

    modified_artists = sorted({item["artist"] for item in imported_albums if item.get("artist")})
    lib = Path(config["library_path"])
    sync = LibrarySync(config)

    emit_task_event(task_id, "info", {"message": "Syncing imported music to library", "artists": modified_artists})
    update_task(task_id, progress=json.dumps({"phase": "syncing", "artists": modified_artists}))
    for artist in modified_artists:
        artist_dir = lib / artist
        if artist_dir.is_dir():
            try:
                sync.sync_artist(artist_dir)
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
        from crate.navidrome import start_scan

        start_scan()
    except Exception:
        log.debug("Failed to start Navidrome scan after library upload", exc_info=True)

    shutil.rmtree(staging_dir, ignore_errors=True)
    return {
        "success": True,
        "albums_imported": len([item for item in imported_albums if item.get("dest")]),
        "artists": modified_artists,
        "zip_archives": zip_count,
        "loose_audio_files": loose_audio_count,
        "imported_albums": imported_albums,
    }


ACQUISITION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "tidal_download": _handle_tidal_download,
    "check_new_releases": _handle_check_new_releases,
    "soulseek_download": _handle_soulseek_download,
    "cleanup_incomplete_downloads": _handle_cleanup_incomplete_downloads,
    "library_upload": _handle_library_upload,
}
