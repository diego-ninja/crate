import json
import logging
import shutil
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from musicdock.config import load_config
from musicdock.db import init_db, claim_next_task, update_task, save_scan_result, create_task, set_cache, get_cache, list_tasks, get_task, get_setting, get_db_ctx, emit_task_event
from musicdock.importer import ImportQueue
from musicdock.scanner import LibraryScanner
from musicdock.report import save_report
from musicdock.artwork import scan_missing_covers, fetch_cover_from_caa, save_cover
from musicdock.matcher import match_album, apply_match
from musicdock.audio import get_audio_files
from musicdock.lastfm import get_artist_info, get_best_artist_image
from musicdock.library_sync import LibrarySync
from musicdock.library_watcher import LibraryWatcher

log = logging.getLogger(__name__)

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    log.info("Received signal %d, shutting down gracefully...", signum)
    _shutdown = True


def _is_cancelled(task_id: str) -> bool:
    task = get_task(task_id)
    return task is not None and task.get("status") == "cancelled"


MAX_WORKERS = 5
CLAIM_RETRY_INTERVAL = 0.5  # seconds between task claim retries
IDLE_POLL_INTERVAL = 1.0    # seconds between idle polls
SCHEDULE_CHECK_INTERVAL = 60  # seconds between scheduler checks
IMPORT_CHECK_INTERVAL = 60   # seconds between import queue checks

_active_tasks: set[str] = set()
_watcher = None  # LibraryWatcher ref for processing lock

# Tasks that do heavy DB writes — only one at a time
DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids"}
_db_heavy_running = False
_db_heavy_lock = __import__("threading").Lock()


def _run_task(task: dict, config: dict):
    global _db_heavy_running
    task_id = task["id"]
    task_type = task["type"]
    params = task.get("params", {})
    is_db_heavy = task_type in DB_HEAVY_TASKS

    if is_db_heavy:
        with _db_heavy_lock:
            if _db_heavy_running:
                # Re-queue: another DB-heavy task is running
                update_task(task_id, status="pending", progress="Waiting for DB-heavy task to finish")
                return
            _db_heavy_running = True

    _active_tasks.add(task_id)
    log.info("Processing task %s (type=%s)", task_id, task_type)

    try:
        handler = TASK_HANDLERS.get(task_type)
        if not handler:
            update_task(task_id, status="failed", error=f"Unknown task type: {task_type}")
            return

        result = handler(task_id, params, config)
        if _is_cancelled(task_id):
            log.info("Task %s was cancelled", task_id)
        else:
            update_task(task_id, status="completed", result=result or {})
            log.info("Task %s completed", task_id)

    except Exception as e:
        log.exception("Task %s failed", task_id)
        update_task(task_id, status="failed", error=str(e))
    finally:
        _active_tasks.discard(task_id)
        if is_db_heavy:
            with _db_heavy_lock:
                _db_heavy_running = False


def run_worker(config: dict):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    init_db()

    # Clean up orphaned tasks from previous worker crash/restart
    orphaned = list_tasks(status="running")
    for t in orphaned:
        log.warning("Resetting orphaned task %s (type=%s) to pending", t["id"], t["type"])
        update_task(t["id"], status="pending", progress="")

    # Start filesystem watcher (non-blocking)
    try:
        global _watcher
        sync = LibrarySync(config)
        _watcher = LibraryWatcher(config, sync)
        _watcher.start()
        log.info("Filesystem watcher started")
    except Exception:
        log.exception("Library watcher failed to start")

    # Initial library sync if needed
    from musicdock.scheduler import check_and_create_scheduled_tasks, mark_run
    check_and_create_scheduled_tasks()

    log.info("Worker started with %d slots, polling for tasks...", MAX_WORKERS)

    _last_schedule_check = time.time()
    _last_import_check = 0
    executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

    try:
        while not _shutdown:
            # Periodic import queue check every 60s
            if time.time() - _last_import_check > IMPORT_CHECK_INTERVAL:
                _last_import_check = time.time()
                try:
                    queue = ImportQueue(load_config())
                    count = len(queue.scan_pending())
                    set_cache("imports_pending", {"count": count})
                except Exception:
                    pass

            # Check scheduled tasks every 60s
            if time.time() - _last_schedule_check > SCHEDULE_CHECK_INTERVAL:
                _last_schedule_check = time.time()
                try:
                    check_and_create_scheduled_tasks()
                except Exception:
                    log.debug("Schedule check failed")

            # Read dynamic slot count from settings
            current_max = int(get_setting("max_workers", str(MAX_WORKERS)) or MAX_WORKERS)

            # Only claim if we have free slots
            if len(_active_tasks) >= current_max:
                time.sleep(CLAIM_RETRY_INTERVAL)
                continue

            task = claim_next_task()
            if not task:
                time.sleep(IDLE_POLL_INTERVAL)
                continue

            executor.submit(_run_task, task, config)

    finally:
        log.info("Worker shutting down, waiting for active tasks...")
        executor.shutdown(wait=True)
        log.info("Worker shut down")


# ── Task handlers ─────────────────────────────────────────────────

def _handle_scan(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.scanner import SCANNER_ORDER

    only = params.get("only")

    if only:
        scanner_names = [only]
    else:
        scanner_names = [name for name, _ in SCANNER_ORDER]

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

        # Track which scanner we're on
        if scanner_name in scanner_names:
            idx = scanner_names.index(scanner_name)
            if idx > current_scanner_index:
                current_scanner_index = idx

        progress = json.dumps({
            "scanner": scanner_name,
            "artist": data.get("artist", ""),
            "artists_done": data.get("artists_done", 0),
            "artists_total": data.get("artists_total", 0),
            "issues_found": total_issues + data.get("issues_found", 0),
            "issues_by_type": issues_by_type,
            "scanners_done": scanners_done,
            "scanners_total": len(scanner_names),
            "current_scanner_index": current_scanner_index,
        })

        # Throttle writes: max 1/sec
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
            "type": i.type.value,
            "severity": i.severity.value,
            "confidence": i.confidence,
            "description": i.description,
            "suggestion": i.suggestion,
            "paths": [str(p) for p in i.paths],
            "details": i.details,
        }
        for i in issues
    ]
    save_scan_result(task_id, issues_dicts)

    # Trigger analytics pre-computation after scan
    create_task("compute_analytics")

    return {"issue_count": len(issues)}


def _handle_fetch_artwork_all(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    missing = scan_missing_covers(lib, exts)

    fetched = 0
    failed = 0
    total = len(missing)

    for i, album in enumerate(missing):
        if _shutdown:
            break
        mbid = album.get("mbid")
        if not mbid:
            continue
        update_task(task_id, progress=f"Fetching {i+1}/{total}...")
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    return {"fetched": fetched, "failed": failed, "total": total}


def _handle_batch_retag(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    albums = params.get("albums", [])
    results = []

    for i, item in enumerate(albums):
        if _shutdown:
            break
        artist = item.get("artist")
        album_name = item.get("album")
        update_task(task_id, progress=f"Retagging {i+1}/{len(albums)}: {artist}/{album_name}")

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
            results.append({"artist": artist, "album": album_name, "error": f"Low score: {best['match_score']}"})
            continue

        result = apply_match(album_dir, exts, best)
        result["artist"] = artist
        result["album"] = album_name
        result["match_score"] = best["match_score"]
        results.append(result)

    return {"results": results}


def _handle_batch_covers(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    albums = params.get("albums", [])
    results = []

    for i, item in enumerate(albums):
        if _shutdown:
            break
        mbid = item.get("mbid")
        path = item.get("path")
        update_task(task_id, progress=f"Fetching cover {i+1}/{len(albums)}")

        if not mbid:
            results.append({"path": path, "error": "No MBID"})
            continue

        album_dir = lib / path
        if not album_dir.is_dir():
            results.append({"path": path, "error": "Not found"})
            continue

        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            results.append({"path": path, "status": "fetched"})
        else:
            results.append({"path": path, "error": "Not found on CAA"})

    return {"results": results}


def _handle_compute_analytics(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.analytics import compute_analytics

    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    last_progress_time = [0.0]

    def _progress(data):
        now = time.time()
        if now - last_progress_time[0] < 2:
            return
        last_progress_time[0] = now
        update_task(task_id, progress=json.dumps(data))

    update_task(task_id, progress=json.dumps({"phase": "analytics", "artists_done": 0, "artists_total": 0, "tracks_processed": 0, "cached": 0, "recomputed": 0}))
    data = compute_analytics(lib, exts, progress_callback=_progress, incremental=True)
    set_cache("analytics", data)

    update_task(task_id, progress=json.dumps({"phase": "stats", "message": "Computing stats..."}))
    artists = albums = tracks = total_size = 0
    formats: dict[str, int] = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        artists += 1
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            albums += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    tracks += 1
                    ext = f.suffix.lower()
                    formats[ext] = formats.get(ext, 0) + 1
                    total_size += f.stat().st_size

    stats = {
        "artists": artists, "albums": albums, "tracks": tracks,
        "formats": formats, "total_size_gb": round(total_size / (1024**3), 2),
    }
    set_cache("stats", stats)

    return {"artists": artists, "albums": albums, "tracks": tracks}


def _handle_enrich_artists(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import get_library_artists
    from musicdock.enrichment import enrich_artist

    all_artists, total = get_library_artists(per_page=10000)
    enriched = 0
    skipped = 0

    for i, artist in enumerate(all_artists):
        if _shutdown or _is_cancelled(task_id):
            break

        name = artist["name"]
        if i % 5 == 0:
            update_task(task_id, progress=json.dumps({
                "artist": name, "done": i + 1, "total": total,
                "enriched": enriched, "skipped": skipped,
            }))

        result = enrich_artist(name, config)
        if result.get("skipped"):
            skipped += 1
            emit_task_event(task_id, "artist_skipped", {"artist": name})
        else:
            enriched += 1
            emit_task_event(task_id, "artist_enriched", {"artist": name, "sources": result})

    return {"enriched": enriched, "skipped": skipped, "total": total}


def _handle_library_sync(task_id: str, params: dict, config: dict) -> dict:
    sync = LibrarySync(config)
    emit_task_event(task_id, "info", {"message": "Starting library sync..."})
    return sync.full_sync(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d))
    )


def _handle_fix_issues(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.fixer import LibraryFixer
    from musicdock.models import Issue, IssueType, Severity
    from musicdock.db import get_latest_scan

    latest = get_latest_scan()
    if not latest or not latest["issues"]:
        return {"error": "No issues to fix"}

    threshold = params.get("threshold", config.get("confidence_threshold", 90))
    issues = latest["issues"]
    issue_objs = []
    for i in issues:
        issue_objs.append(Issue(
            type=IssueType(i["type"]),
            severity=Severity(i["severity"]),
            confidence=i["confidence"],
            description=i["description"],
            paths=[Path(p) for p in i["paths"]],
            suggestion=i["suggestion"],
            details=i.get("details", {}),
        ))

    update_task(task_id, progress=json.dumps({"phase": "fixing", "total": len(issue_objs)}))
    fixer = LibraryFixer(config)
    emit_task_event(task_id, "info", {"message": f"Fixing {len(issue_objs)} issues..."})
    fixer.fix(issue_objs, dry_run=False)

    auto = sum(1 for i in issue_objs if i.confidence >= threshold)
    return {"fixed": auto, "total": len(issue_objs)}


def _handle_fetch_cover(task_id: str, params: dict, config: dict) -> dict:
    mbid = params.get("mbid")
    path = params.get("path")
    if not mbid:
        return {"error": "No MBID"}

    lib = Path(config["library_path"])
    album_dir = lib / path if path else None

    image = fetch_cover_from_caa(mbid)
    if not image:
        return {"error": "No cover found on CAA"}

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        return {"status": "saved", "path": str(album_dir / "cover.jpg")}

    return {"error": "Album directory not found"}


def _handle_fetch_artist_covers(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.audio import read_tags as _read_tags

    artist_name = params.get("artist", "")
    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))
    artist_dir = lib / artist_name

    if not artist_dir.is_dir():
        return {"error": "Artist not found"}

    fetched = failed = skipped = total = 0
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        total += 1
        if (album_dir / "cover.jpg").exists():
            skipped += 1
            continue
        tracks = get_audio_files(album_dir, exts)
        if not tracks:
            skipped += 1
            continue
        tags = _read_tags(tracks[0])
        mbid = tags.get("musicbrainz_albumid")
        if not mbid:
            skipped += 1
            continue
        update_task(task_id, progress=json.dumps({"album": album_dir.name, "done": total}))
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            fetched += 1
        else:
            failed += 1

    return {"fetched": fetched, "failed": failed, "skipped": skipped, "total": total}


def _handle_enrich_single(task_id: str, params: dict, config: dict) -> dict:
    """Enrich a single artist: all sources + photo + persist to DB."""
    from musicdock.enrichment import enrich_artist

    name = params.get("artist", "")
    if not name:
        return {"error": "No artist specified"}

    update_task(task_id, progress=json.dumps({"artist": name, "phase": "enriching"}))
    result = enrich_artist(name, config, force=True)
    emit_task_event(task_id, "info", {"message": f"Enriched: {name}", "sources": result})
    return result


def _handle_analyze_tracks(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio tracks for BPM, key, energy, mood."""
    from musicdock.audio_analysis import analyze_track
    from musicdock.db import get_library_albums, get_library_tracks, update_track_audiomuse

    artist = params.get("artist")
    album_name = params.get("album")
    lib = Path(config["library_path"])

    # Collect tracks to analyze
    tracks_to_analyze = []
    if artist and album_name:
        # Single album
        from musicdock.db import get_library_album
        album_data = get_library_album(artist, album_name)
        if album_data:
            tracks = get_library_tracks(album_data["id"])
            tracks_to_analyze = [(t["path"], t) for t in tracks if not t.get("bpm")]
    elif artist:
        # All albums for artist
        albums = get_library_albums(artist)
        for a in albums:
            tracks = get_library_tracks(a["id"])
            tracks_to_analyze.extend((t["path"], t) for t in tracks if not t.get("bpm"))
    else:
        return {"error": "No artist specified"}

    total = len(tracks_to_analyze)
    analyzed = 0
    failed = 0

    for i, (path, track) in enumerate(tracks_to_analyze):
        if _shutdown or _is_cancelled(task_id):
            break

        if i % 5 == 0:
            update_task(task_id, progress=json.dumps({
                "track": track.get("title", Path(path).stem),
                "done": i, "total": total,
                "analyzed": analyzed,
            }))

        try:
            result = analyze_track(path)
            if result.get("bpm") is not None:
                update_track_audiomuse(
                    path,
                    bpm=result["bpm"],
                    key=result["key"],
                    scale=result["scale"],
                    energy=result["energy"],
                    mood=result["mood"],
                    danceability=result.get("danceability"),
                    valence=result.get("valence"),
                    acousticness=result.get("acousticness"),
                    instrumentalness=result.get("instrumentalness"),
                    loudness=result.get("loudness"),
                    dynamic_range=result.get("dynamic_range"),
                    spectral_complexity=result.get("spectral_complexity"),
                )
                analyzed += 1
            else:
                failed += 1
        except Exception:
            log.warning("Failed to analyze %s", path, exc_info=True)
            failed += 1

    return {"analyzed": analyzed, "failed": failed, "total": total}


def _handle_health_check(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.health_check import LibraryHealthCheck

    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d))
    )
    set_cache("health_report", report)
    issue_count = len(report.get("issues", []))
    emit_task_event(task_id, "info", {"message": f"Health check complete: {issue_count} issues", "summary": report.get("summary", {})})
    return {"issue_count": len(report.get("issues", [])), "summary": report.get("summary", {})}


def _handle_repair(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.repair import LibraryRepair
    from musicdock.navidrome import start_scan

    dry_run = params.get("dry_run", True)
    auto_only = params.get("auto_only", True)
    specific_issues = params.get("issues")

    if specific_issues:
        # Repair specific issues passed directly
        report = {"issues": specific_issues}
    else:
        # Get latest health report
        report = get_cache("health_report")
        if not report:
            from musicdock.health_check import LibraryHealthCheck
            checker = LibraryHealthCheck(config)
            report = checker.run(
                progress_callback=lambda d: update_task(task_id, progress=json.dumps(d))
            )
            set_cache("health_report", report)

    repairer = LibraryRepair(config)
    result = repairer.repair(
        report, dry_run=dry_run, auto_only=auto_only, task_id=task_id,
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d)),
    )

    action_count = len(result.get("actions", []))
    emit_task_event(task_id, "info", {"message": f"Repair complete: {action_count} actions", "fs_changed": result.get("fs_changed"), "db_changed": result.get("db_changed")})
    if not dry_run and result.get("fs_changed"):
        start_scan()

    return result


def _handle_library_pipeline(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.health_check import LibraryHealthCheck
    from musicdock.repair import LibraryRepair
    from musicdock.navidrome import start_scan
    from musicdock.scheduler import mark_run

    emit_task_event(task_id, "info", {"message": "Pipeline: running health check..."})
    update_task(task_id, progress=json.dumps({"phase": "health_check"}))
    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "health_check"}))
    )
    set_cache("health_report", report)

    emit_task_event(task_id, "info", {"message": "Pipeline: running repair..."})
    update_task(task_id, progress=json.dumps({"phase": "repair"}))
    repairer = LibraryRepair(config)
    repair_result = repairer.repair(
        report, dry_run=False, auto_only=True, task_id=task_id,
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "repair"})),
    )

    emit_task_event(task_id, "info", {"message": "Pipeline: running sync..."})
    update_task(task_id, progress=json.dumps({"phase": "sync"}))
    sync = LibrarySync(config)
    sync_result = sync.full_sync(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "sync"}))
    )

    if repair_result.get("fs_changed"):
        start_scan()

    mark_run("library_pipeline")

    return {
        "health": {"issue_count": len(report.get("issues", []))},
        "repair": {"actions": len(repair_result.get("actions", []))},
        "sync": sync_result,
    }


def _handle_delete_artist(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import delete_artist as db_delete_artist, log_audit, delete_cache
    from musicdock.navidrome import start_scan

    name = params.get("name", "")
    mode = params.get("mode", "db_only")
    lib = Path(config["library_path"])

    # Find folder
    from musicdock.db import get_library_artist
    artist = get_library_artist(name)
    folder = (artist.get("folder_name") if artist else None) or name
    artist_dir = lib / folder

    if mode == "full" and artist_dir.is_dir():
        shutil.rmtree(str(artist_dir))
        log.info("Deleted artist directory: %s", artist_dir)

    db_delete_artist(name)

    # Clean caches
    for prefix in ("enrichment:", "lastfm:artist:", "fanart:artist:", "fanart:bg:",
                    "fanart:all:", "nd:artist:", "spotify:artist:"):
        delete_cache(f"{prefix}{name.lower()}")

    emit_task_event(task_id, "info", {"message": f"Deleted artist: {name}", "mode": mode})
    log_audit("delete_artist", "artist", name,
              details={"mode": mode, "folder": folder}, task_id=task_id)

    if mode == "full":
        start_scan()

    return {"deleted": name, "mode": mode}


def _handle_delete_album(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import delete_album as db_delete_album, log_audit, get_library_albums, upsert_artist, get_library_artist
    from musicdock.navidrome import start_scan

    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    mode = params.get("mode", "db_only")
    lib = Path(config["library_path"])

    # Find album path
    artist_data = get_library_artist(artist_name)
    folder = (artist_data.get("folder_name") if artist_data else None) or artist_name
    album_dir = lib / folder / album_name

    if mode == "full" and album_dir.is_dir():
        shutil.rmtree(str(album_dir))

    db_delete_album(str(album_dir))

    # Update artist counters
    if artist_data:
        albums = get_library_albums(artist_name)
        upsert_artist({
            "name": artist_name,
            "folder_name": folder,
            "album_count": len(albums),
            "track_count": sum(a.get("track_count", 0) for a in albums),
            "total_size": sum(a.get("total_size", 0) for a in albums),
            "formats": [],
            "has_photo": artist_data.get("has_photo", 0),
        })

    emit_task_event(task_id, "info", {"message": f"Deleted album: {artist_name}/{album_name}", "mode": mode})
    log_audit("delete_album", "album", f"{artist_name}/{album_name}",
              details={"mode": mode}, task_id=task_id)

    if mode == "full":
        start_scan()

    return {"deleted": f"{artist_name}/{album_name}", "mode": mode}


def _handle_move_artist(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import get_library_artist, get_library_albums, log_audit
    from musicdock.navidrome import start_scan

    name = params.get("name", "")
    new_name = params.get("new_name", "")
    lib = Path(config["library_path"])

    artist = get_library_artist(name)
    if not artist:
        return {"error": f"Artist not found: {name}"}

    folder = artist.get("folder_name") or name
    old_dir = lib / folder
    new_dir = lib / new_name

    # Rename folder on disk
    if old_dir.is_dir():
        shutil.move(str(old_dir), str(new_dir))

    # Update DB
    with get_db_ctx() as cur:
        cur.execute("UPDATE library_artists SET name = %s, folder_name = %s WHERE name = %s",
                    (new_name, new_name, name))
        cur.execute("UPDATE library_albums SET artist = %s WHERE artist = %s", (new_name, name))
        cur.execute("UPDATE library_tracks SET artist = %s WHERE artist = %s", (new_name, name))
        # Update album paths
        cur.execute("SELECT id, path FROM library_albums WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_albums SET path = %s WHERE id = %s", (new_path, row["id"]))
        # Update track paths
        cur.execute("SELECT id, path FROM library_tracks WHERE artist = %s", (new_name,))
        for row in cur.fetchall():
            old_path = row["path"]
            new_path = old_path.replace(f"/{folder}/", f"/{new_name}/", 1)
            cur.execute("UPDATE library_tracks SET path = %s WHERE id = %s", (new_path, row["id"]))

    # Re-tag audio files (albumartist)
    try:
        import mutagen
        for audio_file in new_dir.rglob("*"):
            if audio_file.is_file() and audio_file.suffix.lower() in {".flac", ".mp3", ".m4a", ".ogg", ".opus"}:
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
    log_audit("move_artist", "artist", name,
              details={"new_name": new_name}, task_id=task_id)
    start_scan()

    return {"moved": name, "new_name": new_name}


def _handle_wipe_library(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import wipe_library_tables, log_audit

    wipe_library_tables()
    emit_task_event(task_id, "info", {"message": "Library database wiped"})
    log_audit("wipe_library", "database", "library", task_id=task_id)

    if params.get("rebuild"):
        create_task("rebuild_library")

    return {"wiped": True, "rebuild": params.get("rebuild", False)}


def _handle_rebuild_library(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import wipe_library_tables, log_audit

    update_task(task_id, progress=json.dumps({"phase": "wipe"}))
    wipe_library_tables()
    emit_task_event(task_id, "info", {"message": "Rebuild: database wiped, starting pipeline..."})
    log_audit("rebuild_library_wipe", "database", "library", task_id=task_id)

    # Run full pipeline
    result = _handle_library_pipeline(task_id, params, config)

    log_audit("rebuild_library_complete", "database", "library",
              details=result, task_id=task_id)

    return result


def _handle_reset_enrichment(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import delete_cache, get_library_artist, log_audit

    name = params.get("artist", "")
    lib = Path(config["library_path"])

    # Clear caches
    for prefix in ("enrichment:", "lastfm:artist:", "fanart:artist:", "fanart:bg:",
                    "fanart:all:", "nd:artist:", "spotify:artist:"):
        delete_cache(f"{prefix}{name.lower()}")

    # Delete artist photo
    artist = get_library_artist(name)
    folder = (artist.get("folder_name") if artist else None) or name
    artist_dir = lib / folder
    for photo in ("artist.jpg", "artist.png", "photo.jpg"):
        photo_path = artist_dir / photo
        if photo_path.exists():
            try:
                photo_path.unlink()
            except OSError:
                pass

    emit_task_event(task_id, "info", {"message": f"Reset enrichment for: {name}"})
    log_audit("reset_enrichment", "artist", name, task_id=task_id)

    # Re-enrich
    result = _handle_enrich_single(task_id, {"artist": name}, config)
    return {"reset": name, "enrichment": result}


def _handle_update_album_tags(task_id: str, params: dict, config: dict) -> dict:
    import mutagen

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    album_fields = params.get("album_fields", {})
    track_tags = params.get("track_tags", {})

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    tracks = get_audio_files(album_dir, list(exts))
    updated = 0
    errors = []

    for track in tracks:
        try:
            audio = mutagen.File(track, easy=True)
            if audio is None:
                continue
            for key, val in album_fields.items():
                audio[key] = val
            if track.name in track_tags:
                for key, val in track_tags[track.name].items():
                    audio[key] = val
            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": track.name, "error": str(e)})

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
        for key, val in tags.items():
            audio[key] = val
        audio.save()
        return {"status": "ok", "file": track_path.name}
    except Exception as e:
        return {"error": str(e)}


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

    emit_task_event(task_id, "info", {"message": f"Resolved duplicates: kept {keep}, removed {len(removed)}"})
    return {"kept": keep, "removed": removed}


def _handle_match_apply(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.matcher import apply_match
    from musicdock.db import get_db_ctx

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    release = params.get("release", {})

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    result = apply_match(album_dir, exts, release)
    updated_count = result.get("updated", 0)
    emit_task_event(task_id, "info", {"message": f"Applied MusicBrainz tags: {updated_count} tracks"})

    # Sync MBID to database
    mbid = result.get("mbid")
    rg_id = result.get("release_group_id")
    if mbid:
        try:
            album_path = f"{artist_folder}/{album_folder}"
            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_albums SET musicbrainz_albumid = %s WHERE path = %s",
                    (mbid, album_path),
                )
                if rg_id:
                    cur.execute(
                        "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE path = %s",
                        (rg_id, album_path),
                    )
            emit_task_event(task_id, "info", {"message": f"Synced MBID {mbid[:8]}... to DB"})
        except Exception as e:
            log.error("Failed to sync MBID to DB: %s", e)

    # Re-sync album from filesystem to update titles/tags in DB
    try:
        from musicdock.library_sync import LibrarySync
        syncer = LibrarySync(config)
        syncer.sync_album(album_dir, artist_folder)
        emit_task_event(task_id, "info", {"message": "Re-synced album to DB"})
    except Exception as e:
        log.error("Failed to re-sync album after match apply: %s", e, exc_info=True)

    return result


def _handle_enrich_mbids(task_id: str, params: dict, config: dict) -> dict:
    """Enrich albums and tracks with MusicBrainz IDs."""
    import re
    import mutagen
    import musicbrainzngs
    from musicdock.matcher import _search_musicbrainz, _get_release_detail, _score_match, _gather_local_info
    from musicdock.db import get_library_albums, get_library_tracks, get_db_ctx

    musicbrainzngs.set_useragent("musicdock", "0.1", "https://github.com/musicdock")
    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    artist_filter = params.get("artist")
    min_score = params.get("min_score", 70)

    # Collect albums to process
    if artist_filter:
        albums = get_library_albums(artist_filter)
    else:
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''"
            )
            albums = [dict(r) for r in cur.fetchall()]

    total = len(albums)
    enriched = 0
    skipped = 0
    failed = 0

    for i, album in enumerate(albums):
        if _shutdown or _is_cancelled(task_id):
            break

        album_name = album.get("tag_album") or album.get("name", "")
        artist_name = album.get("artist", "")
        album_path = album.get("path", "")

        # Skip if already has MBID
        existing_mbid = album.get("musicbrainz_albumid")
        if existing_mbid and existing_mbid.strip():
            skipped += 1
            continue

        if i % 5 == 0:
            update_task(task_id, progress=json.dumps({
                "artist": artist_name, "album": album_name,
                "done": i, "total": total,
                "enriched": enriched, "skipped": skipped,
            }))

        clean_album = re.sub(r"^\d{4}\s*-\s*", "", album_name)

        # Search MB
        tracks_db = get_library_tracks(album["id"]) if "id" in album else []
        track_count = len(tracks_db) or album.get("track_count", 0)

        candidates = _search_musicbrainz(artist_name, clean_album, track_count)
        if not candidates:
            failed += 1
            time.sleep(1)
            continue

        # Get details of top candidates and score them
        best_release = None
        best_score = 0

        album_dir = Path(album_path) if album_path else None
        if album_dir and album_dir.is_dir():
            local_info = _gather_local_info(get_audio_files(album_dir, list(exts)))
        else:
            # Build minimal local_info from DB
            local_info = {
                "artist": artist_name,
                "album": clean_album,
                "track_count": track_count,
                "tracks": [
                    {"title": t.get("title", ""), "length_sec": int(t.get("duration", 0)), "tracknumber": str(t.get("track_number", "")), "filename": t.get("filename", "")}
                    for t in tracks_db
                ],
                "total_length": sum(int(t.get("duration", 0)) for t in tracks_db),
            }

        for candidate in candidates[:3]:
            release = _get_release_detail(candidate["mbid"])
            if not release:
                continue
            score = _score_match(local_info, release)
            if score > best_score:
                best_score = score
                best_release = release
            time.sleep(0.5)

        if not best_release or best_score < min_score:
            failed += 1
            time.sleep(0.5)
            continue

        # Write MBIDs to DB — single connection for album + all its tracks
        release_mbid = best_release["mbid"]
        release_group_id = best_release.get("release_group_id", "")
        mb_tracks = best_release.get("tracks", [])

        with get_db_ctx() as cur:
            cur.execute(
                "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
                (release_mbid, album["id"]),
            )
            for j, db_track in enumerate(tracks_db):
                if j >= len(mb_tracks):
                    break
                track_mbid = mb_tracks[j].get("mbid", "")
                if track_mbid:
                    cur.execute(
                        "UPDATE library_tracks SET musicbrainz_albumid = %s, musicbrainz_trackid = %s WHERE id = %s",
                        (release_mbid, track_mbid, db_track["id"]),
                    )

        # Write to file tags
        written_files = 0
        for j, db_track in enumerate(tracks_db):
            if j >= len(mb_tracks):
                break
            mb_track = mb_tracks[j]
            track_mbid = mb_track.get("mbid", "")
            track_path = db_track.get("path", "")
            if track_path and Path(track_path).is_file():
                try:
                    audio = mutagen.File(track_path, easy=True)
                    if audio is not None:
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
                            written_files += 1
                except Exception:
                    log.warning("Failed to write MBID tags to %s", track_path)

        enriched += 1
        emit_task_event(task_id, "album_matched", {"artist": artist_name, "album": clean_album, "mbid": release_mbid, "score": best_score})
        log.info("Enriched %s / %s (score=%d, mbid=%s, files=%d)",
                 artist_name, clean_album, best_score, release_mbid, written_files)
        time.sleep(1)  # MB rate limit: 1 req/sec

    return {"enriched": enriched, "skipped": skipped, "failed": failed, "total": total}


def _handle_tidal_download(task_id: str, params: dict, config: dict) -> dict:
    """Download from Tidal and run full processing pipeline."""
    from musicdock.tidal import download, move_to_library
    from musicdock.library_sync import LibrarySync
    from musicdock.db import update_tidal_download

    url = params.get("url", "")
    quality = params.get("quality", "max")
    download_id = params.get("download_id")
    lib = Path(config["library_path"])

    if not url:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No URL")
        return {"error": "No URL provided"}

    # Update tidal_downloads status
    if download_id:
        update_tidal_download(download_id, status="downloading", task_id=task_id)

    # 1. Download via tiddl
    emit_task_event(task_id, "info", {"message": f"Downloading from Tidal: {url}"})
    update_task(task_id, progress=json.dumps({"phase": "downloading", "url": url}))
    result = download(
        url, quality=quality, task_id=task_id,
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d)),
    )

    if not result.get("success"):
        if download_id:
            update_tidal_download(download_id, status="failed", error=result.get("error", "Download failed"))
        return {"error": result.get("error", "Download failed"), "phase": "download"}

    # 2. Move to library
    if download_id:
        update_tidal_download(download_id, status="processing")
    update_task(task_id, progress=json.dumps({"phase": "moving", "files": result.get("file_count", 0)}))
    modified_artists = move_to_library(result["path"], str(lib))

    if not modified_artists:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No files moved")
        return {"error": "No files were moved", "phase": "move"}

    # 3. Sync modified artists
    update_task(task_id, progress=json.dumps({"phase": "syncing", "artists": modified_artists}))
    sync = LibrarySync(config)
    for artist_name in modified_artists:
        artist_dir = lib / artist_name
        if artist_dir.is_dir():
            try:
                sync.sync_artist(artist_dir)
            except Exception:
                log.warning("Sync failed for %s", artist_name, exc_info=True)

    # 4. Queue process_new_content for each artist
    for artist_name in modified_artists:
        try:
            create_task("process_new_content", {"artist": artist_name})
        except Exception:
            pass

    # 5. Trigger Navidrome scan
    try:
        from musicdock.navidrome import start_scan
        start_scan()
    except Exception:
        pass

    emit_task_event(task_id, "info", {"message": f"Download complete: {len(modified_artists)} artists", "artists": modified_artists})
    # 6. Mark download complete
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    if download_id:
        update_tidal_download(download_id, status="completed", completed_at=now)

    return {
        "success": True,
        "url": url,
        "quality": quality,
        "files": result.get("file_count", 0),
        "artists": modified_artists,
    }


def _handle_check_new_releases(task_id: str, params: dict, config: dict) -> dict:
    """Check Tidal for new releases from monitored artists."""
    from musicdock.db import get_monitored_artists, add_tidal_download, get_db_ctx
    from musicdock import tidal as tidal_mod

    monitored = get_monitored_artists()
    if not monitored:
        return {"checked": 0, "new_releases": 0}

    new_count = 0
    for i, ma in enumerate(monitored):
        if _shutdown or _is_cancelled(task_id):
            break

        update_task(task_id, progress=json.dumps({
            "phase": "checking", "artist": ma["artist_name"],
            "done": i, "total": len(monitored),
        }))

        try:
            result = tidal_mod.search(ma["artist_name"], content_type="albums", limit=5)
            albums = result.get("albums", [])
            if not albums:
                continue

            latest = albums[0]
            if latest["id"] != ma.get("last_release_id"):
                # New release found
                add_tidal_download(
                    tidal_url=latest["url"],
                    tidal_id=str(latest["id"]),
                    content_type="album",
                    title=latest["title"],
                    artist=latest["artist"],
                    cover_url=latest.get("cover"),
                    status="queued",
                    source="new_release",
                    metadata={"year": latest.get("year"), "tracks": latest.get("tracks")},
                )
                new_count += 1
                emit_task_event(task_id, "new_release_found", {"artist": ma["artist_name"], "album": latest["title"], "url": latest["url"]})

                # Update last_release_id
                now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE tidal_monitored_artists SET last_release_id = %s, last_checked = %s WHERE artist_name = %s",
                        (str(latest["id"]), now, ma["artist_name"]),
                    )

            time.sleep(1)
        except Exception:
            log.debug("New release check failed for %s", ma["artist_name"])

    return {"checked": len(monitored), "new_releases": new_count}


def _reorganize_artist_folders(artist_name: str, lib: Path, config: dict, task_id: str | None = None):
    """Move album folders to Artist/Year/Album structure if not already organized."""
    import re as _re
    from musicdock.audio import read_tags, get_audio_files

    artist_dir = lib / artist_name
    if not artist_dir.is_dir():
        return

    year_prefix_re = _re.compile(r"^(\d{4})\s*[-–]\s*(.+)$")
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    moved = 0

    for sub in list(artist_dir.iterdir()):
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        # Skip if already a year directory
        if sub.name.isdigit() and len(sub.name) == 4:
            continue

        # Determine year: from folder name prefix or from audio tags
        m = year_prefix_re.match(sub.name)
        if m:
            year = m.group(1)
            clean_name = m.group(2).strip()
        else:
            # Read year from first audio file
            audio_files = get_audio_files(sub, list(exts))
            if not audio_files:
                continue
            tags = read_tags(audio_files[0])
            year_tag = tags.get("date", "")[:4]
            if not year_tag or not year_tag.isdigit():
                continue
            year = year_tag
            clean_name = sub.name

        target = artist_dir / year / clean_name
        if target == sub:
            continue
        if target.exists():
            log.warning("Cannot reorganize %s: target %s already exists", sub, target)
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(sub), str(target))
            # Update DB paths
            old_path = str(sub)
            new_path = str(target)
            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_albums SET name = %s, path = %s WHERE path = %s",
                    (clean_name, new_path, old_path),
                )
                cur.execute(
                    "UPDATE library_tracks SET path = REPLACE(path, %s, %s) WHERE path LIKE %s",
                    (old_path, new_path, old_path + "%"),
                )
            moved += 1
            log.info("Reorganized: %s -> %s", sub.name, f"{year}/{clean_name}")
            emit_task_event(task_id, "info", {"message": f"Moved {sub.name} → {year}/{clean_name}"})
        except Exception:
            log.warning("Failed to reorganize %s", sub, exc_info=True)

    if moved:
        log.info("Reorganized %d album folders for %s", moved, artist_name)


def _handle_process_new_content(task_id: str, params: dict, config: dict) -> dict:
    """Full pipeline for new content: enrich artist + index genres + analyze audio + bliss."""
    from musicdock.enrichment import enrich_artist
    from musicdock.genre_indexer import index_all_genres
    from musicdock.bliss import analyze_file as bliss_analyze, store_vectors, is_available as bliss_available
    from musicdock.audio_analysis import analyze_track
    from musicdock.db import (
        get_library_artist, get_library_albums, get_library_tracks,
        update_track_audiomuse, set_album_genres, get_or_create_genre, get_db_ctx,
    )
    from musicdock.popularity import _lastfm_get, _parse_int
    import re as _re

    artist_name = params.get("artist", "")
    album_folder = params.get("album", "")

    # Tell watcher to ignore changes while we write tags/photos
    if _watcher:
        _watcher.mark_processing(artist_name)
    lib = Path(config["library_path"])

    result = {"artist": artist_name, "album": album_folder, "steps": {}}

    # ── 0. Reorganize folders to Artist/Year/Album structure ──
    update_task(task_id, progress=json.dumps({"step": "organize_folders", "artist": artist_name}))
    try:
        _reorganize_artist_folders(artist_name, lib, config, task_id)
        result["steps"]["organize_folders"] = True
    except Exception:
        log.warning("Folder reorganization failed for %s", artist_name, exc_info=True)
        result["steps"]["organize_folders"] = "failed"

    # ── 1. Artist enrichment (if not recently enriched) ──
    update_task(task_id, progress=json.dumps({"step": "enrich_artist", "artist": artist_name}))
    try:
        enrich_result = enrich_artist(artist_name, config)
        result["steps"]["enrich_artist"] = enrich_result.get("skipped", False)
        emit_task_event(task_id, "step_done", {"step": "enrich_artist", "result": enrich_result})
    except Exception:
        log.warning("Enrich artist failed for %s", artist_name, exc_info=True)
        result["steps"]["enrich_artist"] = "failed"

    # ── 2. Album genre indexing ──
    update_task(task_id, progress=json.dumps({"step": "album_genres", "artist": artist_name}))
    try:
        albums = get_library_albums(artist_name)
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = get_library_tracks(album["id"])
            album_genres_raw = set()
            if album.get("genre"):
                for g in album["genre"].split(","):
                    g = g.strip()
                    if g:
                        album_genres_raw.add(g)
            for t in tracks:
                if t.get("genre"):
                    for g in t["genre"].split(","):
                        g = g.strip()
                        if g:
                            album_genres_raw.add(g)
            if album_genres_raw:
                genres = [(g, 1.0, "tags") for g in album_genres_raw]
                set_album_genres(album["id"], genres)
        result["steps"]["album_genres"] = True
    except Exception:
        log.warning("Album genre indexing failed", exc_info=True)
        result["steps"]["album_genres"] = "failed"

    # ── 3. Album MBID lookup ──
    update_task(task_id, progress=json.dumps({"step": "album_mbid", "artist": artist_name}))
    try:
        import musicbrainzngs
        musicbrainzngs.set_useragent("grooveyard", "0.1", "https://github.com/grooveyard")
        from musicdock.matcher import _search_musicbrainz, _get_release_detail, _score_match, _gather_local_info
        from musicdock.audio import get_audio_files

        exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
        mbid_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            existing_mbid = album.get("musicbrainz_albumid")
            if existing_mbid and existing_mbid.strip():
                continue

            clean_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
            track_count = album.get("track_count", 0)
            candidates = _search_musicbrainz(artist_name, clean_name, track_count)
            if not candidates:
                time.sleep(1)
                continue

            album_dir = Path(album["path"]) if album.get("path") else None
            if album_dir and album_dir.is_dir():
                local_info = _gather_local_info(get_audio_files(album_dir, list(exts)))
            else:
                db_tracks = get_library_tracks(album["id"])
                local_info = {
                    "artist": artist_name, "album": clean_name, "track_count": track_count,
                    "tracks": [{"title": t.get("title", ""), "length_sec": int(t.get("duration", 0)), "tracknumber": "", "filename": ""} for t in db_tracks],
                    "total_length": sum(int(t.get("duration", 0)) for t in db_tracks),
                }

            best_release = None
            best_score = 0
            for c in candidates[:2]:
                release = _get_release_detail(c["mbid"])
                if not release:
                    continue
                score = _score_match(local_info, release)
                if score > best_score:
                    best_score = score
                    best_release = release
                time.sleep(0.5)

            if best_release and best_score >= 70:
                with get_db_ctx() as cur:
                    cur.execute("UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
                                (best_release["mbid"], album["id"]))
                mbid_count += 1
            time.sleep(1)

        result["steps"]["album_mbid"] = mbid_count
    except Exception:
        log.warning("Album MBID lookup failed", exc_info=True)
        result["steps"]["album_mbid"] = "failed"

    # ── 4. Audio analysis (Essentia/librosa) for new tracks ──
    update_task(task_id, progress=json.dumps({"step": "audio_analysis", "artist": artist_name}))
    try:
        analyzed = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = get_library_tracks(album["id"])
            for t in tracks:
                if t.get("bpm") is not None:
                    continue  # already analyzed
                if _shutdown or _is_cancelled(task_id):
                    break
                try:
                    ar = analyze_track(t["path"])
                    if ar.get("bpm") is not None:
                        update_track_audiomuse(
                            t["path"], bpm=ar["bpm"], key=ar["key"], scale=ar["scale"],
                            energy=ar["energy"], mood=ar["mood"],
                            danceability=ar.get("danceability"), valence=ar.get("valence"),
                            acousticness=ar.get("acousticness"), instrumentalness=ar.get("instrumentalness"),
                            loudness=ar.get("loudness"), dynamic_range=ar.get("dynamic_range"),
                            spectral_complexity=ar.get("spectral_complexity"),
                        )
                        analyzed += 1
                        emit_task_event(task_id, "track_analyzed", {"title": t.get("title", ""), "bpm": ar.get("bpm"), "key": ar.get("key")})
                except Exception:
                    log.debug("Analysis failed for %s", t["path"])
        result["steps"]["audio_analysis"] = analyzed
    except Exception:
        log.warning("Audio analysis failed", exc_info=True)
        result["steps"]["audio_analysis"] = "failed"

    # ── 5. Bliss vectors ──
    if bliss_available():
        update_task(task_id, progress=json.dumps({"step": "bliss", "artist": artist_name}))
        try:
            from musicdock.bliss import analyze_directory
            artist_data = get_library_artist(artist_name)
            folder = (artist_data.get("folder_name") if artist_data else None) or artist_name
            artist_dir = lib / folder
            if artist_dir.is_dir():
                vectors = analyze_directory(str(artist_dir))
                if vectors:
                    store_vectors(vectors)
                result["steps"]["bliss"] = len(vectors) if vectors else 0
        except Exception:
            log.warning("Bliss failed for %s", artist_name, exc_info=True)
            result["steps"]["bliss"] = "failed"

    # ── 6. Popularity (Last.fm) ──
    update_task(task_id, progress=json.dumps({"step": "popularity", "artist": artist_name}))
    try:
        pop_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute("UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                                    (listeners, playcount, album["id"]))
                    pop_count += 1
            time.sleep(0.25)

        # Track popularity (cap at 50 tracks to avoid long waits)
        track_pop = 0
        tracks_checked = 0
        MAX_TRACK_POP = 50
        for album in albums:
            if tracks_checked >= MAX_TRACK_POP:
                break
            if album_folder and album["name"] != album_folder:
                continue
            tracks_db = get_library_tracks(album["id"])
            for t in tracks_db:
                if tracks_checked >= MAX_TRACK_POP:
                    break
                title = t.get("title", "")
                if not title or t.get("lastfm_listeners"):
                    continue  # skip empty titles and already-fetched
                tracks_checked += 1
                try:
                    data = _lastfm_get("track.getinfo", artist=artist_name, track=title, autocorrect="1")
                    if data and "track" in data:
                        info = data["track"]
                        listeners = _parse_int(info.get("listeners", 0))
                        playcount = _parse_int(info.get("playcount", 0))
                        if listeners > 0:
                            with get_db_ctx() as cur:
                                cur.execute(
                                    "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                                    (listeners, playcount, t["id"]),
                                )
                            track_pop += 1
                except Exception:
                    pass  # skip failed tracks
                time.sleep(0.2)

        # Normalize to 0-100 scale
        from musicdock.popularity import _normalize_popularity
        _normalize_popularity()

        result["steps"]["popularity"] = {"albums": pop_count, "tracks": track_pop}
    except Exception:
        log.warning("Popularity failed", exc_info=True)
        result["steps"]["popularity"] = "failed"

    # ── 7. Fetch album covers ──
    update_task(task_id, progress=json.dumps({"step": "covers", "artist": artist_name}))
    try:
        from musicdock.artwork import fetch_cover_from_caa, save_cover
        import requests as _requests
        covers_fetched = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_dir = Path(album["path"]) if album.get("path") else None
            if not album_dir or not album_dir.is_dir():
                continue
            # Skip if already has cover
            if any((album_dir / c).exists() for c in ("cover.jpg", "cover.png", "folder.jpg")):
                continue

            cover_data = None
            # Try CAA if MBID available
            mbid = album.get("musicbrainz_albumid")
            if mbid and mbid.strip():
                cover_data = fetch_cover_from_caa(mbid)

            # Try Deezer
            if not cover_data:
                try:
                    album_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
                    resp = _requests.get("https://api.deezer.com/search/album",
                                         params={"q": f"{artist_name} {album_name}", "limit": 1}, timeout=10)
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        if data and data[0].get("cover_xl"):
                            img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                except Exception:
                    pass

            if cover_data:
                save_cover(album_dir, cover_data)
                covers_fetched += 1
                # Update has_cover in DB
                with get_db_ctx() as cur:
                    cur.execute("UPDATE library_albums SET has_cover = 1 WHERE id = %s", (album["id"],))

            time.sleep(0.3)
        result["steps"]["covers"] = covers_fetched
    except Exception:
        log.warning("Cover fetching failed", exc_info=True)
        result["steps"]["covers"] = "failed"

    # Unmark processing so watcher can react to future changes
    if _watcher:
        _watcher.unmark_processing(artist_name)

    return result


def _handle_scan_missing_covers(task_id: str, params: dict, config: dict) -> dict:
    """Scan for missing covers, search sources, emit events for each find."""
    from musicdock.artwork import scan_missing_covers, fetch_cover_from_caa, save_cover, extract_embedded_cover
    from musicdock.lastfm import download_artist_image

    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))

    # Phase 1: Scan for missing covers
    update_task(task_id, progress=json.dumps({"phase": "scanning"}))
    emit_task_event(task_id, "info", {"message": "Scanning library for missing covers..."})
    missing = scan_missing_covers(lib, exts)

    emit_task_event(task_id, "info", {"message": f"Found {len(missing)} albums without covers", "total": len(missing)})

    # Phase 2: Search sources for each missing cover
    found = 0
    not_found = 0

    for i, album in enumerate(missing):
        if _shutdown or _is_cancelled(task_id):
            break

        artist = album["artist"]
        album_name = album["album"]
        mbid = album.get("mbid")
        album_path = album["path"]

        update_task(task_id, progress=json.dumps({
            "phase": "searching", "artist": artist, "album": album_name,
            "done": i, "total": len(missing), "found": found,
        }))

        # Try sources in order
        cover_data = None
        source = None

        # 1. Cover Art Archive (if MBID available)
        if mbid and mbid.strip():
            cover_data = fetch_cover_from_caa(mbid)
            if cover_data:
                source = "coverartarchive"

        # 2. Extract from embedded art in audio files
        if not cover_data:
            audio_files = list(Path(album_path).glob("*.flac")) + list(Path(album_path).glob("*.mp3"))
            for af in audio_files[:1]:
                embedded = extract_embedded_cover(af)
                if embedded:
                    cover_data = embedded
                    source = "embedded"
                    break

        # 3. Tidal (search for album cover) — TODO: would need Tidal API

        # 4. Deezer (search for album)
        if not cover_data:
            try:
                import requests as _requests
                resp = _requests.get(
                    "https://api.deezer.com/search/album",
                    params={"q": f"{artist} {album_name}", "limit": 1},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json().get("data", [])
                    if data and data[0].get("cover_xl"):
                        img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                        if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                            cover_data = img_resp.content
                            source = "deezer"
            except Exception:
                pass

        if cover_data:
            found += 1
            emit_task_event(task_id, "cover_found", {
                "artist": artist,
                "album": album_name,
                "path": album_path,
                "source": source,
                "size": len(cover_data),
                "index": i,
            })
            # Store cover data in cache for later apply
            set_cache(f"pending_cover:{task_id}:{i}", {
                "artist": artist, "album": album_name, "path": album_path,
                "source": source, "applied": False,
            })
            # Save cover to temp location (or directly if auto-apply)
            if params.get("auto_apply"):
                save_cover(Path(album_path), cover_data)
                emit_task_event(task_id, "cover_applied", {
                    "artist": artist, "album": album_name, "source": source,
                })
        else:
            not_found += 1
            emit_task_event(task_id, "info", {
                "message": f"No cover found for {artist} / {album_name}",
                "artist": artist, "album": album_name,
            })

        time.sleep(0.3)  # Rate limit

    return {"total_missing": len(missing), "found": found, "not_found": not_found}


def _handle_apply_cover(task_id: str, params: dict, config: dict) -> dict:
    """Apply a found cover to an album."""
    from musicdock.artwork import fetch_cover_from_caa, save_cover
    from musicdock.db import emit_task_event

    album_path = params.get("path", "")
    source = params.get("source", "")
    mbid = params.get("mbid", "")

    if not album_path:
        return {"error": "No album path"}

    album_dir = Path(album_path)
    if not album_dir.is_dir():
        return {"error": "Album directory not found"}

    cover_data = None

    if source == "coverartarchive" and mbid:
        cover_data = fetch_cover_from_caa(mbid)
    elif source == "deezer":
        artist = params.get("artist", "")
        album = params.get("album", "")
        try:
            import requests as _requests
            resp = _requests.get("https://api.deezer.com/search/album",
                                 params={"q": f"{artist} {album}", "limit": 1}, timeout=10)
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                if data and data[0].get("cover_xl"):
                    img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                    if img_resp.status_code == 200:
                        cover_data = img_resp.content
        except Exception:
            pass

    if not cover_data:
        return {"error": "Failed to fetch cover"}

    save_cover(album_dir, cover_data)
    emit_task_event(task_id, "cover_applied", {
        "artist": params.get("artist"), "album": params.get("album"),
    })

    return {"applied": True, "path": album_path}


def _handle_compute_bliss(task_id: str, params: dict, config: dict) -> dict:
    """Compute bliss feature vectors — processes per artist for incremental storage."""
    from musicdock.bliss import analyze_directory, store_vectors, is_available
    from musicdock.db import get_library_artists

    if not is_available():
        return {"error": "grooveyard-bliss binary not found"}

    lib = Path(config["library_path"])
    all_artists, total = get_library_artists(per_page=10000)
    analyzed_total = 0
    failed_total = 0

    for i, artist in enumerate(all_artists):
        if _shutdown or _is_cancelled(task_id):
            break

        folder = artist.get("folder_name") or artist["name"]
        artist_dir = lib / folder
        if not artist_dir.is_dir():
            continue

        update_task(task_id, progress=json.dumps({
            "phase": "analyzing", "artist": artist["name"],
            "done": i, "total": total, "analyzed": analyzed_total,
        }))

        vectors = analyze_directory(str(artist_dir))
        if vectors:
            store_vectors(vectors)
            analyzed_total += len(vectors)
            emit_task_event(task_id, "artist_analyzed", {"artist": artist["name"], "tracks": len(vectors)})

    return {"analyzed": analyzed_total, "artists": total}


def _handle_compute_popularity(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.popularity import compute_popularity
    emit_task_event(task_id, "info", {"message": "Computing popularity from Last.fm..."})
    return compute_popularity(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d))
    )


def _handle_index_genres(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.genre_indexer import index_all_genres
    emit_task_event(task_id, "info", {"message": "Indexing genres..."})
    result = index_all_genres(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps(d))
    )
    genre_count = result.get("total_genres", 0)
    emit_task_event(task_id, "info", {"message": f"Genres indexed: {genre_count} genres"})
    return result


def _handle_sync_playlist_navidrome(task_id: str, params: dict, config: dict) -> dict:
    """Sync a Grooveyard playlist to Navidrome."""
    from musicdock.db import get_playlist, get_playlist_tracks
    from musicdock.navidrome import find_album, search, create_playlist as nd_create_playlist
    from thefuzz import fuzz

    playlist_id = params.get("playlist_id")
    if not playlist_id:
        return {"error": "No playlist_id"}

    pl = get_playlist(playlist_id)
    if not pl:
        return {"error": "Playlist not found"}

    tracks = get_playlist_tracks(playlist_id)
    if not tracks:
        return {"error": "Empty playlist"}

    # Match each track to a Navidrome song ID
    matched_ids = []
    unmatched = []

    for i, t in enumerate(tracks):
        artist = t.get("artist", "")
        title = t.get("title", "")
        if not artist or not title:
            unmatched.append(title or t.get("track_path", ""))
            continue

        if i % 5 == 0:
            update_task(task_id, progress=json.dumps({
                "phase": "matching", "done": i, "total": len(tracks),
            }))

        try:
            results = search(f"{artist} {title}", artist_count=0, album_count=0, song_count=10)
            songs = results.get("song", [])

            best_match = None
            best_score = 0
            for s in songs:
                a_score = fuzz.ratio(artist.lower(), s.get("artist", "").lower())
                t_score = fuzz.ratio(title.lower(), s.get("title", "").lower())
                score = (a_score + t_score) // 2
                if score > best_score:
                    best_score = score
                    best_match = s

            if best_match and best_score >= 70:
                matched_ids.append(best_match["id"])
            else:
                unmatched.append(f"{artist} - {title}")
        except Exception:
            unmatched.append(f"{artist} - {title}")

    if not matched_ids:
        return {"error": "No tracks matched in Navidrome", "unmatched": unmatched}

    # Create playlist in Navidrome
    try:
        nd_id = nd_create_playlist(pl["name"], matched_ids)
    except Exception as e:
        return {"error": f"Failed to create Navidrome playlist: {e}"}

    emit_task_event(task_id, "info", {"message": f"Synced to Navidrome: {len(matched_ids)} tracks matched"})
    return {
        "navidrome_id": nd_id,
        "matched": len(matched_ids),
        "unmatched": unmatched,
        "total": len(tracks),
    }


TASK_HANDLERS = {
    "scan": _handle_scan,
    "analyze_tracks": _handle_analyze_tracks,
    "enrich_artist": _handle_enrich_single,
    "fix_issues": _handle_fix_issues,
    "fetch_cover": _handle_fetch_cover,
    "fetch_artist_covers": _handle_fetch_artist_covers,
    "fetch_artwork_all": _handle_fetch_artwork_all,
    "batch_retag": _handle_batch_retag,
    "batch_covers": _handle_batch_covers,
    "compute_analytics": _handle_compute_analytics,
    "enrich_artists": _handle_enrich_artists,
    "library_sync": _handle_library_sync,
    "health_check": _handle_health_check,
    "repair": _handle_repair,
    "library_pipeline": _handle_library_pipeline,
    "delete_artist": _handle_delete_artist,
    "delete_album": _handle_delete_album,
    "move_artist": _handle_move_artist,
    "wipe_library": _handle_wipe_library,
    "rebuild_library": _handle_rebuild_library,
    "reset_enrichment": _handle_reset_enrichment,
    "match_apply": _handle_match_apply,
    "update_album_tags": _handle_update_album_tags,
    "update_track_tags": _handle_update_track_tags,
    "resolve_duplicates": _handle_resolve_duplicates,
    "enrich_mbids": _handle_enrich_mbids,
    "sync_playlist_navidrome": _handle_sync_playlist_navidrome,
    "index_genres": _handle_index_genres,
    "compute_popularity": _handle_compute_popularity,
    "compute_bliss": _handle_compute_bliss,
    "process_new_content": _handle_process_new_content,
    "tidal_download": _handle_tidal_download,
    "check_new_releases": _handle_check_new_releases,
    "scan_missing_covers": _handle_scan_missing_covers,
    "apply_cover": _handle_apply_cover,
}
