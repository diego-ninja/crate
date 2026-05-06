import logging
import time
from pathlib import Path

from crate.db.events import emit_task_event
from crate.db.queries.tasks import get_latest_scan, get_task
from crate.db.repositories.tasks import create_task, save_scan_result
from crate.task_progress import TaskProgress, emit_item_event, emit_progress, entity_label
from crate.library_sync import LibrarySync
from crate.matcher import apply_match, match_album
from crate.report import save_report
from crate.scanner import LibraryScanner
from crate.worker_handlers import DEFAULT_AUDIO_EXTENSIONS, TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _handle_scan(task_id: str, params: dict, config: dict) -> dict:
    from crate.scanner import SCANNER_ORDER

    only = params.get("only")

    if only:
        scanner_names = [only]
    else:
        scanner_names = [name for name, _scanner in SCANNER_ORDER]

    scanners_done: list[str] = []
    issues_by_type: dict[str, int] = {
        "nested_library": 0,
        "duplicate_album": 0,
        "bad_naming": 0,
        "mergeable_album": 0,
        "incomplete_album": 0,
    }
    total_issues = 0
    current_scanner_index = 0

    p = TaskProgress(phase="scanning", phase_count=len(scanner_names))

    def _progress_callback(data: dict):
        nonlocal current_scanner_index

        scanner_name = data["scanner"]
        if scanner_name in scanner_names:
            scanner_index = scanner_names.index(scanner_name)
            if scanner_index > current_scanner_index:
                current_scanner_index = scanner_index

        p.phase = scanner_name
        p.phase_index = current_scanner_index
        p.done = data.get("artists_done", p.done)
        p.total = data.get("artists_total", p.total)
        p.item = entity_label(artist=data.get("artist", ""))
        emit_progress(task_id, p)

    def _scanner_done_callback(name: str, found_issues):
        nonlocal total_issues
        scanners_done.append(name)
        for issue in found_issues:
            key = issue.type.value
            if key in issues_by_type:
                issues_by_type[key] += 1
            total_issues += 1

    emit_task_event(task_id, "info", {"message": "Starting library scan..."})
    scanner = LibraryScanner(
        config,
        progress_callback=_progress_callback,
        scanner_done_callback=_scanner_done_callback,
    )
    issues = scanner.scan(only=only)

    save_report(issues, config)

    issues_dicts = [
        {
            "type": issue.type.value,
            "severity": issue.severity.value,
            "confidence": issue.confidence,
            "description": issue.description,
            "suggestion": issue.suggestion,
            "paths": [str(path) for path in issue.paths],
            "details": issue.details,
        }
        for issue in issues
    ]
    save_scan_result(task_id, issues_dicts)

    create_task("compute_analytics")
    return {"issue_count": len(issues)}


def _handle_batch_retag(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", DEFAULT_AUDIO_EXTENSIONS))
    albums = params.get("albums", [])
    results = []

    p = TaskProgress(phase="retagging", phase_count=1, total=len(albums))

    for index, item in enumerate(albums):
        if is_cancelled(task_id):
            break
        artist = item.get("artist")
        album_name = item.get("album")
        p.done = index + 1
        p.item = entity_label(artist=artist or "", album=album_name or "")
        emit_progress(task_id, p)

        album_dir = lib / artist / album_name
        if not album_dir.is_dir():
            results.append({"artist": artist, "album": album_name, "error": "Not found"})
            continue

        candidates = match_album(album_dir, exts)
        if not candidates:
            results.append({"artist": artist, "album": album_name, "error": "No MB match"})
            continue

        best = candidates[0]
        if best["match_score"] < 60:
            results.append(
                {"artist": artist, "album": album_name, "error": f"Low score: {best['match_score']}"}
            )
            continue

        result = apply_match(album_dir, exts, best)
        result["artist"] = artist
        result["album"] = album_name
        result["match_score"] = best["match_score"]
        results.append(result)

    retagged = sum(1 for r in results if "error" not in r)
    emit_task_event(task_id, "info", {"message": f"Batch retag complete: {retagged}/{len(albums)} albums retagged"})
    return {"results": results}


def _handle_library_sync(task_id: str, params: dict, config: dict) -> dict:
    sync_config = dict(config)
    if "native_scan_payload_shadow" in params:
        sync_config["native_scan_payload_shadow"] = params.get("native_scan_payload_shadow")
    if "native_scan_payload_prefer" in params:
        sync_config["native_scan_payload_prefer"] = params.get("native_scan_payload_prefer")
    if "native_scan_payload_source" in params:
        sync_config["native_scan_payload_source"] = params.get("native_scan_payload_source")
    if "native_scan_diff_shadow" in params:
        sync_config["native_scan_diff_shadow"] = params.get("native_scan_diff_shadow")
    if "native_scan_diff_skip_unchanged" in params:
        sync_config["native_scan_diff_skip_unchanged"] = params.get("native_scan_diff_skip_unchanged")
    if "native_scan_diff_source" in params:
        sync_config["native_scan_diff_source"] = params.get("native_scan_diff_source")
    if "native_scan_snapshot_dir" in params:
        sync_config["native_scan_snapshot_dir"] = params.get("native_scan_snapshot_dir")
    sync = LibrarySync(sync_config)

    def _emit_native_shadow(root: Path) -> dict | None:
        from crate.native_scan import (
            diff_skip_unchanged_enabled,
            maybe_compare_native_scan_file_set,
            maybe_update_native_scan_diff_snapshot,
            native_scan_diff_is_unchanged,
        )

        shadow_config = dict(sync_config)
        if "native_scan_shadow" in params:
            shadow_config["native_scan_shadow"] = params.get("native_scan_shadow")
        file_set_summary = maybe_compare_native_scan_file_set(root, sync.extensions, shadow_config)
        diff_summary = maybe_update_native_scan_diff_snapshot(root, sync.extensions, shadow_config)
        if file_set_summary:
            emit_task_event(
                task_id,
                "info",
                {
                    "message": "Native scan shadow complete",
                    "native_scan_shadow": file_set_summary,
                },
            )
        if diff_summary:
            emit_task_event(
                task_id,
                "info",
                {
                    "message": "Native scan diff shadow complete",
                    "native_scan_diff_shadow": diff_summary,
                },
            )
        if not file_set_summary and not diff_summary:
            return None
        return {
            "file_set": file_set_summary,
            "diff": diff_summary,
            "skip_unchanged": diff_skip_unchanged_enabled(shadow_config)
            and native_scan_diff_is_unchanged(diff_summary),
        }

    album_dir_param = params.get("album_dir")
    if album_dir_param:
        album_dir = Path(str(album_dir_param))
        try:
            album_dir.resolve().relative_to(sync.library_path.resolve())
        except ValueError:
            return {"error": f"Album path is outside the configured library: {album_dir}"}
        if not album_dir.exists():
            return {"mode": "album", "album_dir": str(album_dir), "skipped": "missing"}

        artist_hint = str(params.get("artist") or album_dir.parent.name)
        artist_dir = album_dir.parent
        canonical = sync._canonical_artist_name(artist_dir, artist_hint)
        emit_task_event(
            task_id,
            "info",
            {"message": "Starting scoped library sync", "artist": canonical, "album": album_dir.name},
        )
        native_shadow = _emit_native_shadow(album_dir)
        if native_shadow and native_shadow.get("skip_unchanged"):
            emit_task_event(
                task_id,
                "info",
                {
                    "message": "Scoped library sync skipped by native scan diff",
                    "artist": canonical,
                    "album": album_dir.name,
                    "native_scan_diff_shadow": native_shadow.get("diff"),
                },
            )
            return {
                "mode": "album",
                "artist": canonical,
                "album": album_dir.name,
                "skipped": "native_scan_diff_unchanged",
                "album_result": {},
                "artist_tracks": None,
                "process_task_id": None,
                "native_scan_shadow": native_shadow.get("file_set"),
                "native_scan_diff_shadow": native_shadow.get("diff"),
            }

        album_result = sync.sync_album(album_dir, canonical) if album_dir.is_dir() else {}
        artist_tracks = sync.sync_artist(artist_dir)

        process_task_id = None
        if params.get("is_new_file"):
            try:
                from crate.content import queue_process_new_content_if_needed

                process_task_id = queue_process_new_content_if_needed(
                    canonical,
                    library_path=sync.library_path,
                    triggered_by="scoped_library_sync",
                )
                if process_task_id:
                    emit_task_event(
                        task_id,
                        "info",
                        {
                            "message": "Queued process_new_content after scoped sync",
                            "artist": canonical,
                            "process_task_id": process_task_id,
                        },
                    )
            except Exception:
                log.debug("Failed to queue process_new_content after scoped sync", exc_info=True)

        return {
            "mode": "album",
            "artist": canonical,
            "album": album_dir.name,
            "album_result": album_result,
            "artist_tracks": artist_tracks,
            "process_task_id": process_task_id,
            "native_scan_shadow": (native_shadow or {}).get("file_set"),
            "native_scan_diff_shadow": (native_shadow or {}).get("diff"),
        }

    emit_task_event(task_id, "info", {"message": "Starting library sync..."})
    native_shadow = _emit_native_shadow(sync.library_path)
    if native_shadow and native_shadow.get("skip_unchanged"):
        emit_task_event(
            task_id,
            "info",
            {
                "message": "Library sync skipped by native scan diff",
                "native_scan_diff_shadow": native_shadow.get("diff"),
            },
        )
        return {
            "skipped": "native_scan_diff_unchanged",
            "native_scan_shadow": native_shadow.get("file_set"),
            "native_scan_diff_shadow": native_shadow.get("diff"),
        }

    p = TaskProgress(phase="syncing", phase_count=1)

    def _sync_progress(data):
        p.done = data.get("done", p.done)
        p.total = data.get("total", p.total)
        p.item = data.get("artist", p.item)
        emit_progress(task_id, p)

    result = sync.full_sync(progress_callback=_sync_progress)
    if native_shadow:
        result["native_scan_shadow"] = native_shadow.get("file_set")
        result["native_scan_diff_shadow"] = native_shadow.get("diff")
    return result


def _handle_fix_issues(task_id: str, params: dict, config: dict) -> dict:
    from crate.fixer import LibraryFixer
    from crate.models import Issue, IssueType, Severity

    latest = get_latest_scan()
    if not latest or not latest["issues"]:
        return {"error": "No issues to fix"}

    threshold = params.get("threshold", config.get("confidence_threshold", 90))
    issues = latest["issues"]
    issue_objs = []
    for issue in issues:
        issue_objs.append(
            Issue(
                type=IssueType(issue["type"]),
                severity=Severity(issue["severity"]),
                confidence=issue["confidence"],
                description=issue["description"],
                paths=[Path(path) for path in issue["paths"]],
                suggestion=issue["suggestion"],
                details=issue.get("details", {}),
            )
        )

    p = TaskProgress(phase="fixing", phase_count=1, total=len(issue_objs))
    emit_progress(task_id, p, force=True)
    fixer = LibraryFixer(config)
    emit_task_event(task_id, "info", {"message": f"Fixing {len(issue_objs)} issues..."})
    fixer.fix(issue_objs, dry_run=False)

    auto = sum(1 for issue in issue_objs if issue.confidence >= threshold)
    return {"fixed": auto, "total": len(issue_objs)}


LIBRARY_TASK_HANDLERS: dict[str, TaskHandler] = {
    "scan": _handle_scan,
    "fix_issues": _handle_fix_issues,
    "batch_retag": _handle_batch_retag,
    "library_sync": _handle_library_sync,
}
