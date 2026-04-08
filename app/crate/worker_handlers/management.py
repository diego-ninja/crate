import json
import logging
import shutil
from pathlib import Path
def _escape_like(value: str) -> str:
    """Escape SQL LIKE metacharacters and prepend wildcard for year-prefix matching."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"% - {escaped}"

from crate.db import (
    create_task,
    delete_cache,
    emit_task_event,
    get_cache,
    get_db_ctx,
    get_task,
    set_cache,
    update_task,
)
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


def _handle_health_check(task_id: str, params: dict, config: dict) -> dict:
    from crate.health_check import LibraryHealthCheck

    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data))
    )
    set_cache("health_report", report, ttl=3600)
    issue_count = len(report.get("issues", []))
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Health check complete: {issue_count} issues",
            "summary": report.get("summary", {}),
        },
    )
    return {"issue_count": issue_count, "summary": report.get("summary", {})}


def _handle_repair(task_id: str, params: dict, config: dict) -> dict:
    from crate.navidrome import start_scan
    from crate.repair import LibraryRepair

    dry_run = params.get("dry_run", True)
    auto_only = params.get("auto_only", True)
    specific_issues = params.get("issues")

    if specific_issues:
        report = {"issues": specific_issues}
    else:
        report = get_cache("health_report")
        if not report:
            from crate.health_check import LibraryHealthCheck

            checker = LibraryHealthCheck(config)
            report = checker.run(
                progress_callback=lambda data: update_task(task_id, progress=json.dumps(data))
            )
            set_cache("health_report", report, ttl=3600)

    affected_artists = set()
    for issue in report.get("issues", []):
        details = issue.get("details") or issue.get("details_json") or {}
        artist = details.get("artist") or details.get("db_artist") or ""
        if artist:
            affected_artists.add(artist)

    if not dry_run:
        for artist in affected_artists:
            _mark_processing(artist)

    try:
        repairer = LibraryRepair(config)
        result = repairer.repair(
            report,
            dry_run=dry_run,
            auto_only=auto_only,
            task_id=task_id,
            progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
        )

        action_count = len(result.get("actions", []))
        resolved_ids = result.get("resolved_ids", [])

        # Mark resolved issues as fixed in the DB
        if not dry_run and resolved_ids:
            from crate.db import resolve_issue
            for issue_id in resolved_ids:
                try:
                    resolve_issue(issue_id)
                except Exception:
                    log.debug("Failed to mark issue %s as resolved", issue_id, exc_info=True)

        # Collect unique artists that need re-enrichment from repair actions
        # (e.g. unindexed_files that just got synced). Queue one
        # process_new_content per artist after the loop, not per action —
        # otherwise we flood the worker with duplicates that all skip.
        enrich_artists: set[str] = set()
        for action in result.get("actions", []):
            if action.get("applied"):
                artist = (action.get("details") or {}).get("enrich_artist")
                if artist:
                    enrich_artists.add(artist)

        enqueued_enrich = 0
        if not dry_run and enrich_artists:
            from crate.content import queue_process_new_content_if_needed

            for artist in sorted(enrich_artists):
                try:
                    # force=True because the repair actions just mutated the
                    # DB and the filesystem content_hash may still match
                    # what's stored in library_artists.
                    if queue_process_new_content_if_needed(
                        artist, library_path=config.get("library_path"), force=True
                    ):
                        enqueued_enrich += 1
                except Exception:
                    log.debug("Failed to queue enrichment for %s", artist, exc_info=True)

        emit_task_event(
            task_id,
            "info",
            {
                "message": (
                    f"Repair complete: {action_count} actions, "
                    f"{len(resolved_ids)} resolved, "
                    f"{enqueued_enrich} enrichments queued"
                ),
                "fs_changed": result.get("fs_changed"),
                "db_changed": result.get("db_changed"),
            },
        )
        if not dry_run and result.get("fs_changed"):
            start_scan()

        result["enrich_queued"] = enqueued_enrich
        return result
    finally:
        if not dry_run:
            for artist in affected_artists:
                _unmark_processing(artist)


def _handle_library_pipeline(task_id: str, params: dict, config: dict) -> dict:
    from crate.health_check import LibraryHealthCheck
    from crate.navidrome import start_scan
    from crate.repair import LibraryRepair
    from crate.scheduler import mark_run
    from crate.db import get_library_artists
    from crate.library_sync import LibrarySync

    emit_task_event(task_id, "info", {"message": "Pipeline: running health check..."})
    update_task(task_id, progress=json.dumps({"phase": "health_check"}))
    if is_cancelled(task_id):
        return {"status": "cancelled"}

    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda data: update_task(
            task_id,
            progress=json.dumps({**data, "phase": "health_check"}),
        )
    )
    set_cache("health_report", report, ttl=3600)

    if is_cancelled(task_id):
        return {"status": "cancelled"}

    emit_task_event(task_id, "info", {"message": "Pipeline: running repair..."})
    update_task(task_id, progress=json.dumps({"phase": "repair"}))
    repairer = LibraryRepair(config)
    repair_result = repairer.repair(
        report,
        dry_run=False,
        auto_only=True,
        task_id=task_id,
        progress_callback=lambda data: update_task(
            task_id,
            progress=json.dumps({**data, "phase": "repair"}),
        ),
    )

    if is_cancelled(task_id):
        return {"status": "cancelled"}

    emit_task_event(task_id, "info", {"message": "Pipeline: running sync..."})
    update_task(task_id, progress=json.dumps({"phase": "sync"}))
    sync = LibrarySync(config)
    sync_result = sync.full_sync(
        progress_callback=lambda data: update_task(
            task_id,
            progress=json.dumps({**data, "phase": "sync"}),
        )
    )

    if repair_result.get("fs_changed"):
        start_scan()

    from crate.content import queue_process_new_content_if_needed

    repair_enrich_artists: set[str] = set()
    for action in repair_result.get("actions", []):
        if action.get("applied"):
            artist = (action.get("details") or {}).get("enrich_artist")
            if artist:
                repair_enrich_artists.add(artist)

    for artist in sorted(repair_enrich_artists):
        try:
            queue_process_new_content_if_needed(
                artist, library_path=config.get("library_path"), force=True
            )
        except Exception:
            log.debug("Failed to queue enrichment for %s", artist, exc_info=True)

    all_artists, _ = get_library_artists(per_page=10000)
    queued = 0
    for artist in all_artists:
        if not artist.get("content_hash"):
            if queue_process_new_content_if_needed(
                artist["name"], library_path=config.get("library_path")
            ):
                queued += 1
    if queued:
        emit_task_event(
            task_id,
            "info",
            {"message": f"Queued {queued} artists for enrichment + analysis"},
        )

    mark_run("library_pipeline")

    return {
        "health": {"issue_count": len(report.get("issues", []))},
        "repair": {"actions": len(repair_result.get("actions", []))},
        "sync": sync_result,
        "enrichment_queued": queued,
    }


def _handle_delete_artist(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import delete_artist as db_delete_artist, get_library_artist, log_audit
    from crate.navidrome import start_scan

    name = params.get("name", "")
    mode = params.get("mode", "db_only")
    lib = Path(config["library_path"])

    artist = get_library_artist(name)
    folder = (artist.get("folder_name") if artist else None) or name
    artist_dir = lib / folder

    if mode == "full" and artist_dir.is_dir():
        shutil.rmtree(str(artist_dir))
        log.info("Deleted artist directory: %s", artist_dir)

    db_delete_artist(name)

    for prefix in ENRICHMENT_CACHE_PREFIXES:
        delete_cache(f"{prefix}{name.lower()}")

    emit_task_event(task_id, "info", {"message": f"Deleted artist: {name}", "mode": mode})
    log_audit("delete_artist", "artist", name, details={"mode": mode, "folder": folder}, task_id=task_id)

    if mode == "full":
        start_scan()

    return {"deleted": name, "mode": mode}


def _handle_delete_album(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import (
        delete_album as db_delete_album,
        get_library_albums,
        get_library_artist,
        log_audit,
        upsert_artist,
    )
    from crate.navidrome import start_scan

    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    mode = params.get("mode", "db_only")
    lib = Path(config["library_path"])

    db_path = None
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT path FROM library_albums WHERE artist = %s AND name = %s LIMIT 1",
            (artist_name, album_name),
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                "SELECT path FROM library_albums WHERE artist = %s AND name LIKE %s ESCAPE '\\' LIMIT 1",
                (artist_name, _escape_like(album_name)),
            )
            row = cur.fetchone()
        if row:
            db_path = row["path"]

    album_dir = Path(db_path) if db_path else lib / artist_name / album_name

    if mode == "full" and album_dir.is_dir():
        shutil.rmtree(str(album_dir))

    db_delete_album(db_path or str(album_dir))

    artist_data = get_library_artist(artist_name)
    if artist_data:
        folder = artist_data.get("folder_name") or artist_name
        albums = get_library_albums(artist_name)
        upsert_artist(
            {
                "name": artist_name,
                "folder_name": folder,
                "album_count": len(albums),
                "track_count": sum(album.get("track_count", 0) for album in albums),
                "total_size": sum(album.get("total_size", 0) for album in albums),
                "formats": [],
                "has_photo": artist_data.get("has_photo", 0),
            }
        )

    emit_task_event(
        task_id,
        "info",
        {"message": f"Deleted album: {artist_name}/{album_name}", "mode": mode},
    )
    log_audit("delete_album", "album", f"{artist_name}/{album_name}", details={"mode": mode}, task_id=task_id)

    if mode == "full":
        start_scan()

    return {"deleted": f"{artist_name}/{album_name}", "mode": mode}


def _handle_move_artist(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import get_library_artist, log_audit
    from crate.navidrome import start_scan

    name = params.get("name", "")
    new_name = params.get("new_name", "")
    lib = Path(config["library_path"])

    artist = get_library_artist(name)
    if not artist:
        return {"error": f"Artist not found: {name}"}

    folder = artist.get("folder_name") or name
    old_dir = lib / folder
    new_dir = lib / new_name

    if old_dir.is_dir():
        shutil.move(str(old_dir), str(new_dir))

    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_artists SET name = %s, folder_name = %s WHERE name = %s",
            (new_name, new_name, name),
        )
        cur.execute("UPDATE library_albums SET artist = %s WHERE artist = %s", (new_name, name))
        cur.execute("UPDATE library_tracks SET artist = %s WHERE artist = %s", (new_name, name))
        cur.execute("SELECT id, path FROM library_albums WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_albums SET path = %s WHERE id = %s", (new_path, row["id"]))
        cur.execute("SELECT id, path FROM library_tracks WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_tracks SET path = %s WHERE id = %s", (new_path, row["id"]))

    try:
        import mutagen

        for audio_file in new_dir.rglob("*"):
            if audio_file.is_file() and audio_file.suffix.lower() in DEFAULT_AUDIO_EXTENSIONS:
                try:
                    mf = mutagen.File(audio_file, easy=True)
                    if mf is not None:
                        mf["albumartist"] = new_name
                        mf.save()
                except Exception:
                    log.warning("Failed to retag %s", audio_file)
    except Exception:
        log.warning("Retagging failed for %s", new_name, exc_info=True)

    emit_task_event(task_id, "info", {"message": f"Moved artist: {name} → {new_name}"})
    log_audit("move_artist", "artist", name, details={"new_name": new_name}, task_id=task_id)
    start_scan()

    return {"moved": name, "new_name": new_name}


def _handle_wipe_library(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import log_audit, wipe_library_tables

    wipe_library_tables()
    emit_task_event(task_id, "info", {"message": "Library database wiped"})
    log_audit("wipe_library", "database", "library", task_id=task_id)

    if params.get("rebuild"):
        create_task("rebuild_library")

    return {"wiped": True, "rebuild": params.get("rebuild", False)}


def _handle_rebuild_library(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import log_audit, wipe_library_tables

    update_task(task_id, progress=json.dumps({"phase": "wipe"}))
    wipe_library_tables()
    emit_task_event(
        task_id,
        "info",
        {"message": "Rebuild: database wiped, starting pipeline..."},
    )
    log_audit("rebuild_library_wipe", "database", "library", task_id=task_id)

    result = _handle_library_pipeline(task_id, params, config)

    log_audit("rebuild_library_complete", "database", "library", details=result, task_id=task_id)
    return result


def _handle_update_album_tags(task_id: str, params: dict, config: dict) -> dict:
    import mutagen
    from crate.audio import get_audio_files

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    album_fields = params.get("album_fields", {})
    track_tags = params.get("track_tags", {})

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    tracks = get_audio_files(album_dir, list(DEFAULT_AUDIO_EXTENSIONS))
    updated = 0
    errors = []

    for track in tracks:
        try:
            audio = mutagen.File(track, easy=True)
            if audio is None:
                continue
            for key, value in album_fields.items():
                audio[key] = value
            if track.name in track_tags:
                for key, value in track_tags[track.name].items():
                    audio[key] = value
            audio.save()
            updated += 1
        except Exception as exc:
            errors.append({"file": track.name, "error": str(exc)})

    emit_task_event(task_id, "info", {"message": f"Updated tags: {updated} tracks"})
    return {"updated": updated, "errors": errors}


def _handle_update_track_tags(task_id: str, params: dict, config: dict) -> dict:
    import mutagen

    lib = Path(config["library_path"])
    filepath = params.get("filepath", "")
    tags = params.get("tags", {})

    track_path = lib / filepath
    if not track_path.is_file():
        return {"error": "Track not found"}

    try:
        audio = mutagen.File(track_path, easy=True)
        if audio is None:
            return {"error": "Cannot read file"}
        for key, value in tags.items():
            audio[key] = value
        audio.save()
        return {"status": "ok", "file": track_path.name}
    except Exception as exc:
        return {"error": str(exc)}


def _handle_resolve_duplicates(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    trash = lib / ".librarian-trash"
    keep = params.get("keep", "")
    remove_list = params.get("remove", [])
    removed = []

    for path_str in remove_list:
        album_dir = lib / path_str
        if not album_dir.is_dir():
            continue
        dest = trash / album_dir.relative_to(lib)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(album_dir), str(dest))
        removed.append(path_str)

    emit_task_event(
        task_id,
        "info",
        {"message": f"Resolved duplicates: kept {keep}, removed {len(removed)}"},
    )
    return {"kept": keep, "removed": removed}


def _handle_match_apply(task_id: str, params: dict, config: dict) -> dict:
    from crate.library_sync import LibrarySync
    from crate.matcher import apply_match

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    release = params.get("release", {})

    album_path_str = params.get("album_path", "")
    album_dir = Path(album_path_str) if album_path_str else lib / artist_folder / album_folder
    if not album_dir.is_dir():
        artist_dir = lib / artist_folder
        if artist_dir.is_dir():
            for sub in artist_dir.iterdir():
                if sub.is_dir() and sub.name.isdigit() and len(sub.name) == 4:
                    candidate = sub / album_folder
                    if candidate.is_dir():
                        album_dir = candidate
                        break
    if not album_dir.is_dir():
        return {"error": f"Album not found: {artist_folder}/{album_folder}"}

    result = apply_match(album_dir, DEFAULT_AUDIO_EXTENSIONS, release)
    updated_count = result.get("updated", 0)
    emit_task_event(task_id, "info", {"message": f"Applied MusicBrainz tags: {updated_count} tracks"})

    mbid = result.get("mbid")
    release_group_id = result.get("release_group_id")
    if mbid:
        try:
            album_db_path = str(album_dir)
            with get_db_ctx() as cur:
                cur.execute("SELECT path FROM library_albums WHERE path = %s", (album_db_path,))
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        "SELECT path FROM library_albums WHERE artist = %s AND (name = %s OR name LIKE %s ESCAPE '\\') LIMIT 1",
                        (artist_folder, album_folder, _escape_like(album_folder)),
                    )
                    row = cur.fetchone()
                if row:
                    album_db_path = row["path"]

            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_albums SET musicbrainz_albumid = %s WHERE path = %s",
                    (mbid, album_db_path),
                )
                if release_group_id:
                    cur.execute(
                        "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE path = %s",
                        (release_group_id, album_db_path),
                    )
                updated = cur.rowcount

            if updated:
                emit_task_event(task_id, "info", {"message": f"Synced MBID {mbid[:8]}... to DB"})
            else:
                log.warning("MBID update matched 0 rows for path=%s", album_db_path)
        except Exception as exc:
            log.error("Failed to sync MBID to DB: %s", exc, exc_info=True)

    try:
        syncer = LibrarySync(config)
        syncer.sync_album(album_dir, artist_folder)
        emit_task_event(task_id, "info", {"message": "Re-synced album to DB"})
    except Exception as exc:
        log.error("Failed to re-sync album after match apply: %s", exc, exc_info=True)

    return result


MANAGEMENT_TASK_HANDLERS: dict[str, TaskHandler] = {
    "health_check": _handle_health_check,
    "repair": _handle_repair,
    "library_pipeline": _handle_library_pipeline,
    "delete_artist": _handle_delete_artist,
    "delete_album": _handle_delete_album,
    "move_artist": _handle_move_artist,
    "wipe_library": _handle_wipe_library,
    "rebuild_library": _handle_rebuild_library,
    "match_apply": _handle_match_apply,
    "update_album_tags": _handle_update_album_tags,
    "update_track_tags": _handle_update_track_tags,
    "resolve_duplicates": _handle_resolve_duplicates,
}
