import json
import logging
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from musicdock.config import load_config
from musicdock.db import init_db, claim_next_task, update_task, save_scan_result, create_task, set_cache, get_cache, list_tasks, get_task
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


MAX_WORKERS = 3

_active_tasks: set[str] = set()


def _run_task(task: dict, config: dict):
    task_id = task["id"]
    task_type = task["type"]
    params = task.get("params", {})

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

    # Initial library sync
    try:
        sync = LibrarySync(config)
        log.info("Running initial library sync...")
        sync_result = sync.full_sync()
        log.info("Library sync complete: %s", sync_result)

        watcher = LibraryWatcher(config, sync)
        watcher.start()
    except Exception:
        log.exception("Library sync/watcher failed to start")

    log.info("Worker started with %d slots, polling for tasks...", MAX_WORKERS)

    _last_enrich_check = 0
    _last_import_check = 0
    _last_lib_sync = time.time()
    executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

    try:
        while not _shutdown:
            # Periodic import queue check every 60s
            if time.time() - _last_import_check > 60:
                _last_import_check = time.time()
                try:
                    config = load_config()
                    queue = ImportQueue(config)
                    count = len(queue.scan_pending())
                    set_cache("imports_pending", {"count": count})
                except Exception:
                    pass

            # Periodic incremental library sync every 30 min
            if time.time() - _last_lib_sync > 1800:
                _last_lib_sync = time.time()
                try:
                    sync = LibrarySync(load_config())
                    sync.full_sync()
                except Exception:
                    log.exception("Periodic library sync failed")

            # Periodic enrichment check every 6 hours
            if time.time() - _last_enrich_check > 21600:
                _last_enrich_check = time.time()
                pending = list_tasks(status="pending", task_type="enrich_artists", limit=1)
                running = list_tasks(status="running", task_type="enrich_artists", limit=1)
                if not pending and not running:
                    create_task("enrich_artists")

            # Only claim if we have free slots
            if len(_active_tasks) >= MAX_WORKERS:
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
    lib = Path(config["library_path"])
    artists = sorted([d.name for d in lib.iterdir() if d.is_dir() and not d.name.startswith(".")])
    total = len(artists)
    enriched = 0
    skipped = 0

    for i, name in enumerate(artists):
        if _shutdown or _is_cancelled(task_id):
            break

        artist_dir = lib / name
        has_photo = artist_dir.is_dir() and (artist_dir / "artist.jpg").exists()
        cached = get_cache(f"lastfm:artist:{name.lower()}", max_age_seconds=86400)

        if cached and has_photo:
            skipped += 1
        else:
            # Fetch Last.fm info if not cached
            if not cached:
                get_artist_info(name)
                time.sleep(0.25)

            # Fetch photo if missing
            if not has_photo and artist_dir.is_dir():
                img_data = get_best_artist_image(name)
                if img_data:
                    try:
                        (artist_dir / "artist.jpg").write_bytes(img_data)
                    except OSError:
                        pass
                time.sleep(0.25)

            enriched += 1

        if i % 10 == 0:
            update_task(task_id, progress=json.dumps({
                "artist": name, "done": i + 1, "total": total,
                "enriched": enriched, "skipped": skipped,
            }))

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


TASK_HANDLERS = {
    "scan": _handle_scan,
    "fix_issues": _handle_fix_issues,
    "fetch_cover": _handle_fetch_cover,
    "fetch_artist_covers": _handle_fetch_artist_covers,
    "fetch_artwork_all": _handle_fetch_artwork_all,
    "batch_retag": _handle_batch_retag,
    "batch_covers": _handle_batch_covers,
    "compute_analytics": _handle_compute_analytics,
    "enrich_artists": _handle_enrich_artists,
    "library_sync": _handle_library_sync,
}
