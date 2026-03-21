import json
import logging
import shutil
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from musicdock.config import load_config
from musicdock.db import init_db, claim_next_task, update_task, save_scan_result, create_task, set_cache, get_cache, list_tasks, get_task, get_setting, get_db_ctx
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

_active_tasks: set[str] = set()

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
        sync = LibrarySync(config)
        watcher = LibraryWatcher(config, sync)
        watcher.start()
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
            if time.time() - _last_import_check > 60:
                _last_import_check = time.time()
                try:
                    queue = ImportQueue(load_config())
                    count = len(queue.scan_pending())
                    set_cache("imports_pending", {"count": count})
                except Exception:
                    pass

            # Check scheduled tasks every 60s
            if time.time() - _last_schedule_check > 60:
                _last_schedule_check = time.time()
                try:
                    check_and_create_scheduled_tasks()
                except Exception:
                    log.debug("Schedule check failed")

            # Read dynamic slot count from settings
            current_max = int(get_setting("max_workers", str(MAX_WORKERS)) or MAX_WORKERS)

            # Only claim if we have free slots
            if len(_active_tasks) >= current_max:
                time.sleep(0.5)
                continue

            task = claim_next_task()
            if not task:
                time.sleep(1)
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
        else:
            enriched += 1

    return {"enriched": enriched, "skipped": skipped, "total": total}


def _handle_library_sync(task_id: str, params: dict, config: dict) -> dict:
    sync = LibrarySync(config)
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
    return enrich_artist(name, config, force=True)


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
    return {"issue_count": len(report.get("issues", [])), "summary": report.get("summary", {})}


def _handle_repair(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.repair import LibraryRepair
    from musicdock.navidrome import start_scan

    dry_run = params.get("dry_run", True)
    auto_only = params.get("auto_only", True)

    # Get latest health report
    report = get_cache("health_report")
    if not report:
        # Run health check first
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

    if not dry_run and result.get("fs_changed"):
        start_scan()

    return result


def _handle_library_pipeline(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.health_check import LibraryHealthCheck
    from musicdock.repair import LibraryRepair
    from musicdock.navidrome import start_scan
    from musicdock.scheduler import mark_run

    update_task(task_id, progress=json.dumps({"phase": "health_check"}))
    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "health_check"}))
    )
    set_cache("health_report", report)

    update_task(task_id, progress=json.dumps({"phase": "repair"}))
    repairer = LibraryRepair(config)
    repair_result = repairer.repair(
        report, dry_run=False, auto_only=True, task_id=task_id,
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "repair"})),
    )

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

    log_audit("move_artist", "artist", name,
              details={"new_name": new_name}, task_id=task_id)
    start_scan()

    return {"moved": name, "new_name": new_name}


def _handle_wipe_library(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import wipe_library_tables, log_audit

    wipe_library_tables()
    log_audit("wipe_library", "database", "library", task_id=task_id)

    if params.get("rebuild"):
        create_task("rebuild_library")

    return {"wiped": True, "rebuild": params.get("rebuild", False)}


def _handle_rebuild_library(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.db import wipe_library_tables, log_audit

    update_task(task_id, progress=json.dumps({"phase": "wipe"}))
    wipe_library_tables()
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

    return {"kept": keep, "removed": removed}


def _handle_match_apply(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.matcher import apply_match

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    release = params.get("release", {})

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    result = apply_match(album_dir, exts, release)
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
        log.info("Enriched %s / %s (score=%d, mbid=%s, files=%d)",
                 artist_name, clean_album, best_score, release_mbid, written_files)
        time.sleep(1)  # MB rate limit: 1 req/sec

    return {"enriched": enriched, "skipped": skipped, "failed": failed, "total": total}


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
}
