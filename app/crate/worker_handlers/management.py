import logging
import re
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from crate.db.audit import log_audit, wipe_library_tables
from crate.db.cache_runtime import get_redis
from crate.db.cache_store import delete_cache, set_cache
from crate.db.events import emit_task_event
from crate.db.health import get_open_issues, resolve_issue
from crate.db.jobs.management import (
    apply_mbid_to_album,
    find_album_path,
    find_album_path_for_match,
    rename_artist_in_db,
)
from crate.db.jobs.repair import (
    create_split_album_and_move_tracks,
    merge_album_into_album,
    merge_artist_into_artist,
    update_album_artist_and_path,
)
from crate.db.queries.health import get_duplicate_tracks
from crate.db.repositories.library import (
    delete_album as db_delete_album,
    delete_artist as db_delete_artist,
    delete_track as db_delete_track,
    get_library_album,
    get_library_album_by_id,
    get_library_albums,
    get_library_artist,
    get_library_artist_by_id,
    get_library_artists,
    get_library_tracks,
    resolve_library_track_reference,
    update_artist_metadata as db_update_artist_metadata,
    upsert_artist,
)
from crate.db.repositories.playlists import (
    execute_smart_rules,
    get_playlist,
    get_smart_playlists_for_refresh,
    log_generation_complete,
    log_generation_failed,
    log_generation_start,
    regenerate_playlist_tracks,
    set_generation_status,
    update_playlist,
)
from crate.db.repositories.tasks import create_task
from crate.task_progress import TaskProgress, emit_progress
from crate.utils import PHOTO_NAMES
from crate.worker_handlers import (
    DEFAULT_AUDIO_EXTENSIONS,
    TaskHandler,
    is_cancelled,
    start_scan,
)

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


def _escape_like(value: str) -> str:
    """Escape SQL LIKE metacharacters and prepend wildcard for year-prefix matching."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"% - {escaped}"


def _tag_values(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list | tuple):
        return [str(item) for item in value]
    return [str(value)]


def _mark_processing(artist_name: str):
    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)


def _unmark_processing(artist_name: str):
    delete_cache(f"processing:{artist_name.lower()}")


def _handle_health_check(task_id: str, params: dict, config: dict) -> dict:
    from crate.health_check import LibraryHealthCheck

    p_hc = TaskProgress(phase="health_check", phase_count=1)

    def _hc_progress(data):
        p_hc.done = data.get("done", p_hc.done)
        p_hc.total = data.get("total", p_hc.total)
        p_hc.item = data.get("check", p_hc.item)
        emit_progress(task_id, p_hc)

    checker = LibraryHealthCheck(config)
    report = checker.run(progress_callback=_hc_progress)
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
    from crate.health_check import LibraryHealthCheck
    from crate.repair import LibraryRepair
    from crate.db.admin_health_surface import publish_health_surface_signal
    from crate.db.domain_events import append_domain_event

    dry_run = params.get("dry_run", True)
    auto_only = params.get("auto_only", True)
    specific_issues = params.get("issues")

    if specific_issues:
        report = {"issues": specific_issues}
    else:
        # Pull directly from the persisted health_issues table so each issue
        # carries its DB id. The in-memory health_report cache is built from
        # LibraryHealthCheck.run() which returns issues without ids, which
        # means the repair could fix them but had no way to mark them as
        # resolved afterwards.
        db_issues = get_open_issues(limit=10000)
        # Normalize to the shape LibraryRepair expects: 'check' + 'details'.
        report_issues = []
        for row in db_issues:
            issue = dict(row)
            issue["check"] = issue.get("check_type") or issue.get("check")
            if "details" not in issue and "details_json" in issue:
                issue["details"] = issue["details_json"]
            report_issues.append(issue)
        report = {"issues": report_issues}

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
        p_repair = TaskProgress(phase="repair", phase_count=1)

        def _repair_progress(data):
            p_repair.done = data.get("done", p_repair.done)
            p_repair.total = data.get("total", p_repair.total)
            p_repair.item = data.get("action", p_repair.item)
            emit_progress(task_id, p_repair)

        def _repair_event(data: dict):
            level = str(data.get("level") or "info").lower()
            explicit_event_type = str(data.get("event_type") or "").strip().lower()
            event_type = explicit_event_type or (
                "warning"
                if level in {"warn", "warning"}
                else "error"
                if level == "error"
                else "info"
            )
            payload = {
                k: v for k, v in data.items() if k not in {"level", "event_type"}
            }
            payload.setdefault("category", "repair")
            emit_task_event(task_id, event_type, payload)
            if dry_run or event_type != "item":
                return
            outcome = str(payload.get("outcome") or "").strip().lower()
            if outcome not in {
                "started",
                "applied",
                "skipped",
                "failed",
                "unsupported",
            }:
                return
            append_domain_event(
                f"library.repair.item.{outcome}",
                {
                    "task_id": task_id,
                    "check_type": payload.get("check_type") or payload.get("check"),
                    "item_key": payload.get("item_key"),
                    "target": payload.get("target"),
                    "action": payload.get("action"),
                    "outcome": outcome,
                    "fs_write": payload.get("fs_write"),
                },
                scope="repair",
                subject_key=task_id,
            )

        repairer = LibraryRepair(config)
        result = repairer.repair(
            report,
            dry_run=dry_run,
            auto_only=auto_only,
            task_id=task_id,
            progress_callback=_repair_progress,
            event_callback=_repair_event,
        )

        action_count = len(result.get("actions", []))
        resolved_ids = result.get("resolved_ids", [])
        repair_summary = result.get("summary") or {}
        applied_check_types = sorted(
            {
                str(item.get("check_type"))
                for item in result.get("item_results", [])
                if item.get("outcome") == "applied" and item.get("check_type")
            }
        )
        global_revalidation_check_types = []
        artist_revalidation_check_types = []
        skipped_revalidation_check_types = []
        if applied_check_types:
            from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK

            for check_type in applied_check_types:
                catalog_entry = REPAIR_CATALOG_BY_CHECK.get(check_type)
                if (
                    catalog_entry is not None
                    and not catalog_entry.supports_global_scope
                ):
                    if check_type == "artist_layout_fix":
                        artist_revalidation_check_types.append(check_type)
                    else:
                        skipped_revalidation_check_types.append(check_type)
                else:
                    global_revalidation_check_types.append(check_type)
        revalidation_result = None
        revalidation_results = []
        completed_revalidation_check_types = []

        # Mark resolved issues as fixed in the DB
        if not dry_run and resolved_ids:
            for issue_id in resolved_ids:
                try:
                    resolve_issue(issue_id)
                except Exception:
                    log.debug(
                        "Failed to mark issue %s as resolved", issue_id, exc_info=True
                    )
            publish_health_surface_signal()

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
                    log.debug(
                        "Failed to queue enrichment for %s", artist, exc_info=True
                    )

        if not dry_run and artist_revalidation_check_types and affected_artists:
            p_revalidate_artist = TaskProgress(phase="revalidate", phase_count=1)

            def _revalidate_artist_progress(data):
                p_revalidate_artist.done = data.get("done", p_revalidate_artist.done)
                p_revalidate_artist.total = data.get("total", p_revalidate_artist.total)
                p_revalidate_artist.item = (
                    data.get("artist") or data.get("check") or p_revalidate_artist.item
                )
                emit_progress(task_id, p_revalidate_artist)

            emit_task_event(
                task_id,
                "info",
                {
                    "category": "repair",
                    "message": (
                        f"Revalidating {len(artist_revalidation_check_types)} artist-scoped check type(s) "
                        f"for {len(affected_artists)} artist(s)…"
                    ),
                    "checks": artist_revalidation_check_types,
                    "artists": sorted(affected_artists),
                },
            )
            checker = LibraryHealthCheck(config)
            artist_revalidation_result = checker.run_selected_for_artists(
                set(artist_revalidation_check_types),
                sorted(affected_artists),
                progress_callback=_revalidate_artist_progress,
                persist=True,
            )
            revalidation_results.append(artist_revalidation_result)
            completed_revalidation_check_types.extend(artist_revalidation_check_types)
            publish_health_surface_signal()
            emit_task_event(
                task_id,
                "info",
                {
                    "category": "repair",
                    "message": (
                        f"Artist revalidation complete: "
                        f"{len(artist_revalidation_result.get('issues', []))} open issue(s) remain across "
                        f"{len(affected_artists)} artist(s)"
                    ),
                    "checks": artist_revalidation_check_types,
                    "artists": sorted(affected_artists),
                    "summary": artist_revalidation_result.get("summary", {}),
                    "issue_count": len(artist_revalidation_result.get("issues", [])),
                },
            )
        elif not dry_run and artist_revalidation_check_types:
            skipped_revalidation_check_types.extend(artist_revalidation_check_types)

        if not dry_run and skipped_revalidation_check_types:
            emit_task_event(
                task_id,
                "info",
                {
                    "category": "repair",
                    "message": (
                        "Skipped revalidation for artist-scoped check(s) without a known artist: "
                        + ", ".join(skipped_revalidation_check_types)
                    ),
                    "checks": skipped_revalidation_check_types,
                },
            )

        if not dry_run and global_revalidation_check_types:
            p_revalidate = TaskProgress(phase="revalidate", phase_count=1)

            def _revalidate_progress(data):
                p_revalidate.done = data.get("done", p_revalidate.done)
                p_revalidate.total = data.get("total", p_revalidate.total)
                p_revalidate.item = data.get("check", p_revalidate.item)
                emit_progress(task_id, p_revalidate)

            emit_task_event(
                task_id,
                "info",
                {
                    "category": "repair",
                    "message": f"Revalidating {len(global_revalidation_check_types)} repaired check type(s)…",
                    "checks": global_revalidation_check_types,
                },
            )
            checker = LibraryHealthCheck(config)
            global_revalidation_result = checker.run_selected(
                set(global_revalidation_check_types),
                progress_callback=_revalidate_progress,
                persist=True,
            )
            revalidation_results.append(global_revalidation_result)
            completed_revalidation_check_types.extend(global_revalidation_check_types)
            publish_health_surface_signal()
            emit_task_event(
                task_id,
                "info",
                {
                    "category": "repair",
                    "message": (
                        f"Revalidation complete: "
                        f"{len(global_revalidation_result.get('issues', []))} open issue(s) remain across "
                        f"{len(global_revalidation_check_types)} repaired check type(s)"
                    ),
                    "checks": global_revalidation_check_types,
                    "summary": global_revalidation_result.get("summary", {}),
                    "issue_count": len(global_revalidation_result.get("issues", [])),
                },
            )

        if revalidation_results:
            merged_summary = {}
            merged_issues = []
            duration_ms = 0
            for item in revalidation_results:
                merged_issues.extend(item.get("issues", []))
                duration_ms += int(item.get("duration_ms") or 0)
                for key, value in (item.get("summary") or {}).items():
                    merged_summary[key] = merged_summary.get(key, 0) + int(value or 0)
            revalidation_result = {
                "issues": merged_issues,
                "summary": merged_summary,
                "duration_ms": duration_ms,
            }

        emit_task_event(
            task_id,
            "info",
            {
                "message": (
                    f"Repair complete: "
                    f"{repair_summary.get('applied', 0)} applied, "
                    f"{repair_summary.get('skipped', 0)} skipped, "
                    f"{repair_summary.get('failed', 0)} failed, "
                    f"{repair_summary.get('unsupported', 0)} manual, "
                    f"{len(resolved_ids)} resolved, "
                    f"{enqueued_enrich} enrichments queued"
                    + (
                        f", {len(revalidation_result.get('issues', []))} issue(s) remain after revalidation"
                        if revalidation_result is not None
                        else ""
                    )
                ),
                "summary": repair_summary,
                "action_count": action_count,
                "fs_changed": result.get("fs_changed"),
                "db_changed": result.get("db_changed"),
                "unsupported_checks": result.get("unsupported_checks", []),
                "revalidated_checks": sorted(completed_revalidation_check_types),
                "skipped_revalidation_checks": skipped_revalidation_check_types,
                "revalidation": {
                    "issue_count": len(revalidation_result.get("issues", [])),
                    "summary": revalidation_result.get("summary", {}),
                    "duration_ms": revalidation_result.get("duration_ms"),
                }
                if revalidation_result is not None
                else None,
            },
        )
        if not dry_run:
            append_domain_event(
                "library.repair.completed",
                {
                    "task_id": task_id,
                    "summary": repair_summary,
                    "action_count": action_count,
                    "fs_changed": result.get("fs_changed"),
                    "db_changed": result.get("db_changed"),
                    "resolved_ids": resolved_ids,
                    "unsupported_checks": result.get("unsupported_checks", []),
                    "revalidated_checks": sorted(completed_revalidation_check_types),
                    "skipped_revalidation_checks": skipped_revalidation_check_types,
                    "revalidation": {
                        "issue_count": len(revalidation_result.get("issues", [])),
                        "summary": revalidation_result.get("summary", {}),
                        "duration_ms": revalidation_result.get("duration_ms"),
                    }
                    if revalidation_result is not None
                    else None,
                },
                scope="ops",
                subject_key=task_id,
            )
        if not dry_run and result.get("fs_changed"):
            start_scan()

        result["enrich_queued"] = enqueued_enrich
        result["revalidated_checks"] = sorted(completed_revalidation_check_types)
        result["skipped_revalidation_checks"] = skipped_revalidation_check_types
        result["revalidation"] = (
            {
                "issue_count": len(revalidation_result.get("issues", [])),
                "summary": revalidation_result.get("summary", {}),
                "duration_ms": revalidation_result.get("duration_ms"),
            }
            if revalidation_result is not None
            else None
        )
        result["message"] = (
            f"{repair_summary.get('applied', 0)} applied, "
            f"{repair_summary.get('skipped', 0)} skipped, "
            f"{repair_summary.get('failed', 0)} failed"
            + (
                f", {len(revalidation_result.get('issues', []))} open after revalidation"
                if revalidation_result is not None
                else ""
            )
        )
        return result
    finally:
        if not dry_run:
            for artist in affected_artists:
                _unmark_processing(artist)


def _duplicate_track_repair_issue(row: Mapping[str, Any]) -> dict:
    return {
        "check": "duplicate_tracks",
        "severity": "medium",
        "details": {
            "album_id": row["album_id"],
            "artist": row["artist"],
            "album": row["album"],
            "title": row["title"],
            "track_number": row.get("track_number"),
            "disc_number": row.get("disc_number"),
            "count": row["cnt"],
            "paths": row.get("paths", []),
            "track_ids": row.get("track_ids", []),
            "tracks": row.get("tracks", []),
            "fingerprinted_count": row.get("fingerprinted_count", 0),
            "missing_fingerprint_count": row.get("missing_fingerprint_count", 0),
        },
    }


def _handle_repair_duplicate_tracks(task_id: str, params: dict, config: dict) -> dict:
    rows = get_duplicate_tracks()
    issues = [_duplicate_track_repair_issue(row) for row in rows]
    if not issues:
        emit_task_event(
            task_id,
            "info",
            {
                "category": "repair",
                "message": "No high-confidence duplicate tracks found",
            },
        )
        return {
            "issue_count": 0,
            "summary": {"applied": 0, "skipped": 0, "failed": 0, "unsupported": 0},
        }

    repair_params = dict(params)
    repair_params.update(
        {
            "dry_run": False,
            "auto_only": True,
            "issues": issues,
        }
    )
    return _handle_repair(task_id, repair_params, config)


def _handle_library_pipeline(task_id: str, params: dict, config: dict) -> dict:
    from crate.health_check import LibraryHealthCheck
    from crate.repair import LibraryRepair
    from crate.scheduler import mark_run
    from crate.library_sync import LibrarySync

    p_pipe = TaskProgress(phase="health_check", phase_count=3)

    emit_task_event(task_id, "info", {"message": "Pipeline: running health check..."})
    emit_progress(task_id, p_pipe, force=True)
    if is_cancelled(task_id):
        return {"status": "cancelled"}

    def _pipe_hc_progress(data):
        p_pipe.done = data.get("done", p_pipe.done)
        p_pipe.total = data.get("total", p_pipe.total)
        p_pipe.item = data.get("check", p_pipe.item)
        emit_progress(task_id, p_pipe)

    checker = LibraryHealthCheck(config)
    report = checker.run(progress_callback=_pipe_hc_progress)
    set_cache("health_report", report, ttl=3600)

    if is_cancelled(task_id):
        return {"status": "cancelled"}

    emit_task_event(task_id, "info", {"message": "Pipeline: running repair..."})
    p_pipe.phase = "repair"
    p_pipe.phase_index = 1
    p_pipe.done = 0
    p_pipe.total = 0
    emit_progress(task_id, p_pipe, force=True)

    def _pipe_repair_progress(data):
        p_pipe.done = data.get("done", p_pipe.done)
        p_pipe.total = data.get("total", p_pipe.total)
        p_pipe.item = data.get("action", p_pipe.item)
        emit_progress(task_id, p_pipe)

    repairer = LibraryRepair(config)
    repair_result = repairer.repair(
        report,
        dry_run=False,
        auto_only=True,
        task_id=task_id,
        progress_callback=_pipe_repair_progress,
        global_only=True,
    )

    if is_cancelled(task_id):
        return {"status": "cancelled"}

    emit_task_event(task_id, "info", {"message": "Pipeline: running sync..."})
    p_pipe.phase = "sync"
    p_pipe.phase_index = 2
    p_pipe.done = 0
    p_pipe.total = 0
    emit_progress(task_id, p_pipe, force=True)

    def _pipe_sync_progress(data):
        p_pipe.done = data.get("done", p_pipe.done)
        p_pipe.total = data.get("total", p_pipe.total)
        p_pipe.item = data.get("artist", p_pipe.item)
        emit_progress(task_id, p_pipe)

    sync = LibrarySync(config)
    sync_result = sync.full_sync(progress_callback=_pipe_sync_progress)

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

    emit_task_event(
        task_id, "info", {"message": f"Deleted artist: {name}", "mode": mode}
    )
    log_audit(
        "delete_artist",
        "artist",
        name,
        details={"mode": mode, "folder": folder},
        task_id=task_id,
    )

    if mode == "full":
        start_scan()

    return {"deleted": name, "mode": mode}


def _handle_delete_album(task_id: str, params: dict, config: dict) -> dict:
    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    mode = params.get("mode", "db_only")
    lib = Path(config["library_path"])

    db_path = find_album_path(artist_name, album_name, _escape_like)

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
    log_audit(
        "delete_album",
        "album",
        f"{artist_name}/{album_name}",
        details={"mode": mode},
        task_id=task_id,
    )

    if mode == "full":
        start_scan()

    return {"deleted": f"{artist_name}/{album_name}", "mode": mode}


def _resolve_library_track_path(lib: Path, track_path: str) -> tuple[Path, Path] | None:
    if not track_path:
        return None
    source = Path(track_path)
    if not source.is_absolute():
        source = lib / source
    lib_root = lib.resolve()
    source_resolved = source.resolve(strict=False)
    try:
        relative_path = source_resolved.relative_to(lib_root)
    except ValueError:
        return None
    return source_resolved, relative_path


def _crate_trash_root(lib: Path) -> Path:
    return lib / ".crate-trash"


def _resolve_library_path(lib: Path, raw_path: str) -> tuple[Path, Path] | None:
    if not raw_path:
        return None
    path = Path(raw_path)
    if not path.is_absolute():
        path = lib / path
    lib_root = lib.resolve()
    resolved = path.resolve(strict=False)
    try:
        relative_path = resolved.relative_to(lib_root)
    except ValueError:
        return None
    return resolved, relative_path


def _resolve_quarantined_track_path(
    lib: Path, quarantine_path: str
) -> tuple[Path, Path] | None:
    trash_tracks = (_crate_trash_root(lib) / "tracks").resolve(strict=False)
    source = Path(quarantine_path)
    if not source.is_absolute():
        source = trash_tracks / source
    source_resolved = source.resolve(strict=False)
    try:
        relative_path = source_resolved.relative_to(trash_tracks)
    except ValueError:
        return None
    return source_resolved, relative_path


def _unique_file_path(destination: Path, task_id: str) -> Path:
    if not destination.exists():
        return destination
    suffix = task_id[:8] or "manual"
    for index in range(1, 1000):
        candidate = destination.with_name(
            f"{destination.stem}.{suffix}-{index}{destination.suffix}"
        )
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not allocate unique path for {destination}")


def _unique_quarantine_path(
    trash_root: Path, relative_path: Path, task_id: str
) -> Path:
    destination = trash_root / "tracks" / relative_path
    return _unique_file_path(destination, task_id)


def _unique_artist_sidecar_trash_path(
    trash_root: Path, relative_path: Path, task_id: str
) -> Path:
    destination = trash_root / "artist-sidecars" / relative_path
    return _unique_file_path(destination, task_id)


def _broadcast_track_library_invalidation(
    track: Mapping[str, Any] | None = None,
) -> None:
    try:
        from crate.api.cache_events import broadcast_invalidation

        scopes = ["library", "home"]
        if track and track.get("album_id"):
            scopes.append(f"album:{track['album_id']}")
        broadcast_invalidation(*scopes)
    except Exception:
        log.debug("Failed to broadcast track library invalidation", exc_info=True)


def _handle_quarantine_track(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    track = resolve_library_track_reference(
        track_id=params.get("track_id"),
        track_entity_uid=params.get("track_entity_uid"),
        track_path=params.get("track_path"),
    )
    if not track:
        return {"error": "Track not found"}

    track_path = str(track.get("path") or "")
    resolved = _resolve_library_track_path(lib, track_path)
    if resolved is None:
        return {"error": f"Track path is outside the library: {track_path}"}

    source, relative_path = resolved
    if not source.is_file():
        return {"error": f"Track file not found: {track_path}"}

    destination = _unique_quarantine_path(
        _crate_trash_root(lib), relative_path, task_id
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(destination))
    db_delete_track(track_path)

    title = track.get("title") or track.get("filename") or relative_path.name
    artist = track.get("artist") or ""
    album = track.get("album") or ""
    target_name = f"{artist}/{album}/{title}".strip("/")
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Quarantined track: {target_name}",
            "source_path": track_path,
            "quarantine_path": str(destination),
        },
    )
    log_audit(
        "quarantine_track",
        "track",
        target_name,
        details={
            "track_id": track.get("id"),
            "track_entity_uid": track.get("entity_uid"),
            "artist": artist,
            "album": album,
            "title": title,
            "source_path": track_path,
            "quarantine_path": str(destination),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )

    _broadcast_track_library_invalidation(track)
    start_scan()
    return {
        "status": "ok",
        "track_id": track.get("id"),
        "source_path": track_path,
        "quarantine_path": str(destination),
    }


def _handle_hard_delete_track(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    track = resolve_library_track_reference(
        track_id=params.get("track_id"),
        track_entity_uid=params.get("track_entity_uid"),
        track_path=params.get("track_path"),
    )
    if not track:
        return {"error": "Track not found"}

    track_path = str(track.get("path") or "")
    resolved = _resolve_library_track_path(lib, track_path)
    if resolved is None:
        return {"error": f"Track path is outside the library: {track_path}"}

    source, _relative_path = resolved
    if source.exists():
        if not source.is_file():
            return {"error": f"Track path is not a file: {track_path}"}
        source.unlink()
    db_delete_track(track_path)

    title = track.get("title") or track.get("filename") or source.name
    artist = track.get("artist") or ""
    album = track.get("album") or ""
    target_name = f"{artist}/{album}/{title}".strip("/")
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Permanently deleted track: {target_name}",
            "source_path": track_path,
        },
    )
    log_audit(
        "hard_delete_track",
        "track",
        target_name,
        details={
            "track_id": track.get("id"),
            "track_entity_uid": track.get("entity_uid"),
            "artist": artist,
            "album": album,
            "title": title,
            "source_path": track_path,
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation(track)
    start_scan()
    return {"status": "ok", "track_id": track.get("id"), "deleted_path": track_path}


def _handle_restore_track(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    quarantine_path = str(params.get("quarantine_path") or "")
    resolved = _resolve_quarantined_track_path(lib, quarantine_path)
    if resolved is None:
        return {"error": "Quarantine path is outside .crate-trash/tracks"}

    source, original_relative_path = resolved
    if not source.is_file():
        return {"error": f"Quarantined track not found: {quarantine_path}"}

    target_path = str(params.get("target_path") or "")
    if target_path:
        target_resolved = _resolve_library_path(lib, target_path)
        if target_resolved is None:
            return {"error": f"Target path is outside the library: {target_path}"}
        destination, relative_destination = target_resolved
    else:
        relative_destination = original_relative_path
        destination = lib / original_relative_path

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return {"error": f"Restore target already exists: {relative_destination}"}
    shutil.move(str(source), str(destination))
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Restored quarantined track: {relative_destination}",
            "quarantine_path": str(source),
            "target_path": str(destination),
        },
    )
    log_audit(
        "restore_quarantined_track",
        "track",
        str(relative_destination),
        details={
            "quarantine_path": str(source),
            "target_path": str(destination),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation()
    start_scan()
    return {
        "status": "ok",
        "quarantine_path": str(source),
        "target_path": str(destination),
    }


def _handle_hard_delete_quarantined_track(
    task_id: str, params: dict, config: dict
) -> dict:
    lib = Path(config["library_path"])
    quarantine_path = str(params.get("quarantine_path") or "")
    resolved = _resolve_quarantined_track_path(lib, quarantine_path)
    if resolved is None:
        return {"error": "Quarantine path is outside .crate-trash/tracks"}

    source, original_relative_path = resolved
    if not source.is_file():
        return {"error": f"Quarantined track not found: {quarantine_path}"}

    source.unlink()
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Deleted quarantined track: {original_relative_path}",
            "quarantine_path": str(source),
        },
    )
    log_audit(
        "hard_delete_quarantined_track",
        "track",
        str(original_relative_path),
        details={
            "quarantine_path": str(source),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation()
    return {
        "status": "ok",
        "quarantine_path": str(source),
        "deleted": True,
    }


def _handle_hard_delete_all_quarantined_tracks(
    task_id: str, params: dict, config: dict
) -> dict:
    lib = Path(config["library_path"])
    trash_tracks = (_crate_trash_root(lib) / "tracks").resolve(strict=False)
    if not trash_tracks.exists():
        log_audit(
            "hard_delete_all_quarantined_tracks",
            "track",
            ".crate-trash/tracks",
            details={
                "deleted": 0,
                "skipped": 0,
                "errors": [],
                "bytes_deleted": 0,
                "reason": params.get("reason"),
            },
            user_id=params.get("actor_user_id"),
            task_id=task_id,
        )
        return {
            "status": "ok",
            "deleted": 0,
            "skipped": 0,
            "errors": [],
            "bytes_deleted": 0,
        }

    candidates = [
        path
        for path in sorted(trash_tracks.rglob("*"))
        if path.suffix.lower() in DEFAULT_AUDIO_EXTENSIONS
    ]
    progress = TaskProgress(
        phase="hard_delete_quarantined_tracks",
        phase_count=1,
        total=len(candidates),
    )
    emit_progress(task_id, progress, force=True)

    deleted = 0
    skipped = 0
    bytes_deleted = 0
    errors: list[dict[str, str]] = []

    for index, path in enumerate(candidates, start=1):
        if is_cancelled(task_id):
            return {
                "error": "cancelled",
                "deleted": deleted,
                "skipped": skipped,
                "errors": errors[-20:],
                "bytes_deleted": bytes_deleted,
            }

        progress.done = index - 1
        progress.item = path.name
        try:
            relative_path = path.relative_to(trash_tracks).as_posix()
        except ValueError:
            skipped += 1
            continue

        try:
            if path.is_symlink() or not path.is_file():
                skipped += 1
                continue
            resolved = path.resolve(strict=False)
            try:
                resolved.relative_to(trash_tracks)
            except ValueError:
                skipped += 1
                continue
            size = path.stat().st_size
            path.unlink()
            deleted += 1
            bytes_deleted += size
            if deleted % 25 == 0:
                emit_task_event(
                    task_id,
                    "info",
                    {
                        "message": f"Deleted {deleted} quarantined tracks",
                        "deleted": deleted,
                        "total": len(candidates),
                    },
                )
        except OSError as exc:
            errors.append({"path": relative_path, "error": str(exc)})

        progress.done = index
        if index % 25 == 0 or index == len(candidates):
            emit_progress(task_id, progress, force=True)

    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Empty trash complete: {deleted} deleted, {skipped} skipped",
            "deleted": deleted,
            "skipped": skipped,
            "errors": len(errors),
            "bytes_deleted": bytes_deleted,
        },
    )
    log_audit(
        "hard_delete_all_quarantined_tracks",
        "track",
        ".crate-trash/tracks",
        details={
            "deleted": deleted,
            "skipped": skipped,
            "errors": errors[-20:],
            "bytes_deleted": bytes_deleted,
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation()
    return {
        "status": "ok",
        "deleted": deleted,
        "skipped": skipped,
        "errors": errors[-20:],
        "bytes_deleted": bytes_deleted,
    }


def _handle_move_track(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    track = resolve_library_track_reference(
        track_id=params.get("track_id"),
        track_entity_uid=params.get("track_entity_uid"),
        track_path=params.get("track_path"),
    )
    if not track:
        return {"error": "Track not found"}

    target_album_id = params.get("target_album_id")
    target_album = (
        get_library_album_by_id(int(target_album_id)) if target_album_id else None
    )
    if not target_album:
        return {"error": "Target album not found"}

    track_path = str(track.get("path") or "")
    source_resolved = _resolve_library_track_path(lib, track_path)
    target_album_resolved = _resolve_library_path(
        lib, str(target_album.get("path") or params.get("target_album_path") or "")
    )
    if source_resolved is None:
        return {"error": f"Track path is outside the library: {track_path}"}
    if target_album_resolved is None:
        return {"error": "Target album path is outside the library"}

    source, _source_relative = source_resolved
    target_album_dir, target_album_relative = target_album_resolved
    if not source.is_file():
        return {"error": f"Track file not found: {track_path}"}
    if not target_album_dir.is_dir():
        return {"error": f"Target album directory not found: {target_album_relative}"}

    destination = _unique_file_path(target_album_dir / source.name, task_id)
    shutil.move(str(source), str(destination))
    db_delete_track(track_path)

    title = track.get("title") or track.get("filename") or source.name
    target_name = f"{track.get('artist')}/{track.get('album')}/{title}".strip("/")
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Moved track to album: {target_album.get('artist')}/{target_album.get('name')}",
            "source_path": track_path,
            "target_path": str(destination),
        },
    )
    log_audit(
        "move_track_to_album",
        "track",
        target_name,
        details={
            "track_id": track.get("id"),
            "track_entity_uid": track.get("entity_uid"),
            "source_path": track_path,
            "target_album_id": target_album.get("id"),
            "target_album": f"{target_album.get('artist')}/{target_album.get('name')}",
            "target_path": str(destination),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation(track)
    start_scan()
    return {
        "status": "ok",
        "track_id": track.get("id"),
        "source_path": track_path,
        "target_path": str(destination),
    }


def _path_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve(strict=False).relative_to(parent.resolve(strict=False))
        return True
    except ValueError:
        return False


def _unique_directory_path(destination: Path, task_id: str) -> Path:
    if not destination.exists():
        return destination
    suffix = task_id[:8] or "manual"
    for index in range(1, 1000):
        candidate = destination.with_name(f"{destination.name}.{suffix}-{index}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not allocate unique directory path for {destination}")


def _safe_album_folder_name(name: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*]', "", name)
    sanitized = re.sub(r"\s+", " ", sanitized).strip().rstrip(". ")
    return sanitized or "Unknown"


def _move_album_children(
    source_dir: Path, target_dir: Path, task_id: str
) -> list[tuple[str, str]]:
    path_map: list[tuple[str, str]] = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for child in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        if child.is_dir():
            destination = _unique_directory_path(target_dir / child.name, task_id)
            for source_file in child.rglob("*"):
                if source_file.is_file():
                    path_map.append(
                        (
                            str(source_file),
                            str(destination / source_file.relative_to(child)),
                        )
                    )
            shutil.move(str(child), str(destination))
            continue

        destination = _unique_file_path(target_dir / child.name, task_id)
        path_map.append((str(child), str(destination)))
        shutil.move(str(child), str(destination))
    return path_map


def _handle_split_album(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    album_id = params.get("album_id")
    album = get_library_album_by_id(int(album_id)) if album_id else None
    if not album:
        return {"error": "Album not found"}

    target_album_name = str(params.get("target_album_name") or "").strip()
    if not target_album_name:
        return {"error": "Target album name is required"}
    if target_album_name.casefold() == str(album.get("name") or "").casefold():
        return {"error": "Target album name must be different from the source album"}

    track_ids = {
        int(track_id)
        for track_id in (params.get("track_ids") or [])
        if str(track_id).strip()
    }
    if not track_ids:
        return {"error": "No tracks selected"}

    source_tracks = get_library_tracks(int(album["id"]))
    selected_tracks = [
        track for track in source_tracks if int(track.get("id") or 0) in track_ids
    ]
    if len(selected_tracks) != len(track_ids):
        return {"error": "One or more selected tracks were not found on this album"}
    if len(selected_tracks) >= len(source_tracks):
        return {"error": "Cannot split every track out of the source album"}

    source_resolved = _resolve_library_path(lib, str(album.get("path") or ""))
    if source_resolved is None:
        return {"error": "Album path is outside the library"}
    source_dir, source_relative = source_resolved
    if not source_dir.is_dir():
        return {"error": f"Album directory not found: {source_relative}"}

    target_dir = source_dir.parent / _safe_album_folder_name(target_album_name)
    if target_dir.exists():
        return {"error": f"Target album directory already exists: {target_dir.name}"}

    target_dir.mkdir(parents=True, exist_ok=False)
    track_moves: list[tuple[int, str, str]] = []
    try:
        for track in selected_tracks:
            track_path = str(track.get("path") or "")
            resolved = _resolve_library_track_path(lib, track_path)
            if resolved is None:
                raise RuntimeError(f"Track path is outside the library: {track_path}")
            source, _relative_path = resolved
            if not source.is_file():
                raise RuntimeError(f"Track file not found: {track_path}")
            if not _path_inside(source, source_dir):
                raise RuntimeError(
                    f"Track is not inside the source album: {track_path}"
                )

            destination = _unique_file_path(target_dir / source.name, task_id)
            shutil.move(str(source), str(destination))
            track_moves.append((int(track["id"]), str(source), str(destination)))
    except Exception:
        for _track_id, _old_path, new_path in reversed(track_moves):
            moved = Path(new_path)
            original = Path(_old_path)
            if moved.exists() and not original.exists():
                original.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(moved), str(original))
        if target_dir.exists() and not any(target_dir.iterdir()):
            target_dir.rmdir()
        raise

    target_album_id = create_split_album_and_move_tracks(
        int(album["id"]),
        dict(album),
        target_album_name,
        str(target_dir),
        track_moves,
    )

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Split {len(track_moves)} track(s) into {target_album_name}",
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "target_album_id": target_album_id,
        },
    )
    log_audit(
        "split_album",
        "album",
        f"{album.get('artist')}/{album.get('name')}",
        details={
            "source_album_id": album.get("id"),
            "source_album_entity_uid": album.get("entity_uid"),
            "source_album": f"{album.get('artist')}/{album.get('name')}",
            "target_album_id": target_album_id,
            "target_album": f"{album.get('artist')}/{target_album_name}",
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "track_ids": sorted(track_ids),
            "moved_tracks": len(track_moves),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation({"album_id": album.get("id")})
    _broadcast_track_library_invalidation({"album_id": target_album_id})
    start_scan()
    return {
        "status": "ok",
        "source_album_id": album.get("id"),
        "target_album_id": target_album_id,
        "target_album": target_album_name,
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_tracks": len(track_moves),
    }


def _handle_merge_album(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    source_album_id = params.get("source_album_id")
    target_album_id = params.get("target_album_id")
    source_album = (
        get_library_album_by_id(int(source_album_id)) if source_album_id else None
    )
    target_album = (
        get_library_album_by_id(int(target_album_id)) if target_album_id else None
    )
    if not source_album:
        return {"error": "Source album not found"}
    if not target_album:
        return {"error": "Target album not found"}
    if int(source_album.get("id") or 0) == int(target_album.get("id") or 0):
        return {"error": "Cannot merge an album into itself"}

    source_resolved = _resolve_library_path(lib, str(source_album.get("path") or ""))
    target_resolved = _resolve_library_path(lib, str(target_album.get("path") or ""))
    if source_resolved is None:
        return {"error": "Source album path is outside the library"}
    if target_resolved is None:
        return {"error": "Target album path is outside the library"}

    source_dir, source_relative = source_resolved
    target_dir, target_relative = target_resolved
    if not source_dir.is_dir():
        return {"error": f"Source album directory not found: {source_relative}"}
    if not target_dir.is_dir():
        return {"error": f"Target album directory not found: {target_relative}"}
    if source_dir == target_dir or _path_inside(target_dir, source_dir):
        return {"error": "Invalid album merge target"}

    source_track_count = len(get_library_tracks(int(source_album["id"])))
    path_map = _move_album_children(source_dir, target_dir, task_id)
    source_dir.rmdir()
    merge_album_into_album(
        int(source_album["id"]),
        int(target_album["id"]),
        str(source_dir),
        str(target_dir),
        path_map,
        str(target_album.get("artist") or ""),
        str(target_album.get("name") or ""),
    )

    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Merged album {source_album.get('artist')}/{source_album.get('name')} "
                f"into {target_album.get('artist')}/{target_album.get('name')}"
            ),
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "moved_paths": len(path_map),
        },
    )
    log_audit(
        "merge_album",
        "album",
        f"{source_album.get('artist')}/{source_album.get('name')}",
        details={
            "source_album_id": source_album.get("id"),
            "source_album_entity_uid": source_album.get("entity_uid"),
            "source_album": f"{source_album.get('artist')}/{source_album.get('name')}",
            "target_album_id": target_album.get("id"),
            "target_album_entity_uid": target_album.get("entity_uid"),
            "target_album": f"{target_album.get('artist')}/{target_album.get('name')}",
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "moved_paths": len(path_map),
            "source_track_count": source_track_count,
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation({"album_id": source_album.get("id")})
    _broadcast_track_library_invalidation({"album_id": target_album.get("id")})
    start_scan()
    return {
        "status": "ok",
        "source_album_id": source_album.get("id"),
        "target_album_id": target_album.get("id"),
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_paths": len(path_map),
        "source_tracks": source_track_count,
    }


def _handle_move_album_to_artist(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    album_id = params.get("album_id")
    album = get_library_album_by_id(int(album_id)) if album_id else None
    if not album:
        return {"error": "Album not found"}

    target_artist_id = params.get("target_artist_id")
    target_artist = (
        get_library_artist_by_id(int(target_artist_id)) if target_artist_id else None
    )
    if not target_artist:
        return {"error": "Target artist not found"}

    target_artist_name = str(
        target_artist.get("name") or params.get("target_artist") or ""
    )
    if not target_artist_name.strip():
        return {"error": "Target artist name missing"}

    existing_target_album = get_library_album(
        target_artist_name, str(album.get("name") or "")
    )
    if existing_target_album and int(existing_target_album.get("id") or 0) != int(
        album.get("id") or 0
    ):
        return {
            "error": f"Target artist already has an album named {album.get('name')}"
        }

    source_resolved = _resolve_library_path(lib, str(album.get("path") or ""))
    if source_resolved is None:
        return {"error": "Album path is outside the library"}
    source_dir, source_relative = source_resolved
    if not source_dir.is_dir():
        return {"error": f"Album directory not found: {source_relative}"}

    target_artist_folder = str(
        target_artist.get("folder_name") or params.get("target_artist_folder") or ""
    ).strip()
    target_artist_dir = lib / (target_artist_folder or target_artist_name)
    destination = target_artist_dir / source_dir.name
    if destination.exists():
        return {"error": f"Target album directory already exists: {destination}"}

    target_artist_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_dir), str(destination))

    update_album_artist_and_path(
        int(album["id"]),
        str(source_dir),
        str(destination),
        target_artist_name,
    )

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Moved album to artist: {target_artist_name}/{album.get('name')}",
            "source_path": str(source_dir),
            "target_path": str(destination),
        },
    )
    log_audit(
        "move_album_to_artist",
        "album",
        f"{album.get('artist')}/{album.get('name')}",
        details={
            "album_id": album.get("id"),
            "album_entity_uid": album.get("entity_uid"),
            "album_name": album.get("name"),
            "source_artist": album.get("artist"),
            "target_artist_id": target_artist.get("id"),
            "target_artist": target_artist_name,
            "source_path": str(source_dir),
            "target_path": str(destination),
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation(
        {
            "album_id": album.get("id"),
            "artist": album.get("artist"),
            "album": album.get("name"),
        }
    )
    start_scan()
    return {
        "status": "ok",
        "album_id": album.get("id"),
        "source_path": str(source_dir),
        "target_path": str(destination),
        "target_artist": target_artist_name,
    }


def _handle_merge_artist(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    source_artist_id = params.get("source_artist_id")
    target_artist_id = params.get("target_artist_id")
    source_artist = (
        get_library_artist_by_id(int(source_artist_id)) if source_artist_id else None
    )
    target_artist = (
        get_library_artist_by_id(int(target_artist_id)) if target_artist_id else None
    )
    if not source_artist:
        return {"error": "Source artist not found"}
    if not target_artist:
        return {"error": "Target artist not found"}
    if int(source_artist.get("id") or 0) == int(target_artist.get("id") or 0):
        return {"error": "Cannot merge an artist into itself"}

    source_artist_name = str(source_artist.get("name") or "")
    target_artist_name = str(target_artist.get("name") or "")
    if not source_artist_name or not target_artist_name:
        return {"error": "Artist name missing"}

    source_albums = get_library_albums(source_artist_name)
    duplicate_album_names = [
        str(album.get("name") or "")
        for album in source_albums
        if get_library_album(target_artist_name, str(album.get("name") or ""))
    ]
    if duplicate_album_names:
        return {
            "error": (
                "Target artist already has album(s): "
                + ", ".join(sorted(filter(None, duplicate_album_names))[:5])
            )
        }

    source_folder = str(
        source_artist.get("folder_name")
        or params.get("source_artist_folder")
        or source_artist_name
    )
    target_folder = str(
        target_artist.get("folder_name")
        or params.get("target_artist_folder")
        or target_artist_name
    )
    source_resolved = _resolve_library_path(lib, source_folder)
    target_resolved = _resolve_library_path(lib, target_folder)
    if source_resolved is None:
        return {"error": "Source artist path is outside the library"}
    if target_resolved is None:
        return {"error": "Target artist path is outside the library"}

    source_dir, source_relative = source_resolved
    target_dir, _target_relative = target_resolved
    if not source_dir.is_dir():
        return {"error": f"Source artist directory not found: {source_relative}"}
    if source_dir == target_dir or _path_inside(target_dir, source_dir):
        return {"error": "Invalid artist merge target"}
    moved_sidecars_to_trash: list[str] = []
    for child in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        target_child = target_dir / child.name
        if not target_child.exists():
            continue
        if child.is_file() and child.name.lower() in PHOTO_NAMES:
            destination = _unique_artist_sidecar_trash_path(
                _crate_trash_root(lib),
                child.relative_to(lib),
                task_id,
            )
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(child), str(destination))
            moved_sidecars_to_trash.append(str(destination))
            continue
        if child.is_file() and target_child.is_file():
            return {"error": f"Target artist directory already has file {child.name}"}
        return {
            "error": f"Target artist directory already has {child.name}; merge duplicate albums first"
        }

    target_dir.mkdir(parents=True, exist_ok=True)
    moved_items = 0
    for child in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        shutil.move(str(child), str(target_dir / child.name))
        moved_items += 1
    source_dir.rmdir()

    source_track_count = sum(
        int(album.get("track_count") or 0) for album in source_albums
    )
    merge_artist_into_artist(
        source_artist_name,
        target_artist_name,
        str(source_dir),
        str(target_dir),
    )

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Merged artist alias {source_artist_name} into {target_artist_name}",
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "moved_items": moved_items,
            "artist_sidecars_preserved": len(moved_sidecars_to_trash),
        },
    )
    log_audit(
        "merge_artist",
        "artist",
        source_artist_name,
        details={
            "source_artist_id": source_artist.get("id"),
            "source_artist_entity_uid": source_artist.get("entity_uid"),
            "source_artist": source_artist_name,
            "target_artist_id": target_artist.get("id"),
            "target_artist_entity_uid": target_artist.get("entity_uid"),
            "target_artist": target_artist_name,
            "source_path": str(source_dir),
            "target_path": str(target_dir),
            "moved_items": moved_items,
            "artist_sidecars_preserved": len(moved_sidecars_to_trash),
            "source_albums": len(source_albums),
            "source_tracks": source_track_count,
            "reason": params.get("reason"),
        },
        user_id=params.get("actor_user_id"),
        task_id=task_id,
    )
    _broadcast_track_library_invalidation()
    start_scan()
    return {
        "status": "ok",
        "source_artist_id": source_artist.get("id"),
        "target_artist_id": target_artist.get("id"),
        "source_artist": source_artist_name,
        "target_artist": target_artist_name,
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_items": moved_items,
        "artist_sidecars_preserved": len(moved_sidecars_to_trash),
        "source_albums": len(source_albums),
        "source_tracks": source_track_count,
    }


def _handle_move_artist(task_id: str, params: dict, config: dict) -> dict:
    name = params.get("name", "")
    new_name = params.get("new_name", "")
    lib = Path(config["library_path"])

    artist = get_library_artist(name)
    if not artist:
        return {"error": f"Artist not found: {name}"}

    folder = artist.get("folder_name") or name
    old_dir = lib / folder
    new_dir = lib / new_name

    if new_dir.exists() and old_dir != new_dir:
        return {"error": f"Target artist directory already exists: {new_name}"}

    moved_directory = False
    if old_dir.is_dir() and old_dir != new_dir:
        shutil.move(str(old_dir), str(new_dir))
        moved_directory = True

    try:
        rename_artist_in_db(name, new_name, folder)
    except Exception:
        if moved_directory and new_dir.exists() and not old_dir.exists():
            try:
                shutil.move(str(new_dir), str(old_dir))
            except Exception:
                log.exception(
                    "Failed to restore artist directory after database rename failure: %s",
                    name,
                )
        raise

    try:
        import mutagen

        for audio_file in new_dir.rglob("*"):
            if (
                audio_file.is_file()
                and audio_file.suffix.lower() in DEFAULT_AUDIO_EXTENSIONS
            ):
                try:
                    mutagen_file = getattr(mutagen, "File")
                    mf = mutagen_file(audio_file, easy=True)
                    if mf is not None:
                        mf["albumartist"] = new_name
                        mf.save()
                except Exception:
                    log.warning("Failed to retag %s", audio_file)
    except Exception:
        log.warning("Retagging failed for %s", new_name, exc_info=True)

    emit_task_event(task_id, "info", {"message": f"Moved artist: {name} → {new_name}"})
    log_audit(
        "move_artist", "artist", name, details={"new_name": new_name}, task_id=task_id
    )
    start_scan()

    return {"moved": name, "new_name": new_name}


def _handle_wipe_library(task_id: str, params: dict, config: dict) -> dict:
    wipe_library_tables()
    emit_task_event(task_id, "info", {"message": "Library database wiped"})
    log_audit("wipe_library", "database", "library", task_id=task_id)

    if params.get("rebuild"):
        create_task("rebuild_library")

    return {"wiped": True, "rebuild": params.get("rebuild", False)}


def _handle_rebuild_library(task_id: str, params: dict, config: dict) -> dict:
    p_rebuild = TaskProgress(phase="wipe", phase_count=2)
    emit_progress(task_id, p_rebuild, force=True)
    wipe_library_tables()
    emit_task_event(
        task_id,
        "info",
        {"message": "Rebuild: database wiped, starting pipeline..."},
    )
    log_audit("rebuild_library_wipe", "database", "library", task_id=task_id)

    result = _handle_library_pipeline(task_id, params, config)

    log_audit(
        "rebuild_library_complete",
        "database",
        "library",
        details=result,
        task_id=task_id,
    )
    return result


def _handle_update_album_tags(task_id: str, params: dict, config: dict) -> dict:
    import mutagen
    from crate.audio import get_audio_files

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    album_fields = params.get("album_fields", {})
    track_tags = params.get("track_tags", {})
    actor_user_id = params.get("actor_user_id")
    actor_user_id = actor_user_id if isinstance(actor_user_id, int) else None

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    tracks = get_audio_files(album_dir, list(DEFAULT_AUDIO_EXTENSIONS))
    updated = 0
    errors = []
    changes = []

    for track in tracks:
        try:
            mutagen_file = getattr(mutagen, "File")
            audio = mutagen_file(track, easy=True)
            if audio is None:
                continue
            fields = set(album_fields)
            fields.update((track_tags.get(track.name) or {}).keys())
            before = {key: _tag_values(audio.get(key)) for key in sorted(fields)}
            for key, value in album_fields.items():
                audio[key] = value
            if track.name in track_tags:
                for key, value in track_tags[track.name].items():
                    audio[key] = value
            after = {key: _tag_values(audio.get(key)) for key in sorted(fields)}
            audio.save()
            updated += 1
            if before != after:
                changes.append({"file": track.name, "before": before, "after": after})
        except Exception as exc:
            errors.append({"file": track.name, "error": str(exc)})

    emit_task_event(task_id, "info", {"message": f"Updated tags: {updated} tracks"})
    log_audit(
        "manual_update_album_tags",
        "album",
        f"{artist_folder}/{album_folder}",
        details={
            "artist_folder": artist_folder,
            "album_folder": album_folder,
            "album_fields": album_fields,
            "track_tags": track_tags,
            "updated": updated,
            "errors": errors,
            "changes": changes,
            "source": "manual_edit",
        },
        user_id=actor_user_id,
        task_id=task_id,
    )
    return {"updated": updated, "errors": errors}


def _handle_update_track_tags(task_id: str, params: dict, config: dict) -> dict:
    import mutagen

    lib = Path(config["library_path"])
    filepath = params.get("filepath", "")
    tags = params.get("tags", {})
    actor_user_id = params.get("actor_user_id")
    actor_user_id = actor_user_id if isinstance(actor_user_id, int) else None

    track_path = lib / filepath
    if not track_path.is_file():
        return {"error": "Track not found"}

    try:
        mutagen_file = getattr(mutagen, "File")
        audio = mutagen_file(track_path, easy=True)
        if audio is None:
            return {"error": "Cannot read file"}
        before = {key: _tag_values(audio.get(key)) for key in sorted(tags)}
        for key, value in tags.items():
            audio[key] = value
        after = {key: _tag_values(audio.get(key)) for key in sorted(tags)}
        audio.save()
        log_audit(
            "manual_update_track_tags",
            "track",
            filepath,
            details={
                "before": before,
                "after": after,
                "changed_fields": sorted(tags),
                "source": "manual_edit",
            },
            user_id=actor_user_id,
            task_id=task_id,
        )
        return {"status": "ok", "file": track_path.name}
    except Exception as exc:
        return {"error": str(exc)}


def _handle_update_artist_metadata(task_id: str, params: dict, config: dict) -> dict:
    del config
    metadata = params.get("metadata") or {}
    if not isinstance(metadata, dict) or not metadata:
        return {"error": "No metadata fields provided"}

    actor_user_id = params.get("actor_user_id")
    actor_user_id = actor_user_id if isinstance(actor_user_id, int) else None
    result = db_update_artist_metadata(
        artist_id=params.get("artist_id"),
        artist_entity_uid=params.get("artist_entity_uid"),
        artist_name=params.get("artist_name"),
        metadata=metadata,
        locked_by_user_id=actor_user_id,
    )
    if result is None:
        return {"error": "Artist not found or no editable fields provided"}

    artist_name = str(result.get("artist_name") or params.get("artist_name") or "")
    changed_fields = list(result.get("changed_fields") or [])
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Updated artist metadata for {artist_name}: "
                f"{len(changed_fields)} field(s) changed"
            ),
            "changed_fields": changed_fields,
        },
    )
    log_audit(
        "manual_update_artist_metadata",
        "artist",
        artist_name,
        details={
            "before": result.get("before", {}),
            "after": result.get("after", {}),
            "changed_fields": changed_fields,
            "source": "manual_edit",
        },
        user_id=actor_user_id,
        task_id=task_id,
    )

    try:
        from crate.api.cache_events import (
            broadcast_invalidation,
            wait_for_cache_invalidation,
        )

        scopes = ["library", "home"]
        if "bio" in changed_fields:
            scopes.append("artist_bio")
        if result.get("artist_id"):
            scopes.append(f"artist:{result['artist_id']}")
        broadcast_invalidation(*scopes)
        wait_for_cache_invalidation()
    except Exception:
        log.debug("Failed to broadcast artist metadata invalidation", exc_info=True)

    return {
        "status": "ok",
        "artist": artist_name,
        "changed": len(changed_fields),
        "changed_fields": changed_fields,
    }


def _handle_resolve_duplicates(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    trash = _crate_trash_root(lib)
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
    album_dir = (
        Path(album_path_str) if album_path_str else lib / artist_folder / album_folder
    )
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
    emit_task_event(
        task_id,
        "info",
        {"message": f"Applied MusicBrainz tags: {updated_count} tracks"},
    )

    mbid = result.get("mbid")
    release_group_id = result.get("release_group_id")
    if mbid:
        try:
            album_db_path = str(album_dir)
            album_db_path = find_album_path_for_match(
                artist_folder, album_folder, album_db_path, _escape_like
            )

            album_id = apply_mbid_to_album(mbid, album_db_path, release_group_id)

            if album_id:
                emit_task_event(
                    task_id, "info", {"message": f"Synced MBID {mbid[:8]}... to DB"}
                )
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


def _handle_generate_system_playlist(task_id: str, params: dict, config: dict) -> dict:
    """Generate or regenerate a smart system playlist."""
    playlist_id = int(params.get("playlist_id", 0))
    triggered_by = params.get("triggered_by", "manual")

    playlist = get_playlist(playlist_id)
    if not playlist:
        return {"error": "Playlist not found"}

    rules = playlist.get("smart_rules")
    if not rules:
        return {"error": "No smart rules configured"}

    name = playlist.get("name", f"Playlist {playlist_id}")
    emit_task_event(task_id, "info", {"message": f"Generating: {name}"})

    set_generation_status(playlist_id, "running")
    log_id = log_generation_start(playlist_id, rules, triggered_by)

    try:
        tracks = execute_smart_rules(rules)
        if isinstance(tracks, int):
            tracks = []
        track_dicts = [
            {
                "track_path": t.get("path", ""),
                "track_id": t.get("id"),
                "track_entity_uid": t.get("entity_uid"),
                "track_storage_id": t.get("storage_id"),
                "title": t.get("title", ""),
                "artist": t.get("artist", ""),
                "album": t.get("album", ""),
                "duration": t.get("duration"),
            }
            for t in tracks
        ]
        target_count = int(rules.get("limit") or len(track_dicts) or 50)
        track_count = regenerate_playlist_tracks(
            playlist_id,
            track_dicts,
            target_count=target_count,
        )
        refreshed = get_playlist(playlist_id) or {}
        total_duration = refreshed.get("total_duration") or 0

        set_generation_status(playlist_id, "idle")
        log_generation_complete(log_id, track_count, total_duration)
        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Generated {name}: {track_count} tracks, {total_duration // 60}m",
            },
        )

        try:
            from crate.telegram import send_message

            send_message(
                f"\U0001f3b6 Smart Playlist <b>{name}</b> regenerated\n"
                f"{track_count} tracks \u00b7 {total_duration // 60}m\n"
                f"Triggered by: {triggered_by}"
            )
        except Exception:
            pass

        return {"track_count": track_count, "duration_sec": total_duration}

    except Exception as e:
        set_generation_status(playlist_id, "failed", str(e))
        log_generation_failed(log_id, str(e))
        emit_task_event(
            task_id,
            "error",
            {"message": f"Generation failed for {name}: {str(e)[:200]}"},
        )
        raise


def _handle_refresh_system_smart_playlists(
    task_id: str, params: dict, config: dict
) -> dict:
    """Scheduled daily refresh of eligible smart system playlists."""
    playlists = get_smart_playlists_for_refresh()
    emit_task_event(
        task_id,
        "info",
        {"message": f"Found {len(playlists)} playlists eligible for refresh"},
    )

    enqueued = 0
    for pl in playlists:
        create_task(
            "generate_system_playlist",
            {
                "playlist_id": pl["id"],
                "triggered_by": "scheduler",
            },
        )
        enqueued += 1

    emit_task_event(
        task_id, "info", {"message": f"Enqueued {enqueued} playlist generation tasks"}
    )
    return {"eligible": len(playlists), "enqueued": enqueued}


def _handle_persist_playlist_cover(task_id: str, params: dict, config: dict) -> dict:
    """Read cover base64 from Redis and write to disk."""
    playlist_id = int(params.get("playlist_id", 0))
    redis_key = f"cover:staging:{playlist_id}"

    r = get_redis()
    if not r:
        return {"error": "Redis unavailable"}

    raw = r.get(redis_key)
    if not raw:
        return {"error": "Cover data expired or missing from Redis"}

    cover_data_url = raw.decode() if isinstance(raw, bytes) else raw
    if not cover_data_url.startswith("data:image/"):
        cover_data_url = f"data:image/jpeg;base64,{cover_data_url.split(',', 1)[-1]}"

    from crate.playlist_covers import delete_playlist_cover, persist_playlist_cover_data

    playlist = get_playlist(playlist_id)
    existing_cover_path = playlist.get("cover_path") if playlist else None
    filename = persist_playlist_cover_data(playlist_id, cover_data_url)
    if existing_cover_path and existing_cover_path != filename:
        delete_playlist_cover(existing_cover_path)
    r.delete(redis_key)

    # Store the relative filename, not the absolute path — playlist_cover_abspath() resolves it
    update_playlist(playlist_id, cover_path=filename, cover_data_url=None)
    emit_task_event(
        task_id, "info", {"message": f"Cover saved for playlist {playlist_id}"}
    )
    return {"cover_path": filename}


def _handle_write_portable_metadata(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.queries.portable_metadata import (
        get_portable_album_payload,
        list_portable_album_ids,
    )
    from crate.db.repositories.portable_metadata import mark_album_portable_metadata
    from crate.portable_metadata import write_album_portable_metadata

    album_id = params.get("album_id")
    album_entity_uid = params.get("album_entity_uid")
    artist = params.get("artist")
    limit = params.get("limit")
    write_audio_tags = bool(params.get("write_audio_tags", True))
    write_sidecars = bool(params.get("write_sidecars", True))

    album_ids = list_portable_album_ids(
        album_id=album_id,
        album_entity_uid=str(album_entity_uid) if album_entity_uid else None,
        artist=artist,
        limit=limit,
    )
    progress = TaskProgress(
        phase="portable_metadata", phase_count=1, total=len(album_ids)
    )
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Writing portable metadata for {len(album_ids)} albums",
            "write_audio_tags": write_audio_tags,
            "write_sidecars": write_sidecars,
        },
    )

    results: list[dict] = []
    missing = 0
    tag_errors = 0
    for index, current_album_id in enumerate(album_ids, start=1):
        if is_cancelled(task_id):
            emit_task_event(
                task_id, "warning", {"message": "Portable metadata task cancelled"}
            )
            break

        payload = get_portable_album_payload(current_album_id)
        if not payload:
            missing += 1
            progress.warnings += 1
            progress.done = index
            progress.item = f"album:{current_album_id}"
            emit_progress(task_id, progress)
            continue

        album = payload.get("album") or {}
        progress.item = f"{album.get('artist', '')} - {album.get('name', '')}".strip(
            " -"
        )
        try:
            result = write_album_portable_metadata(
                payload,
                write_audio_tags=write_audio_tags,
                write_sidecars=write_sidecars,
            )
            mark_album_portable_metadata(
                album_id=result.get("album_id"),
                album_entity_uid=result.get("album_entity_uid"),
                sidecar_path=result.get("sidecar_path"),
                tracks=result.get("tracks") or 0,
                tags_written=result.get("tags_written") or 0,
                tag_errors=len(result.get("tag_errors") or []),
                wrote_sidecar=write_sidecars and bool(result.get("sidecar_path")),
                wrote_audio_tags=write_audio_tags,
            )
        except Exception as exc:
            progress.errors += 1
            result = {
                "album_id": current_album_id,
                "error": str(exc)[:500],
            }
            emit_task_event(
                task_id,
                "error",
                {
                    "message": f"Failed to write portable metadata for album {current_album_id}: {exc}"
                },
            )

        tag_errors += len(result.get("tag_errors") or [])
        if result.get("tag_errors"):
            progress.warnings += len(result["tag_errors"])
        results.append(result)
        progress.done = index
        emit_progress(task_id, progress)

    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": "Portable metadata write complete",
            "albums": len(results),
            "missing": missing,
            "tag_errors": tag_errors,
        },
    )
    return {
        "albums": len(results),
        "missing": missing,
        "tag_errors": tag_errors,
        "results": results[-20:],
    }


def _handle_rehydrate_portable_metadata(
    task_id: str, params: dict, config: dict
) -> dict:
    from crate.db.repositories.portable_metadata import rehydrate_album_payload
    from crate.portable_metadata import iter_album_sidecars, load_album_sidecar

    root_path = params.get("root_path") or config.get("library_path")
    if not root_path:
        return {"error": "Library path not configured"}
    limit = params.get("limit")
    safe_limit = int(limit) if limit is not None else None
    sidecars = iter_album_sidecars(str(root_path), limit=safe_limit)
    progress = TaskProgress(
        phase="rehydrate_portable_metadata", phase_count=1, total=len(sidecars)
    )
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Rehydrating {len(sidecars)} portable metadata sidecars",
            "root_path": str(root_path),
        },
    )

    restored = 0
    features = 0
    lyrics = 0
    errors: list[dict] = []
    for index, sidecar_path in enumerate(sidecars, start=1):
        if is_cancelled(task_id):
            emit_task_event(
                task_id,
                "warning",
                {"message": "Portable metadata rehydrate task cancelled"},
            )
            break
        progress.item = str(sidecar_path)
        try:
            payload = load_album_sidecar(sidecar_path)
            result = rehydrate_album_payload(payload)
            restored += 1
            features += int(result.get("features") or 0)
            lyrics += int(result.get("lyrics") or 0)
        except Exception as exc:
            progress.errors += 1
            errors.append({"sidecar": str(sidecar_path), "error": str(exc)[:500]})
            emit_task_event(
                task_id,
                "error",
                {"message": f"Failed to rehydrate {sidecar_path}: {exc}"},
            )
        progress.done = index
        emit_progress(task_id, progress)

    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": "Portable metadata rehydrate complete",
            "albums": restored,
            "features": features,
            "lyrics": lyrics,
            "errors": len(errors),
        },
    )
    return {
        "albums": restored,
        "features": features,
        "lyrics": lyrics,
        "errors": errors[-20:],
    }


def _handle_export_rich_metadata(task_id: str, params: dict, config: dict) -> dict:
    from datetime import datetime

    from crate.db.queries.portable_metadata import (
        get_portable_album_payload,
        list_portable_album_ids,
    )
    from crate.db.repositories.portable_metadata import mark_album_rich_export
    from crate.portable_metadata import export_album_rich_metadata

    album_id = params.get("album_id")
    album_entity_uid = params.get("album_entity_uid")
    artist = params.get("artist")
    limit = params.get("limit")
    include_audio = bool(params.get("include_audio", False))
    write_rich_tags = bool(params.get("write_rich_tags", True))
    default_root = (
        Path(config.get("data_path") or "/data")
        / "portable-exports"
        / datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    )
    export_root = Path(str(params.get("export_root") or default_root))

    album_ids = list_portable_album_ids(
        album_id=album_id,
        album_entity_uid=str(album_entity_uid) if album_entity_uid else None,
        artist=artist,
        limit=limit,
    )
    progress = TaskProgress(
        phase="export_rich_metadata", phase_count=1, total=len(album_ids)
    )
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Exporting rich metadata for {len(album_ids)} albums",
            "export_root": str(export_root),
            "include_audio": include_audio,
            "write_rich_tags": write_rich_tags,
        },
    )

    exported = 0
    tracks = 0
    tag_errors = 0
    errors: list[dict] = []
    results: list[dict] = []
    for index, current_album_id in enumerate(album_ids, start=1):
        if is_cancelled(task_id):
            emit_task_event(
                task_id, "warning", {"message": "Rich metadata export task cancelled"}
            )
            break

        payload = get_portable_album_payload(current_album_id)
        if not payload:
            progress.warnings += 1
            errors.append({"album_id": current_album_id, "error": "album not found"})
            progress.done = index
            emit_progress(task_id, progress)
            continue

        album = payload.get("album") or {}
        progress.item = f"{album.get('artist', '')} - {album.get('name', '')}".strip(
            " -"
        )
        try:
            result = export_album_rich_metadata(
                payload,
                export_root=export_root,
                include_audio=include_audio,
                write_rich_tags=write_rich_tags,
            )
            mark_album_rich_export(
                album_id=result.get("album_id"),
                album_entity_uid=result.get("album_entity_uid"),
                export_path=result.get("export_path"),
                tracks=result.get("tracks") or 0,
            )
            exported += 1
            tracks += int(result.get("tracks") or 0)
            tag_errors += len(result.get("tag_errors") or [])
            if result.get("tag_errors"):
                progress.warnings += len(result["tag_errors"])
            results.append(result)
        except Exception as exc:
            progress.errors += 1
            errors.append({"album_id": current_album_id, "error": str(exc)[:500]})
            emit_task_event(
                task_id,
                "error",
                {
                    "message": f"Failed to export rich metadata for album {current_album_id}: {exc}"
                },
            )
        progress.done = index
        emit_progress(task_id, progress)

    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": "Rich metadata export complete",
            "albums": exported,
            "tracks": tracks,
            "tag_errors": tag_errors,
            "export_root": str(export_root),
        },
    )
    return {
        "albums": exported,
        "tracks": tracks,
        "tag_errors": tag_errors,
        "export_root": str(export_root),
        "errors": errors[-20:],
        "results": results[-20:],
    }


def _handle_draft_i18n_translation(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.queries.i18n import get_latest_reviewable_translation_bundle
    from crate.db.repositories.i18n import (
        insert_translation_bundle_draft,
        update_translation_request_status,
    )
    from crate.llm.prompts.i18n_translation import (
        generate_i18n_translation_draft,
        load_listen_source_messages,
        validate_i18n_translation_draft,
    )

    app = str(params.get("app") or "listen").strip().lower()
    locale = str(params.get("locale") or "").strip().lower()
    source_version = str(params.get("source_version") or "").strip()
    if app != "listen":
        raise ValueError(f"unsupported i18n app: {app}")
    if not locale:
        raise ValueError("locale is required")
    if not source_version:
        raise ValueError("source_version is required")

    source_messages = load_listen_source_messages()
    requested_keys = [
        str(key).strip() for key in params.get("keys", []) if str(key).strip()
    ]
    if requested_keys:
        missing_source_keys = sorted(set(requested_keys) - set(source_messages))
        if missing_source_keys:
            raise ValueError(f"unknown source keys: {missing_source_keys}")
        source_messages = {key: source_messages[key] for key in requested_keys}

    base_messages: dict[str, str] = {}
    if requested_keys:
        latest = get_latest_reviewable_translation_bundle(
            app=app,
            locale=locale,
            source_version=source_version,
        )
        base_messages = dict((latest or {}).get("messages_json") or {})

    try:
        draft = generate_i18n_translation_draft(
            target_locale=locale,
            source_messages=source_messages,
        )
        translations = validate_i18n_translation_draft(
            draft,
            expected_keys=set(source_messages),
            target_locale=locale,
        )
    except Exception as exc:
        update_translation_request_status(
            app=app,
            locale=locale,
            source_version=source_version,
            status="manual_required",
            task_id=task_id,
        )
        emit_task_event(
            task_id,
            "warning",
            {
                "message": "Listen translation draft requires manual translation",
                "locale": locale,
                "error": str(exc)[:500],
            },
        )
        return {
            "status": "manual_required",
            "locale": locale,
            "source_version": source_version,
            "reason": str(exc)[:500],
        }

    bundle = insert_translation_bundle_draft(
        app=app,
        locale=locale,
        source_locale="en",
        source_version=source_version,
        messages={**base_messages, **translations},
    )
    update_translation_request_status(
        app=app,
        locale=locale,
        source_version=source_version,
        status="needs_review",
        task_id=task_id,
    )
    emit_task_event(
        task_id,
        "info",
        {
            "message": "Listen translation draft created",
            "locale": locale,
            "message_count": len(translations),
            "bundle_id": str(bundle["id"]),
        },
    )
    return {
        "status": "needs_review",
        "locale": locale,
        "source_version": source_version,
        "bundle_id": str(bundle["id"]),
        "message_count": len(bundle["messages_json"]),
    }


MANAGEMENT_TASK_HANDLERS: dict[str, TaskHandler] = {
    "health_check": _handle_health_check,
    "repair": _handle_repair,
    "repair_duplicate_tracks": _handle_repair_duplicate_tracks,
    "library_pipeline": _handle_library_pipeline,
    "delete_artist": _handle_delete_artist,
    "delete_album": _handle_delete_album,
    "library_track_quarantine": _handle_quarantine_track,
    "library_track_restore": _handle_restore_track,
    "library_track_hard_delete": _handle_hard_delete_track,
    "library_quarantined_track_hard_delete": _handle_hard_delete_quarantined_track,
    "library_quarantined_tracks_hard_delete_all": (
        _handle_hard_delete_all_quarantined_tracks
    ),
    "library_track_move": _handle_move_track,
    "library_album_move_to_artist": _handle_move_album_to_artist,
    "library_album_merge": _handle_merge_album,
    "library_album_split": _handle_split_album,
    "library_artist_merge": _handle_merge_artist,
    "move_artist": _handle_move_artist,
    "wipe_library": _handle_wipe_library,
    "rebuild_library": _handle_rebuild_library,
    "match_apply": _handle_match_apply,
    "update_artist_metadata": _handle_update_artist_metadata,
    "update_album_tags": _handle_update_album_tags,
    "update_track_tags": _handle_update_track_tags,
    "resolve_duplicates": _handle_resolve_duplicates,
    "generate_system_playlist": _handle_generate_system_playlist,
    "refresh_system_smart_playlists": _handle_refresh_system_smart_playlists,
    "persist_playlist_cover": _handle_persist_playlist_cover,
    "draft_i18n_translation": _handle_draft_i18n_translation,
    "write_portable_metadata": _handle_write_portable_metadata,
    "rehydrate_portable_metadata": _handle_rehydrate_portable_metadata,
    "export_rich_metadata": _handle_export_rich_metadata,
}
