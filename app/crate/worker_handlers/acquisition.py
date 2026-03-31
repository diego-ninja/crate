import json
import logging
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from crate.db import create_task, create_task_dedup, emit_task_event, get_db_ctx, get_setting, get_task, update_task

log = logging.getLogger(__name__)

TaskHandler = Callable[[str, dict, dict], dict]


def _is_cancelled(task_id: str) -> bool:
    try:
        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


def _compute_dir_hash(directory: Path) -> str:
    try:
        from crate.crate_cli import has_subcommands, is_available, run_scan

        if is_available() and has_subcommands():
            data = run_scan(str(directory), hash=True, covers=False)
            if data and data.get("artists"):
                content_hash = data["artists"][0].get("content_hash")
                if content_hash:
                    return content_hash
    except Exception:
        pass

    import hashlib

    digest = hashlib.md5(usedforsecurity=False)
    for file_path in sorted(directory.rglob("*")):
        if file_path.is_file():
            digest.update(f"{file_path.relative_to(directory)}:{file_path.stat().st_size}\n".encode())
    return digest.hexdigest()


def _should_process_artist(artist_name: str, config: dict) -> bool:
    from crate.db import get_library_artist

    lib = Path(config["library_path"])
    artist_row = get_library_artist(artist_name)
    folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
    artist_dir = lib / folder
    if not artist_dir.is_dir():
        return False
    old_hash = artist_row.get("content_hash") if artist_row else None
    if not old_hash:
        return True
    new_hash = _compute_dir_hash(artist_dir)
    return new_hash != old_hash


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

    for current_artist in modified_artists:
        try:
            if _should_process_artist(current_artist, config):
                create_task_dedup("process_new_content", {"artist": current_artist})
        except Exception:
            pass

    try:
        from crate.navidrome import start_scan

        start_scan()
    except Exception:
        pass

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
            pass

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
                pass
        raise


def _handle_check_new_releases(task_id: str, params: dict, config: dict) -> dict:
    from crate import tidal as tidal_mod
    from crate.db import get_library_artists, mark_release_downloading, upsert_new_release
    from crate.musicbrainz_ext import get_artist_releases as mb_get_releases

    auto_download = get_setting("auto_download_new_releases", "false").lower() == "true"

    all_artists, total = get_library_artists(per_page=10000)
    if not all_artists:
        return {"checked": 0, "new_releases": 0}

    new_count = 0
    checked = 0

    for i, artist in enumerate(all_artists):
        if _is_cancelled(task_id):
            break

        name = artist["name"]
        mbid = artist.get("mbid")

        if i % 5 == 0:
            update_task(
                task_id,
                progress=json.dumps(
                    {
                        "phase": "checking",
                        "artist": name,
                        "done": i,
                        "total": total,
                        "new_releases": new_count,
                    }
                ),
            )

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
                release_date = release.get("first_release_date", "")
                if not release_date:
                    continue
                is_future = release_date >= today
                is_new = release_date > known_date
                if not is_future and not is_new:
                    break
                title = release.get("title", "")
                year = release.get("year", "")
                if not title:
                    continue
                artist_credit = release.get("artist-credit", "")
                if isinstance(artist_credit, str) and "various" in artist_credit.lower():
                    continue

                tidal_url = tidal_id = cover_url = quality = ""
                tracks = 0
                try:
                    tidal_results = tidal_mod.search(f"{name} {title}", content_type="albums", limit=3)
                    for tidal_album in tidal_results.get("albums", []):
                        title_match = tidal_album.get("title", "").lower()
                        if title.lower() in title_match or title_match in title.lower():
                            tidal_url = tidal_album.get("url", "")
                            tidal_id = str(tidal_album.get("id", ""))
                            cover_url = tidal_album.get("cover", "")
                            tracks = tidal_album.get("tracks", 0)
                            quality = tidal_album.get("quality", "")
                            break
                except Exception:
                    pass

                release_id = upsert_new_release(
                    artist_name=name,
                    album_title=title,
                    tidal_id=tidal_id,
                    tidal_url=tidal_url,
                    cover_url=cover_url,
                    year=year,
                    tracks=tracks,
                    quality=quality,
                    release_date=release_date,
                    release_type=release.get("type", "Album"),
                    mb_release_group_id=release.get("mbid", ""),
                )
                new_count += 1
                has_new = True
                emit_task_event(
                    task_id,
                    "new_release_found",
                    {"message": f"New: {name} - {title} ({year})", "artist": name, "album": title},
                )

                if auto_download and tidal_url and not is_future:
                    mark_release_downloading(release_id)
                    create_task(
                        "tidal_download",
                        {
                            "url": tidal_url,
                            "artist": name,
                            "album": title,
                            "quality": get_setting("tidal_quality", "max"),
                            "new_release_id": release_id,
                        },
                    )

            if has_new or latest_mb_date > known_date:
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
                        (latest_mb_date, name),
                    )

            checked += 1
            time.sleep(1)
        except Exception:
            log.debug("New release check failed for %s", name)

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
                        pass
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


def _handle_soulseek_download(task_id: str, params: dict, config: dict) -> dict:
    from crate import soulseek
    import re

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

        if artist and len(artist) <= 2:
            for file_path in original_files:
                parts = file_path.replace("\\", "/").split("/")
                for part in parts:
                    if " - " in part and len(part) > 5:
                        artist = part.split(" - ")[0].strip()
                        break
                if len(artist) > 2:
                    break

        fake_failed = [
            {"filename": file_path.replace("\\", "/").split("/")[-1], "fullPath": file_path}
            for file_path in original_files
        ]
        _search_alternate_peers(task_id, artist, username, fake_failed, config)

        all_downloads = soulseek.get_downloads()
        completed_files = [
            download
            for download in all_downloads
            if "Completed" in download.get("state", "")
            and "Errored" not in download.get("state", "")
            and "Rejected" not in download.get("state", "")
        ]

    if not find_alternate:
        max_wait = 900
        max_retries = 3
        elapsed = 0
        retries_done = 0
        completed_files = []
        while elapsed < max_wait:
            if _is_cancelled(task_id):
                return {"status": "cancelled"}
            time.sleep(5)
            elapsed += 5
            downloads = soulseek.get_downloads()
            user_downloads = [download for download in downloads if download.get("username") == username]
            if not user_downloads:
                break
            completed = sum(
                1
                for download in user_downloads
                if "Completed" in download.get("state", "")
                and "Errored" not in download.get("state", "")
                and "Rejected" not in download.get("state", "")
            )
            failed = [
                download
                for download in user_downloads
                if "Errored" in download.get("state", "") or "Rejected" in download.get("state", "")
            ]
            in_progress = sum(
                1
                for download in user_downloads
                if "Completed" not in download.get("state", "")
                and "Errored" not in download.get("state", "")
                and "Rejected" not in download.get("state", "")
            )
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
                completed_files = [
                    download
                    for download in user_downloads
                    if "Completed" in download.get("state", "")
                    and "Errored" not in download.get("state", "")
                    and "Rejected" not in download.get("state", "")
                ]
                break
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
                        if full_path:
                            try:
                                soulseek.download_files(
                                    username,
                                    [{"filename": full_path, "size": download.get("size", 0)}],
                                )
                            except Exception:
                                pass
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
                completed_files = [
                    download
                    for download in all_downloads
                    if "Completed" in download.get("state", "")
                    and "Errored" not in download.get("state", "")
                    and "Rejected" not in download.get("state", "")
                ]
                break

    all_complete = len(completed_files) >= file_count
    lib = Path(config["library_path"])
    slsk_download_dir = Path("/downloads/soulseek")
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

        if slsk_download_dir.is_dir():
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

        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Moved {moved} files to {artist}/{year}/{clean_album}"
                if year
                else f"Moved {moved} files to {artist}/{clean_album}"
            },
        )

    if artist and moved > 0 and _should_process_artist(artist, config):
        create_task_dedup("process_new_content", {"artist": artist})
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


ACQUISITION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "tidal_download": _handle_tidal_download,
    "check_new_releases": _handle_check_new_releases,
    "soulseek_download": _handle_soulseek_download,
    "cleanup_incomplete_downloads": _handle_cleanup_incomplete_downloads,
}
