import json
import logging
import shutil
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from musicdock.config import load_config
from musicdock.db import init_db, claim_next_task, update_task, save_scan_result, create_task, create_task_dedup, set_cache, get_cache, list_tasks, get_task, get_setting, get_db_ctx, emit_task_event
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
_stale_task_ids: set[str] = set()  # tasks that failed but couldn't be marked in DB
_watcher = None  # LibraryWatcher ref for processing lock

# Tasks that do heavy DB writes — only one at a time
DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids"}
CHUNK_SIZE = 10  # artists per chunk for parallel processing
_db_heavy_running = False
_db_heavy_lock = threading.Lock()


def _run_task(task: dict, config: dict):
    global _db_heavy_running
    task_id = task["id"]
    task_type = task["type"]
    params = task.get("params", {})
    is_db_heavy = task_type in DB_HEAVY_TASKS

    if is_db_heavy:
        with _db_heavy_lock:
            if _db_heavy_running:
                # Re-queue: another DB-heavy task is running — backoff to avoid busy loop
                update_task(task_id, status="pending", progress="Waiting for DB-heavy task to finish")
                time.sleep(10)
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
        try:
            update_task(task_id, status="failed", error=str(e))
        except Exception:
            log.error("Could not mark task %s as failed (DB unavailable?)", task_id)
            _stale_task_ids.add(task_id)
    finally:
        _active_tasks.discard(task_id)
        if is_db_heavy:
            with _db_heavy_lock:
                _db_heavy_running = False


def _compute_dir_hash(directory: Path) -> str:
    """Fast hash of directory contents: sorted file paths + sizes."""
    import hashlib
    h = hashlib.md5(usedforsecurity=False)
    for f in sorted(directory.rglob("*")):
        if f.is_file():
            h.update(f"{f.relative_to(directory)}:{f.stat().st_size}\n".encode())
    return h.hexdigest()


def run_worker(config: dict):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    init_db()

    from musicdock.utils import init_musicbrainz
    init_musicbrainz()

    # Clean up orphaned tasks from previous worker crash/restart
    orphaned = list_tasks(status="running")
    for t in orphaned:
        log.warning("Marking orphaned task %s (type=%s) as failed", t["id"], t["type"])
        update_task(t["id"], status="failed", error="Orphaned: worker restarted while task was running")

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
    _last_cleanup = 0.0
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

            # Auto-cleanup old tasks + events every hour + recover zombie tasks
            if time.time() - _last_cleanup > 3600:
                _last_cleanup = time.time()
                try:
                    from musicdock.db.events import cleanup_old_events, cleanup_old_tasks
                    cleanup_old_events(max_age_hours=48)
                    cleanup_old_tasks(max_age_days=7)
                except Exception:
                    log.debug("Auto-cleanup failed")
                # Reset tasks stuck in 'running' that aren't actually active in this worker
                try:
                    zombie = list_tasks(status="running")
                    for t in zombie:
                        if t["id"] not in _active_tasks:
                            log.warning("Resetting zombie task %s (type=%s) to failed", t["id"], t["type"])
                            update_task(t["id"], status="failed", error="Zombie: stuck in running without active worker")
                except Exception:
                    log.debug("Zombie cleanup failed")

            # Retry marking stale tasks as failed (from previous DB outage)
            if _stale_task_ids:
                recovered = set()
                for stale_id in list(_stale_task_ids):
                    try:
                        update_task(stale_id, status="failed", error="Worker lost DB connection during execution")
                        recovered.add(stale_id)
                        log.info("Recovered stale task %s → failed", stale_id)
                    except Exception:
                        break  # DB still down, stop trying
                _stale_task_ids.difference_update(recovered)

            # Read dynamic slot count from settings
            current_max = int(get_setting("max_workers", str(MAX_WORKERS)) or MAX_WORKERS)

            # Only claim if we have free slots
            if len(_active_tasks) >= current_max:
                time.sleep(CLAIM_RETRY_INTERVAL)
                continue

            task = claim_next_task(max_running=current_max)
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
    set_cache("analytics", data, ttl=3600)

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
    set_cache("stats", stats, ttl=3600)

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
            emit_task_event(task_id, "artist_skipped", {"message": f"Skipped: {name}", "artist": name})
        else:
            enriched += 1
            emit_task_event(task_id, "artist_enriched", {"message": f"Enriched: {name}", "artist": name, "sources": result})

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


def _handle_analyze_album_full(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio (BPM, key, mood) + compute bliss vectors for a single album."""
    from musicdock.audio_analysis import analyze_track, analyze_batch, PANNS_BATCH_SIZE
    from musicdock.db import get_library_albums, get_library_tracks, update_track_audiomuse, get_library_album

    artist = params.get("artist", "")
    album_name = params.get("album", "")

    # Phase 1: Audio analysis
    update_task(task_id, progress=json.dumps({"phase": "audio_analysis", "done": 0, "total": 0}))
    analysis_result = _handle_analyze_tracks(task_id, {"artist": artist, "album": album_name}, config)

    # Phase 2: Bliss vectors
    update_task(task_id, progress=json.dumps({"phase": "bliss", "done": 0, "total": 0}))
    from musicdock.bliss import is_available, analyze_directory, store_vectors
    bliss_count = 0
    if is_available():
        album_data = get_library_album(artist, album_name)
        if album_data:
            album_path = album_data.get("path", "")
            if album_path and Path(album_path).is_dir():
                vectors = analyze_directory(str(album_path))
                if vectors:
                    store_vectors(vectors)
                    bliss_count = len(vectors)
    else:
        lib = Path(config["library_path"])
        from musicdock.db import get_library_artist
        artist_data = get_library_artist(artist)
        folder = (artist_data.get("folder_name") if artist_data else None) or artist
        artist_dir = lib / folder
        if artist_dir.is_dir():
            vectors = analyze_directory(str(artist_dir)) if is_available() else []
            if vectors:
                store_vectors(vectors)
                bliss_count = len(vectors)

    return {
        "analyzed": analysis_result.get("analyzed", 0),
        "failed": analysis_result.get("failed", 0),
        "bliss": bliss_count,
    }


def _handle_analyze_tracks(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio tracks for BPM, key, energy, mood. Uses batched PANNs inference."""
    from musicdock.audio_analysis import analyze_track, analyze_batch, PANNS_BATCH_SIZE
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
            tracks_to_analyze = [(t["path"], t) for t in tracks if not t.get("bpm") or t.get("energy") is None]
    elif artist:
        # All albums for artist
        albums = get_library_albums(artist)
        for a in albums:
            tracks = get_library_tracks(a["id"])
            tracks_to_analyze.extend((t["path"], t) for t in tracks if not t.get("bpm") or t.get("energy") is None)
    elif params.get("artists"):
        # Chunk mode: specific artists
        for a_name in params["artists"]:
            albums = get_library_albums(a_name)
            for a in albums:
                tracks = get_library_tracks(a["id"])
                tracks_to_analyze.extend((t["path"], t) for t in tracks if not t.get("bpm") or t.get("energy") is None)
    else:
        # Coordinator mode: split into chunks
        from musicdock.db import get_library_artists
        all_artists, total = get_library_artists(per_page=10000)

        # Filter to artists that have unanalyzed tracks (no BPM or no ML fields)
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT al.artist FROM library_tracks t "
                "JOIN library_albums al ON t.album_id = al.id "
                "WHERE t.bpm IS NULL OR t.energy IS NULL "
                "GROUP BY al.artist"
            )
            need_names = {r["artist"] for r in cur.fetchall()}
        need_analysis = [a for a in all_artists if a["name"] in need_names]

        if len(need_analysis) > CHUNK_SIZE:
            # Chunk and distribute
            emit_task_event(task_id, "info", {"message": f"Splitting {len(need_analysis)} artists into chunks..."})
            return _chunk_coordinator(task_id, params, config, "analyze_all")

        # Small enough to run directly
        for a in need_analysis:
            albums = get_library_albums(a["name"])
            for al in albums:
                tracks = get_library_tracks(al["id"])
                tracks_to_analyze.extend((t["path"], t) for t in tracks if not t.get("bpm"))

    total = len(tracks_to_analyze)
    analyzed = 0
    failed = 0
    batch_size = PANNS_BATCH_SIZE

    # Process in batches for PANNs efficiency
    for batch_start in range(0, total, batch_size):
        if _shutdown or _is_cancelled(task_id):
            break

        batch = tracks_to_analyze[batch_start:batch_start + batch_size]
        batch_paths = [p for p, _ in batch]

        update_task(task_id, progress=json.dumps({
            "track": batch[0][1].get("title", Path(batch[0][0]).stem),
            "done": batch_start, "total": total,
            "analyzed": analyzed,
        }))

        try:
            results = analyze_batch(batch_paths)
            for (path, _track), result in zip(batch, results):
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
            log.warning("Batch analysis failed for %d tracks", len(batch), exc_info=True)
            # Fallback: try individually
            for path, _track in batch:
                try:
                    result = analyze_track(path)
                    if result.get("bpm") is not None:
                        update_track_audiomuse(
                            path, bpm=result["bpm"], key=result["key"],
                            scale=result["scale"], energy=result["energy"],
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
    set_cache("health_report", report, ttl=3600)
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
            set_cache("health_report", report, ttl=3600)

    # Mark affected artists so watcher ignores FS changes during repair
    affected_artists = set()
    for issue in report.get("issues", []):
        d = issue.get("details") or issue.get("details_json") or {}
        artist = d.get("artist") or d.get("db_artist") or ""
        if artist:
            affected_artists.add(artist)
    if _watcher and not dry_run:
        for a in affected_artists:
            _watcher.mark_processing(a)

    try:
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
    finally:
        if _watcher and not dry_run:
            for a in affected_artists:
                _watcher.unmark_processing(a)


def _handle_library_pipeline(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.health_check import LibraryHealthCheck
    from musicdock.repair import LibraryRepair
    from musicdock.navidrome import start_scan
    from musicdock.scheduler import mark_run

    emit_task_event(task_id, "info", {"message": "Pipeline: running health check..."})
    update_task(task_id, progress=json.dumps({"phase": "health_check"}))
    if _is_cancelled(task_id): return {"status": "cancelled"}
    checker = LibraryHealthCheck(config)
    report = checker.run(
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "health_check"}))
    )
    set_cache("health_report", report, ttl=3600)

    if _is_cancelled(task_id): return {"status": "cancelled"}
    emit_task_event(task_id, "info", {"message": "Pipeline: running repair..."})
    update_task(task_id, progress=json.dumps({"phase": "repair"}))
    repairer = LibraryRepair(config)
    repair_result = repairer.repair(
        report, dry_run=False, auto_only=True, task_id=task_id,
        progress_callback=lambda d: update_task(task_id, progress=json.dumps({**d, "phase": "repair"})),
    )

    if _is_cancelled(task_id): return {"status": "cancelled"}
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

    # Find album in DB (handles year-prefix names and 3-level structure)
    from musicdock.db import get_db_ctx as _gdc
    db_path = None
    with _gdc() as cur:
        # Exact match
        cur.execute("SELECT path FROM library_albums WHERE artist = %s AND name = %s LIMIT 1", (artist_name, album_name))
        row = cur.fetchone()
        if not row:
            # Try year-prefix match
            cur.execute("SELECT path FROM library_albums WHERE artist = %s AND name LIKE %s LIMIT 1", (artist_name, f"% - {album_name}"))
            row = cur.fetchone()
        if row:
            db_path = row["path"]

    album_dir = Path(db_path) if db_path else lib / artist_name / album_name

    if mode == "full" and album_dir.is_dir():
        shutil.rmtree(str(album_dir))

    # Delete from DB using the actual DB path
    db_delete_album(db_path or str(album_dir))

    # Update artist counters
    artist_data = get_library_artist(artist_name)
    if artist_data:
        folder = artist_data.get("folder_name") or artist_name
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
    from musicdock.db import get_db_ctx, get_library_album

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    release = params.get("release", {})

    # Use resolved path from API if available, otherwise try to find it
    album_path_str = params.get("album_path", "")
    album_dir = Path(album_path_str) if album_path_str else lib / artist_folder / album_folder
    if not album_dir.is_dir():
        # Fallback: try year subdirs
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

    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    result = apply_match(album_dir, exts, release)
    updated_count = result.get("updated", 0)
    emit_task_event(task_id, "info", {"message": f"Applied MusicBrainz tags: {updated_count} tracks"})

    # Sync MBID to database
    mbid = result.get("mbid")
    rg_id = result.get("release_group_id")
    if mbid:
        try:
            # Find the actual DB path for this album
            album_db_path = str(album_dir)
            with get_db_ctx() as cur:
                cur.execute("SELECT path FROM library_albums WHERE path = %s", (album_db_path,))
                row = cur.fetchone()
                if not row:
                    cur.execute("SELECT path FROM library_albums WHERE artist = %s AND (name = %s OR name LIKE %s) LIMIT 1",
                                (artist_folder, album_folder, f"% - {album_folder}"))
                    row = cur.fetchone()
                if row:
                    album_db_path = row["path"]

            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_albums SET musicbrainz_albumid = %s WHERE path = %s",
                    (mbid, album_db_path),
                )
                if rg_id:
                    cur.execute(
                        "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE path = %s",
                        (rg_id, album_db_path),
                    )
                updated = cur.rowcount
            if updated:
                emit_task_event(task_id, "info", {"message": f"Synced MBID {mbid[:8]}... to DB"})
            else:
                log.warning("MBID update matched 0 rows for path=%s", album_db_path)
        except Exception as e:
            log.error("Failed to sync MBID to DB: %s", e, exc_info=True)

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

        # High-confidence match (>= 95): apply full tags (title, tracknumber, etc.)
        AUTO_APPLY_THRESHOLD = int(get_setting("mb_auto_apply_threshold", "95"))
        if best_score >= AUTO_APPLY_THRESHOLD and album_dir and album_dir.is_dir():
            try:
                from musicdock.matcher import apply_match
                apply_result = apply_match(album_dir, exts, best_release)
                log.info("Auto-applied MB tags for %s/%s (score=%d, updated=%d)",
                         artist_name, clean_album, best_score, apply_result.get("updated", 0))
                emit_task_event(task_id, "info", {
                    "message": f"Auto-applied tags: {artist_name}/{clean_album} (score {best_score}%)"
                })
            except Exception:
                log.warning("Auto-apply failed for %s/%s", artist_name, clean_album, exc_info=True)

        # Write MBIDs to DB — single connection for album + all its tracks
        release_mbid = best_release["mbid"]
        release_group_id = best_release.get("release_group_id", "")
        mb_tracks = best_release.get("tracks", [])

        with get_db_ctx() as cur:
            cur.execute(
                "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
                (release_mbid, album["id"]),
            )
            if release_group_id:
                cur.execute(
                    "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE id = %s",
                    (release_group_id, album["id"]),
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

        # Write MBID tags to files (for lower scores that didn't get full auto-apply)
        if best_score < AUTO_APPLY_THRESHOLD:
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
                    except Exception:
                        log.warning("Failed to write MBID tags to %s", track_path)

        # Re-sync album to DB if full tags were applied
        if best_score >= AUTO_APPLY_THRESHOLD and album_dir and album_dir.is_dir():
            try:
                from musicdock.library_sync import LibrarySync
                syncer = LibrarySync(config)
                syncer.sync_album(album_dir, artist_name)
            except Exception:
                log.warning("Re-sync after auto-apply failed for %s", album_name, exc_info=True)

        enriched += 1
        emit_task_event(task_id, "album_matched", {"message": f"Matched: {artist_name} / {clean_album} (score {best_score}%)", "artist": artist_name, "album": clean_album, "mbid": release_mbid, "score": best_score})
        log.info("Enriched %s / %s (score=%d, mbid=%s)",
                 artist_name, clean_album, best_score, release_mbid)
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

    try:
        return _tidal_download_inner(task_id, params, config, url, quality, download_id, lib)
    except Exception as e:
        # Ensure tidal_downloads never stays stuck in processing/downloading
        if download_id:
            try:
                update_tidal_download(download_id, status="failed", error=str(e)[:200])
            except Exception:
                pass
        raise


def _tidal_download_inner(task_id, params, config, url, quality, download_id, lib):
    from musicdock.tidal import download, move_to_library
    from musicdock.library_sync import LibrarySync
    from musicdock.db import update_tidal_download

    # 1. Download via tiddl
    artist_name = params.get("artist", "")
    album_name = params.get("album", "")
    desc = f"{artist_name} - {album_name}" if artist_name else url
    emit_task_event(task_id, "info", {"message": f"Downloading from Tidal: {desc}"})
    update_task(task_id, progress=json.dumps({"phase": "downloading", "artist": artist_name, "album": album_name, "url": url}))
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
    emit_task_event(task_id, "info", {"message": f"Moving {result.get('file_count', 0)} files to library"})
    update_task(task_id, progress=json.dumps({"phase": "moving", "files": result.get("file_count", 0)}))
    modified_artists = move_to_library(result["path"], str(lib))

    if not modified_artists:
        if download_id:
            update_tidal_download(download_id, status="failed", error="No files moved")
        return {"error": "No files were moved", "phase": "move"}

    # 2b. Download Tidal cover if provided and no cover exists yet
    cover_url = params.get("cover_url", "")
    if cover_url and modified_artists:
        for artist_name in modified_artists:
            album_name = params.get("album", "")
            if not album_name:
                continue
            album_dir = lib / artist_name / album_name
            if not album_dir.is_dir():
                # Try to find the album dir by scanning artist folder
                artist_dir = lib / artist_name
                if artist_dir.is_dir():
                    for d in artist_dir.iterdir():
                        if d.is_dir() and album_name.lower() in d.name.lower():
                            album_dir = d
                            break
            if album_dir.is_dir():
                cover_path = album_dir / "cover.jpg"
                if not cover_path.exists():
                    try:
                        import requests
                        resp = requests.get(cover_url, timeout=15)
                        if resp.status_code == 200 and len(resp.content) > 1000:
                            cover_path.write_bytes(resp.content)
                            log.info("Downloaded Tidal cover for %s/%s", artist_name, album_name)
                    except Exception:
                        log.debug("Failed to download Tidal cover", exc_info=True)

    # 3. Sync modified artists
    emit_task_event(task_id, "info", {"message": f"Syncing {', '.join(modified_artists)} to library"})
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
            create_task_dedup("process_new_content", {"artist": artist_name})
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
    now = datetime.now(timezone.utc).isoformat()
    if download_id:
        update_tidal_download(download_id, status="completed", completed_at=now)

    # Mark new release as downloaded if applicable
    new_release_id = params.get("new_release_id")
    if new_release_id:
        try:
            from musicdock.db import mark_release_downloaded
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


def _handle_check_new_releases(task_id: str, params: dict, config: dict) -> dict:
    """Check MusicBrainz for new releases. Compares against latest_release_date per artist."""
    from musicdock.db import (
        get_library_artists, get_db_ctx,
        upsert_new_release, mark_release_downloading,
    )
    from musicdock.musicbrainz_ext import get_artist_releases as mb_get_releases
    from musicdock import tidal as tidal_mod

    auto_download = get_setting("auto_download_new_releases", "false").lower() == "true"

    all_artists, total = get_library_artists(per_page=10000)
    if not all_artists:
        return {"checked": 0, "new_releases": 0}

    new_count = 0
    checked = 0

    for i, artist in enumerate(all_artists):
        if _shutdown or _is_cancelled(task_id):
            break

        name = artist["name"]
        mbid = artist.get("mbid")

        if i % 5 == 0:
            update_task(task_id, progress=json.dumps({
                "phase": "checking", "artist": name,
                "done": i, "total": total,
                "new_releases": new_count,
            }))

        if not mbid:
            continue

        try:
            mb_releases = mb_get_releases(mbid)
            if not mb_releases:
                checked += 1
                continue

            # The most recent release from MB (sorted desc by date)
            latest_mb = mb_releases[0]
            latest_mb_date = latest_mb.get("first_release_date", "")
            if not latest_mb_date:
                checked += 1
                continue

            # Compare against what we knew before
            known_date = artist.get("latest_release_date") or ""

            if not known_date:
                # First run: just save the latest date, don't flag as new
                with get_db_ctx() as cur:
                    cur.execute("UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
                                (latest_mb_date, name))
                checked += 1
                continue

            # Check if MB has anything newer than what we knew
            if latest_mb_date > known_date:
                # New release(s) detected — only the ones newer than known_date
                for release in mb_releases:
                    rd = release.get("first_release_date", "")
                    if not rd or rd <= known_date:
                        break  # sorted desc, so stop at first old one
                    title = release.get("title", "")
                    year = release.get("year", "")
                    if not title:
                        continue

                    # Find Tidal URL
                    tidal_url = tidal_id = cover_url = quality = ""
                    tracks = 0
                    try:
                        tr = tidal_mod.search(f"{name} {title}", content_type="albums", limit=3)
                        for ta in tr.get("albums", []):
                            if title.lower() in ta.get("title", "").lower() or ta.get("title", "").lower() in title.lower():
                                tidal_url = ta.get("url", "")
                                tidal_id = str(ta.get("id", ""))
                                cover_url = ta.get("cover", "")
                                tracks = ta.get("tracks", 0)
                                quality = ta.get("quality", "")
                                break
                    except Exception:
                        pass

                    release_id = upsert_new_release(
                        artist_name=name, album_title=title,
                        tidal_id=tidal_id, tidal_url=tidal_url,
                        cover_url=cover_url, year=year,
                        tracks=tracks, quality=quality,
                    )
                    new_count += 1
                    emit_task_event(task_id, "new_release_found", {
                        "message": f"New: {name} - {title} ({year})",
                        "artist": name, "album": title,
                    })

                    # Auto-download (max 1 per artist per scan)
                    if auto_download and tidal_url:
                        mark_release_downloading(release_id)
                        create_task("tidal_download", {
                            "url": tidal_url, "artist": name, "album": title,
                            "quality": get_setting("tidal_quality", "max"),
                            "new_release_id": release_id,
                        })
                        break  # only auto-download the newest one

                # Update known date
                with get_db_ctx() as cur:
                    cur.execute("UPDATE library_artists SET latest_release_date = %s WHERE name = %s",
                                (latest_mb_date, name))

            checked += 1
            time.sleep(1)  # MB rate limit
        except Exception:
            log.debug("New release check failed for %s", name)

    return {"checked": checked, "new_releases": new_count}


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
    artist_name = params.get("artist", "")
    album_folder = params.get("album", "")

    # Tell watcher to ignore changes while we write tags/photos
    if _watcher:
        _watcher.mark_processing(artist_name)
    try:
        return _process_new_content_inner(task_id, params, config, artist_name, album_folder)
    finally:
        if _watcher:
            _watcher.unmark_processing(artist_name)


def _process_new_content_inner(task_id, params, config, artist_name, album_folder):
    from musicdock.enrichment import enrich_artist
    from musicdock.genre_indexer import index_all_genres
    from musicdock.bliss import analyze_file as bliss_analyze, store_vectors, is_available as bliss_available
    from musicdock.audio_analysis import analyze_track
    from musicdock.db import (
        get_library_artist, get_library_albums, get_library_tracks,
        update_track_audiomuse, set_cache, get_cache,
        set_album_genres, get_or_create_genre, get_db_ctx,
    )
    from musicdock.popularity import _lastfm_get, _parse_int
    import re as _re

    lib = Path(config["library_path"])
    result = {"artist": artist_name, "album": album_folder, "steps": {}}

    # ── Skip if content hasn't changed (hash check) ──
    artist_row = get_library_artist(artist_name)
    folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
    artist_dir = lib / folder
    if artist_dir.is_dir():
        new_hash = _compute_dir_hash(artist_dir)
        old_hash = artist_row.get("content_hash") if artist_row else None
        if old_hash and new_hash == old_hash:
            log.info("Skipping %s — content unchanged (hash: %s)", artist_name, new_hash[:12])
            return {"artist": artist_name, "skipped": True, "reason": "content_unchanged"}

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
        emit_task_event(task_id, "step_done", {"message": f"Enriched: {artist_name}", "step": "enrich_artist", "result": enrich_result})
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

    # ── 4. Audio analysis (batched PANNs + Essentia) for new tracks ──
    update_task(task_id, progress=json.dumps({"step": "audio_analysis", "artist": artist_name}))
    try:
        from musicdock.audio_analysis import analyze_batch, PANNS_BATCH_SIZE
        analyzed = 0
        pending = []
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = get_library_tracks(album["id"])
            for t in tracks:
                if t.get("bpm") is not None and t.get("energy") is not None:
                    continue
                pending.append(t)

        # Process in batches
        for batch_start in range(0, len(pending), PANNS_BATCH_SIZE):
            if _shutdown or _is_cancelled(task_id):
                break
            batch = pending[batch_start:batch_start + PANNS_BATCH_SIZE]
            try:
                results_batch = analyze_batch([t["path"] for t in batch])
                for t, ar in zip(batch, results_batch):
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
                        emit_task_event(task_id, "track_analyzed", {
                            "message": f"Analyzed: {t.get('title', '')} — BPM {ar.get('bpm')}, key {ar.get('key')}",
                            "title": t.get("title", ""), "bpm": ar.get("bpm"), "key": ar.get("key"),
                        })
            except Exception:
                log.debug("Batch analysis failed for %d tracks", len(batch), exc_info=True)
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
        MAX_TRACK_POP = int(get_setting("max_track_popularity", "50"))
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

    # Save content hash so next run can skip if unchanged
    if artist_dir.is_dir():
        final_hash = _compute_dir_hash(artist_dir)
        with get_db_ctx() as cur:
            cur.execute("UPDATE library_artists SET content_hash = %s WHERE name = %s",
                        (final_hash, artist_name))

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

        # 3. Deezer
        if not cover_data:
            try:
                import requests as _requests
                resp = _requests.get("https://api.deezer.com/search/album",
                    params={"q": f"{artist} {album_name}", "limit": 5}, timeout=10)
                if resp.status_code == 200:
                    for item in resp.json().get("data", []):
                        if item.get("cover_xl"):
                            img_resp = _requests.get(item["cover_xl"], timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                                source = "deezer"
                                break
            except Exception:
                pass

        # 4. iTunes / Apple Music
        if not cover_data:
            try:
                import requests as _requests
                resp = _requests.get("https://itunes.apple.com/search",
                    params={"term": f"{artist} {album_name}", "media": "music", "entity": "album", "limit": 5}, timeout=10)
                if resp.status_code == 200:
                    for item in resp.json().get("results", []):
                        art_url = item.get("artworkUrl100", "").replace("100x100", "600x600")
                        if art_url:
                            img_resp = _requests.get(art_url, timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                                source = "itunes"
                                break
            except Exception:
                pass

        # 5. Last.fm album art
        if not cover_data:
            try:
                from musicdock.popularity import _lastfm_get
                data = _lastfm_get("album.getinfo", artist=artist, album=album_name, autocorrect="1")
                if data and "album" in data:
                    images = data["album"].get("image", [])
                    # Get largest image
                    for img in reversed(images):
                        url = img.get("#text", "")
                        if url and "noimage" not in url:
                            import requests as _requests
                            img_resp = _requests.get(url, timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                                source = "lastfm"
                                break
            except Exception:
                pass

        # 6. MusicBrainz search (if no MBID, search by name)
        if not cover_data and not (mbid and mbid.strip()):
            try:
                import musicbrainzngs
                results = musicbrainzngs.search_releases(artist=artist, release=album_name, limit=3)
                for r in results.get("release-list", []):
                    found_mbid = r.get("id")
                    if found_mbid:
                        caa_data = fetch_cover_from_caa(found_mbid)
                        if caa_data:
                            cover_data = caa_data
                            source = "coverartarchive"
                            break
                    time.sleep(0.5)
            except Exception:
                pass

        if cover_data:
            found += 1
            emit_task_event(task_id, "cover_found", {
                "message": f"Cover found: {artist} / {album_name} ({source})",
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
                    "message": f"Cover applied: {artist} / {album_name}",
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
        "message": f"Cover applied: {params.get('artist')} / {params.get('album')}",
        "artist": params.get("artist"), "album": params.get("album"),
    })

    return {"applied": True, "path": album_path}


def _chunk_coordinator(task_id: str, params: dict, config: dict, chunk_task_type: str, filter_fn=None) -> dict:
    """Generic coordinator: splits artists into chunks, creates sub-tasks, monitors progress."""
    from musicdock.db import get_library_artists

    all_artists, total = get_library_artists(per_page=10000)

    # Filter artists if needed (e.g. skip already-analyzed)
    if filter_fn:
        all_artists = [a for a in all_artists if filter_fn(a)]
        total = len(all_artists)

    if total == 0:
        return {"chunks": 0, "artists": 0, "message": "Nothing to process"}

    # Split into chunks
    chunks = []
    for i in range(0, total, CHUNK_SIZE):
        chunk_artists = [a["name"] for a in all_artists[i:i + CHUNK_SIZE]]
        chunks.append(chunk_artists)

    emit_task_event(task_id, "info", {"message": f"Split {total} artists into {len(chunks)} chunks"})

    # Create sub-tasks
    chunk_task_ids = []
    for i, chunk in enumerate(chunks):
        sub_id = create_task(chunk_task_type, {"artists": chunk, "chunk_index": i, "total_chunks": len(chunks)})
        chunk_task_ids.append(sub_id)

    # Monitor sub-tasks (with timeout)
    completed = 0
    coordinator_start = time.time()
    coordinator_timeout = 3600 * 6  # 6 hours max
    while completed < len(chunk_task_ids):
        if _shutdown or _is_cancelled(task_id):
            return {"status": "cancelled", "completed_chunks": completed}
        if time.time() - coordinator_start > coordinator_timeout:
            log.warning("Coordinator %s timed out after %ds", task_id, coordinator_timeout)
            return {"status": "timeout", "completed_chunks": completed, "total_chunks": len(chunks)}
        time.sleep(5)
        completed = 0
        failed = 0
        for sub_id in chunk_task_ids:
            task = get_task(sub_id)
            if task and task["status"] == "completed":
                completed += 1
            elif task and task["status"] == "failed":
                failed += 1
                completed += 1  # count as done
        update_task(task_id, progress=json.dumps({
            "chunks_done": completed, "chunks_total": len(chunks),
            "chunks_failed": failed, "artists_total": total,
        }))

    return {"chunks": len(chunks), "artists": total, "completed": completed}


def _handle_compute_bliss(task_id: str, params: dict, config: dict) -> dict:
    """Coordinator: splits into chunks for parallel bliss computation."""
    from musicdock.bliss import is_available
    if not is_available():
        return {"error": "grooveyard-bliss binary not found"}

    # If this is a chunk (has "artists" param), process directly
    if params.get("artists"):
        return _handle_bliss_chunk(task_id, params, config)

    # Coordinator: pre-compute which artists need bliss, then chunk
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bliss_vector IS NULL "
            "GROUP BY al.artist"
        )
        need_bliss_names = {r["artist"] for r in cur.fetchall()}

    return _chunk_coordinator(task_id, params, config, "compute_bliss",
                              filter_fn=lambda a: a["name"] in need_bliss_names)


def _handle_bliss_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for bliss vectors."""
    from musicdock.bliss import analyze_directory, store_vectors
    lib = Path(config["library_path"])
    artists = params.get("artists", [])
    analyzed = 0

    for i, name in enumerate(artists):
        if _shutdown or _is_cancelled(task_id):
            break
        # Find artist dir (check year subdirs too)
        from musicdock.db import get_library_artist
        artist = get_library_artist(name)
        folder = (artist.get("folder_name") if artist else None) or name
        artist_dir = lib / folder
        if not artist_dir.is_dir():
            continue

        update_task(task_id, progress=json.dumps({"artist": name, "done": i, "total": len(artists)}))
        vectors = analyze_directory(str(artist_dir))
        if vectors:
            store_vectors(vectors)
            analyzed += len(vectors)

    return {"analyzed": analyzed, "artists": len(artists)}


def _handle_compute_popularity(task_id: str, params: dict, config: dict) -> dict:
    """Coordinator: splits into chunks for parallel popularity fetching."""
    # If this is a chunk, process directly
    if params.get("artists"):
        return _handle_popularity_chunk(task_id, params, config)

    # Coordinator
    return _chunk_coordinator(task_id, params, config, "compute_popularity")


def _handle_popularity_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for popularity data using threads."""
    from musicdock.popularity import _lastfm_get, _parse_int, _normalize_popularity
    from concurrent.futures import ThreadPoolExecutor
    import re

    artists = params.get("artists", [])
    albums_fetched = 0
    tracks_fetched = 0

    for i, artist_name in enumerate(artists):
        if _shutdown or _is_cancelled(task_id):
            break
        update_task(task_id, progress=json.dumps({"artist": artist_name, "done": i, "total": len(artists)}))

        # Fetch album popularity
        with get_db_ctx() as cur:
            cur.execute("SELECT id, name, tag_album FROM library_albums WHERE artist = %s AND lastfm_listeners IS NULL", (artist_name,))
            albums = [dict(r) for r in cur.fetchall()]

        for album in albums:
            album_name = album.get("tag_album") or album["name"]
            album_name = re.sub(r"^\d{4}\s*-\s*", "", album_name)
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute("UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                                    (listeners, playcount, album["id"]))
                    albums_fetched += 1
            time.sleep(0.25)

        # Fetch track popularity (threaded, 3 concurrent)
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT t.id, t.title FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
                "WHERE a.artist = %s AND t.lastfm_listeners IS NULL AND t.title IS NOT NULL AND t.title != '' LIMIT 50",
                (artist_name,),
            )
            tracks = [dict(r) for r in cur.fetchall()]

        def fetch_track_pop(track):
            data = _lastfm_get("track.getinfo", artist=artist_name, track=track["title"], autocorrect="1")
            if data and "track" in data:
                info = data["track"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute("UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                                    (listeners, playcount, track["id"]))
                    return True
            return False

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(fetch_track_pop, tracks))
            tracks_fetched += sum(1 for r in results if r)

    # Normalize after chunk
    try:
        _normalize_popularity()
    except Exception:
        pass

    return {"albums_fetched": albums_fetched, "tracks_fetched": tracks_fetched, "artists": len(artists)}


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


def _handle_map_navidrome_ids(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.navidrome import map_library_ids
    result = map_library_ids()
    emit_task_event(task_id, "info", {"message": f"Mapped {result['artists']} artists, {result['albums']} albums, {result['tracks']} tracks"})
    return result


def _search_alternate_peers(task_id: str, artist: str, skip_username: str, failed_files: list[dict], config: dict):
    """Search Soulseek for each failed file from alternate peers."""
    import re
    from musicdock import soulseek
    quality_filter = get_setting("soulseek_quality", "flac")

    for d in failed_files:
        fname = d.get("filename", "")
        if not fname:
            continue
        track_name = re.sub(r"^\d+[\s._-]*", "", fname)
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
            for f in result.get("files", []):
                f_name = f.get("filename", "").replace("\\", "/").split("/")[-1]
                if track_name.lower() in f_name.lower():
                    try:
                        dl_result = soulseek.download_files(result["username"], [f])
                        if dl_result.get("enqueued"):
                            emit_task_event(task_id, "info", {"message": f"Downloading {track_name} from {result['username']}"})
                            found = True
                            break
                    except Exception:
                        pass
            if found:
                break
        if not found:
            emit_task_event(task_id, "info", {"message": f"No alternate source for: {track_name}"})

    # Wait for alternate downloads
    alt_wait = 0
    while alt_wait < 120:
        time.sleep(5)
        alt_wait += 5
        all_dl = soulseek.get_downloads()
        active = [dd for dd in all_dl if "Completed" not in dd.get("state", "") and "Errored" not in dd.get("state", "") and "Rejected" not in dd.get("state", "")]
        if not active:
            break


def _handle_soulseek_download(task_id: str, params: dict, config: dict) -> dict:
    """Monitor a Soulseek download, move files to library, and trigger enrichment."""
    from musicdock import soulseek
    import re

    artist = params.get("artist", "")
    album = params.get("album", "")
    file_count = params.get("file_count", 0)
    username = params.get("username", "")
    find_alternate = params.get("find_alternate", False)
    original_files = params.get("files", [])

    emit_task_event(task_id, "info", {"message": f"Downloading from {username}: {artist} - {album} ({file_count} files)"})

    # If peer already rejected, skip polling and go straight to alternate search
    if find_alternate:
        emit_task_event(task_id, "info", {"message": f"Searching alternate peers for {len(original_files)} file(s)..."})

        # Try to extract real artist name from file paths if artist looks wrong (single letter = slskd sort folder)
        if artist and len(artist) <= 2:
            for fp in original_files:
                parts = fp.replace("\\", "/").split("/")
                # Look for "Artist - Year - Album" pattern in path
                for part in parts:
                    if " - " in part and len(part) > 5:
                        artist = part.split(" - ")[0].strip()
                        break
                if len(artist) > 2:
                    break

        # Build fake failed_files list from original_files for the helper
        fake_failed = [{"filename": fp.replace("\\", "/").split("/")[-1], "fullPath": fp} for fp in original_files]
        _search_alternate_peers(task_id, artist, username, fake_failed, config)

        all_dl = soulseek.get_downloads()
        completed_files = [d for d in all_dl if "Completed" in d.get("state", "") and "Errored" not in d.get("state", "") and "Rejected" not in d.get("state", "")]

    if not find_alternate:
        # Normal flow: poll slskd for download completion, retry errored files
        max_wait = 900
        max_retries = 3
        elapsed = 0
        retries_done = 0
        completed_files = []
        while elapsed < max_wait:
            if _shutdown or _is_cancelled(task_id):
                return {"status": "cancelled"}
            time.sleep(5)
            elapsed += 5
            downloads = soulseek.get_downloads()
            user_downloads = [d for d in downloads if d.get("username") == username]
            if not user_downloads:
                break
            completed = sum(1 for d in user_downloads if "Completed" in d.get("state", "") and "Errored" not in d.get("state", "") and "Rejected" not in d.get("state", ""))
            failed = [d for d in user_downloads if "Errored" in d.get("state", "") or "Rejected" in d.get("state", "")]
            in_progress = sum(1 for d in user_downloads if "Completed" not in d.get("state", "") and "Errored" not in d.get("state", "") and "Rejected" not in d.get("state", ""))
            update_task(task_id, progress=json.dumps({"completed": completed, "errored": len(failed), "in_progress": in_progress, "total": file_count, "artist": artist}))
            if completed >= file_count:
                completed_files = [d for d in user_downloads if "Completed" in d.get("state", "") and "Errored" not in d.get("state", "") and "Rejected" not in d.get("state", "")]
                break
            if failed and in_progress == 0 and retries_done < max_retries:
                retryable = [d for d in failed if "Rejected" not in d.get("state", "")]
                if retryable:
                    retries_done += 1
                    emit_task_event(task_id, "info", {"message": f"Retrying {len(retryable)} errored files (attempt {retries_done}/{max_retries})"})
                    for d in retryable:
                        fp = d.get("fullPath", "")
                        if fp:
                            try: soulseek.download_files(username, [{"filename": fp, "size": d.get("size", 0)}])
                            except Exception: pass
                    time.sleep(5)
                else:
                    retries_done = max_retries
                continue
            if failed and in_progress == 0 and retries_done >= max_retries:
                # Switch to alternate peer search for remaining failed files
                emit_task_event(task_id, "info", {"message": f"{len(failed)} files failed. Searching alternate peers..."})
                _search_alternate_peers(task_id, artist, username, failed, config)
                all_dl = soulseek.get_downloads()
                completed_files = [d for d in all_dl if "Completed" in d.get("state", "") and "Errored" not in d.get("state", "") and "Rejected" not in d.get("state", "")]
                break

    # Only move if ALL files completed (album is complete)
    all_complete = len(completed_files) >= file_count
    lib = Path(config["library_path"])
    slsk_download_dir = Path("/downloads/soulseek")
    moved = 0

    if not all_complete:
        emit_task_event(task_id, "info", {"message": f"Album incomplete: {len(completed_files)}/{file_count} files. Not moving to library."})
        return {"artist": artist, "album": album, "source": "soulseek", "moved": 0, "completed": len(completed_files), "incomplete": True}

    if completed_files and artist:
        # Determine year from tags or album name
        year = ""
        year_match = re.search(r"(\d{4})", album)
        if year_match:
            year = year_match.group(1)

        # Clean album name
        clean_album = re.sub(r"^\d{4}\s*[-–]\s*", "", album).strip()
        clean_album = re.sub(r"\s*[\[\(](?:FLAC|flac|MP3|320).*?[\]\)]", "", clean_album).strip()
        if not clean_album:
            clean_album = album

        # Target: /music/Artist/Year/Album/
        if year:
            target_dir = lib / artist / year / clean_album
        else:
            target_dir = lib / artist / clean_album
        target_dir.mkdir(parents=True, exist_ok=True)

        # Find and move downloaded files
        if slsk_download_dir.is_dir():
            for dl in completed_files:
                # slskd stores files under the download dir with the remote path structure
                full_path = dl.get("fullPath", "")
                local_name = full_path.replace("\\", "/").split("/")[-1] if full_path else dl.get("filename", "")

                # Search for the file in slskd download directory
                found = None
                for f in slsk_download_dir.rglob(local_name):
                    if f.is_file():
                        found = f
                        break

                if found:
                    dest = target_dir / found.name
                    try:
                        shutil.move(str(found), str(dest))
                        moved += 1
                        log.info("Moved %s → %s", found.name, dest)
                    except Exception as e:
                        log.warning("Failed to move %s: %s", found.name, e)

        emit_task_event(task_id, "info", {"message": f"Moved {moved} files to {artist}/{year}/{clean_album}" if year else f"Moved {moved} files to {artist}/{clean_album}"})

    # Trigger process_new_content for the artist
    if artist and moved > 0:
        create_task_dedup("process_new_content", {"artist": artist})
        emit_task_event(task_id, "info", {"message": f"Processing new content for {artist}"})

    return {"artist": artist, "album": album, "source": "soulseek", "moved": moved, "completed": len(completed_files)}


def _handle_upload_image(task_id: str, params: dict, config: dict) -> dict:
    """Save uploaded image to the correct location in the library."""
    import base64
    from PIL import Image
    import io as _io

    img_type = params.get("type")  # "cover", "artist_photo", "background"
    artist = params.get("artist", "")
    album = params.get("album", "")
    data_b64 = params.get("data_b64", "")

    if not data_b64:
        return {"error": "No image data"}

    raw = base64.b64decode(data_b64)
    img = Image.open(_io.BytesIO(raw)).convert("RGB")
    lib = Path(config["library_path"])

    if img_type == "cover":
        from musicdock.db import get_library_album
        album_data = get_library_album(artist, album)
        if not album_data:
            return {"error": "Album not found"}
        dest = Path(album_data["path"]) / "cover.jpg"
        img.save(str(dest), "JPEG", quality=92)
    elif img_type == "artist_photo":
        dest = lib / artist / "artist.jpg"
        img.save(str(dest), "JPEG", quality=92)
        with get_db_ctx() as cur:
            cur.execute("UPDATE library_artists SET has_photo = 1 WHERE name = %s", (artist,))
    elif img_type == "background":
        dest = lib / artist / "background.jpg"
        img.save(str(dest), "JPEG", quality=90)
    else:
        return {"error": f"Unknown image type: {img_type}"}

    log.info("Image uploaded: %s for %s (%dx%d)", img_type, artist, img.width, img.height)

    # Trigger Navidrome rescan for cover changes
    if img_type == "cover":
        try:
            from musicdock.navidrome import start_scan
            start_scan()
        except Exception:
            pass

    return {"type": img_type, "path": str(dest), "width": img.width, "height": img.height}


def _handle_cleanup_incomplete_downloads(task_id: str, params: dict, config: dict) -> dict:
    """Clean up incomplete Soulseek downloads: remove dirs with partial albums."""
    import shutil

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
            audio_files = [f for f in album_dir.iterdir()
                           if f.suffix.lower() in (".flac", ".mp3", ".ogg", ".opus", ".m4a")]
            # An album is "incomplete" if it has some files but fewer than expected
            # Simple heuristic: fewer than 3 tracks and dir older than 48h
            if 0 < len(audio_files) < 3:
                import datetime
                age = datetime.datetime.now() - datetime.datetime.fromtimestamp(album_dir.stat().st_mtime)
                if age.total_seconds() > 48 * 3600:
                    shutil.rmtree(album_dir, ignore_errors=True)
                    details.append(str(album_dir))
                    cleaned += 1
            elif len(audio_files) == 0:
                # Empty dir — remove
                shutil.rmtree(album_dir, ignore_errors=True)
                cleaned += 1

        # Clean up empty user dirs
        if user_dir.exists() and not any(user_dir.iterdir()):
            user_dir.rmdir()

    # Also clear completed/errored from slskd
    from musicdock.soulseek import clear_completed_downloads, clear_errored_downloads
    clear_completed_downloads()
    clear_errored_downloads()

    return {"cleaned": cleaned, "details": details}


TASK_HANDLERS = {
    "scan": _handle_scan,
    "analyze_tracks": _handle_analyze_tracks,
    "analyze_all": _handle_analyze_tracks,
    "analyze_album_full": _handle_analyze_album_full,
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
    "soulseek_download": _handle_soulseek_download,
    "check_new_releases": _handle_check_new_releases,
    "scan_missing_covers": _handle_scan_missing_covers,
    "apply_cover": _handle_apply_cover,
    "map_navidrome_ids": _handle_map_navidrome_ids,
    "cleanup_incomplete_downloads": _handle_cleanup_incomplete_downloads,
    "upload_image": _handle_upload_image,
}
