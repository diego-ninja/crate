import json
import logging
import time
from pathlib import Path
from typing import Callable

from crate.db import create_task, emit_task_event, get_task, save_scan_result, update_task
from crate.library_sync import LibrarySync
from crate.matcher import apply_match, match_album
from crate.report import save_report
from crate.scanner import LibraryScanner

log = logging.getLogger(__name__)

TaskHandler = Callable[[str, dict, dict], dict]
DEFAULT_AUDIO_EXTENSIONS = [".flac", ".mp3", ".m4a", ".ogg", ".opus"]


def _is_cancelled(task_id: str) -> bool:
    try:
        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


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
    last_write = 0.0

    def _progress_callback(data: dict):
        nonlocal current_scanner_index, last_write

        scanner_name = data["scanner"]
        if scanner_name in scanner_names:
            scanner_index = scanner_names.index(scanner_name)
            if scanner_index > current_scanner_index:
                current_scanner_index = scanner_index

        progress = json.dumps(
            {
                "scanner": scanner_name,
                "artist": data.get("artist", ""),
                "artists_done": data.get("artists_done", 0),
                "artists_total": data.get("artists_total", 0),
                "issues_found": total_issues + data.get("issues_found", 0),
                "issues_by_type": issues_by_type,
                "scanners_done": scanners_done,
                "scanners_total": len(scanner_names),
                "current_scanner_index": current_scanner_index,
            }
        )

        now = time.monotonic()
        if now - last_write >= 1.0:
            update_task(task_id, progress=progress)
            last_write = now

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

    for index, item in enumerate(albums):
        if _is_cancelled(task_id):
            break
        artist = item.get("artist")
        album_name = item.get("album")
        update_task(task_id, progress=f"Retagging {index+1}/{len(albums)}: {artist}/{album_name}")

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

    return {"results": results}


def _handle_library_sync(task_id: str, params: dict, config: dict) -> dict:
    sync = LibrarySync(config)
    emit_task_event(task_id, "info", {"message": "Starting library sync..."})
    return sync.full_sync(progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)))


def _handle_fix_issues(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import get_latest_scan
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

    update_task(task_id, progress=json.dumps({"phase": "fixing", "total": len(issue_objs)}))
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
