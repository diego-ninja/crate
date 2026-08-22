import logging
import os
import threading
from collections.abc import Iterator, MutableMapping
from importlib import import_module

from crate.db.cache_store import set_cache
from crate.db.init_db import init_db
from crate.db.queries.tasks import get_task, get_task_activity_snapshot
from crate.db.repositories.tasks import (
    cleanup_zombie_tasks,
    redispatch_stale_pending_tasks,
)
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)


def _normalise_queues(value) -> list[str]:
    if isinstance(value, str):
        parts = value.replace(" ", ",").split(",")
    elif isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        parts = []
    queues = [str(part).strip() for part in parts if str(part).strip()]
    return queues or ["fast", "heavy", "default", "maintenance"]


def _env_int(name: str, default: int = 0) -> int:
    try:
        return int(os.environ.get(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


def _configured_worker_slots(config: dict) -> int:
    """Return real Dramatiq process capacity across split worker containers."""
    primary = int(config.get("worker_processes") or 0)
    split_workers = sum(
        _env_int(name)
        for name in (
            "FAST_WORKER_PROCESSES",
            "MAINTENANCE_WORKER_PROCESSES",
            "ANALYSIS_WORKER_PROCESSES",
            "PLAYBACK_WORKER_PROCESSES",
        )
    )
    return max(1, primary + split_workers)


def _is_cancelled(task_id: str) -> bool:
    try:
        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


def run_worker(config: dict):
    """Start Dramatiq workers + scheduler/watcher service loop."""
    import subprocess
    import signal
    import sys
    import threading

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    from crate.utils import init_musicbrainz

    queues = _normalise_queues(config.get("worker_queues"))
    start_service_loop = bool(config.get("worker_service_loop", True))
    start_analysis_daemons = bool(config.get("worker_analysis_daemons", True))
    start_projector = bool(config.get("worker_projector", True))
    start_telegram = bool(config.get("worker_telegram", True))

    init_db()
    init_musicbrainz()
    try:
        from crate.radio_engine import _load_radio_graphs

        _load_radio_graphs()
    except Exception:
        log.warning("Radio graph pre-warm failed", exc_info=True)

    # Runtime semaphores use TTLs and owner checks.  Do not clear them on
    # startup: another worker instance may still be doing real work.
    if "playback" in queues:
        from crate.worker_handlers.playback import prune_stream_transcode_slots

        prune_stream_transcode_slots()

    # Start scheduler + watcher + zombie cleanup in background thread
    service_stop = threading.Event()
    if start_service_loop:
        service_thread = threading.Thread(
            target=_run_service_loop,
            args=(config, service_stop),
            daemon=True,
        )
        service_thread.start()
        log.info("Service loop started (scheduler + watcher + zombie cleanup)")
    else:
        log.info("Service loop disabled for queues: %s", ",".join(queues))

    # Start background analysis daemons (independent of Dramatiq tasks)
    if start_analysis_daemons:
        from crate.analysis_daemon import analysis_daemon, bliss_daemon

        analysis_thread = threading.Thread(
            target=analysis_daemon,
            args=(config,),
            daemon=True,
            name="analysis-daemon",
        )
        bliss_thread = threading.Thread(
            target=bliss_daemon,
            args=(config,),
            daemon=True,
            name="bliss-daemon",
        )
        analysis_thread.start()
        bliss_thread.start()
        log.info("Background analysis daemons started")
    else:
        log.info(
            "Background analysis daemons disabled for queues: %s", ",".join(queues)
        )

    # Start projector daemon (domain events → snapshot warming)
    if start_projector:
        projector_thread = threading.Thread(
            target=_run_projector_loop,
            args=(service_stop,),
            daemon=True,
            name="projector",
        )
        projector_thread.start()
        log.info("Projector daemon started")
    else:
        log.info("Projector daemon disabled for queues: %s", ",".join(queues))

    # Start Telegram bot
    if start_telegram:
        from crate.telegram import telegram_bot_loop

        telegram_thread = threading.Thread(
            target=telegram_bot_loop,
            args=(config,),
            daemon=True,
            name="telegram-bot",
        )
        telegram_thread.start()

    # Start Dramatiq workers via CLI (this manages its own process pool)
    dramatiq_cmd = [
        sys.executable,
        "-m",
        "dramatiq",
        "crate.actors",
        "--processes",
        str(config.get("worker_processes", 6)),
        "--threads",
        "1",
        "--queues",
        *queues,
    ]
    log.info("Starting Dramatiq: %s", " ".join(dramatiq_cmd))
    proc = subprocess.Popen(dramatiq_cmd)

    def handle_signal(signum, frame):
        log.info("Received signal %d, shutting down...", signum)
        service_stop.set()
        proc.send_signal(signum)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    exit_code = proc.wait()
    service_stop.set()
    log.info("Dramatiq exited with code %d", exit_code)
    sys.exit(exit_code)


def _run_projector_loop(stop_event: threading.Event):
    """Dedicated thread: consume domain events from Redis Stream and warm snapshots."""
    from crate.projector_daemon import run_projector_loop

    run_projector_loop(stop_event, interval_seconds=5, limit=200)


def _cleanup_federation_imports(config: dict) -> int:
    import shutil
    from pathlib import Path, PurePosixPath

    from crate.db.jobs.federation_imports import expire_stale_imports

    library_path = Path(str(config.get("library_path") or "")).resolve()
    if not config.get("library_path"):
        return 0
    removed = 0
    for item in expire_stale_imports():
        raw = str(item.get("staging_relative_path") or "")
        relative = PurePosixPath(raw)
        if (
            relative.is_absolute()
            or len(relative.parts) < 3
            or relative.parts[:2] != (".imports", "federation")
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            continue
        target = (library_path / Path(*relative.parts)).resolve()
        if library_path not in target.parents:
            continue
        if target.exists():
            shutil.rmtree(target)
            removed += 1
    return removed


def _run_periodic_cleanup(config: dict | None = None) -> None:
    from crate.db.events import cleanup_old_events, cleanup_old_tasks
    from crate.db.repositories.auth import (
        cleanup_ended_jam_rooms,
        cleanup_expired_sessions,
    )
    from crate.db.repositories.recommendations import (
        delete_expired_recommendation_exposures,
    )
    from crate.db.worker_logs import cleanup_old_logs

    cleanup_old_events(max_age_hours=48)
    cleanup_old_tasks(max_age_days=7)
    cleanup_expired_sessions(max_age_days=3, stale_age_days=30)
    cleanup_ended_jam_rooms(max_age_days=30)
    delete_expired_recommendation_exposures()
    cleanup_old_logs(max_age_days=7)
    if config:
        _cleanup_federation_imports(config)


def _run_service_loop(config: dict, stop_event: threading.Event):
    """Background thread: scheduler checks, watcher, zombie cleanup, import queue."""
    import time as _time

    # Start filesystem watcher
    watcher = None
    try:
        from crate.library_sync import LibrarySync
        from crate.library_watcher import LibraryWatcher

        sync = LibrarySync(config)
        watcher = LibraryWatcher(config, sync)
        watcher.start()
        log.info("Filesystem watcher started")
    except Exception:
        log.warning("Library watcher failed to start", exc_info=True)

    last_schedule_check = 0
    last_zombie_check = 0
    last_pending_redispatch = 0
    last_import_check = 0
    last_cleanup = 0
    last_status_update = 0
    last_analysis_status_update = 0
    last_metrics_flush = 0
    last_shadow_backfill = 0
    last_media_worker_bridge = 0
    last_jam_auto_dj = 0

    while not stop_event.is_set():
        now = _time.time()

        # Detached Auto DJ rooms are driven by the worker, so playback keeps
        # advancing even when the host has disconnected.
        if now - last_jam_auto_dj > 3:
            last_jam_auto_dj = now
            try:
                from crate.jam_auto_dj import run_auto_dj_once

                run_auto_dj_once()
            except Exception:
                log.debug("Detached Jam Auto DJ tick failed", exc_info=True)

        # Scheduled tasks every 60s
        if now - last_schedule_check > 60:
            last_schedule_check = now
            try:
                from crate.scheduler import check_and_create_scheduled_tasks

                check_and_create_scheduled_tasks()
            except Exception:
                log.debug("Schedule check failed", exc_info=True)

        # Import queue scan every 60s
        if now - last_import_check > 60:
            last_import_check = now
            try:
                from crate.importer import ImportQueue
                from crate.config import load_config

                queue = ImportQueue(load_config())
                count = len(queue.refresh_pending_state())
                set_cache("imports_pending", {"count": count})
            except Exception:
                pass

        # Zombie task cleanup every 30s (heartbeat-based)
        if now - last_zombie_check > 30:
            last_zombie_check = now
            try:
                cleanup_zombie_tasks(
                    heartbeat_timeout_min=5, no_heartbeat_timeout_min=3
                )
            except Exception:
                log.debug("Zombie cleanup failed", exc_info=True)

        # Redispatch old pending DB tasks every minute.  The DB row is the
        # durable source of truth; this heals lost Dramatiq messages after
        # Redis restarts or post-commit dispatch failures.
        if now - last_pending_redispatch > 60:
            last_pending_redispatch = now
            try:
                redispatch_stale_pending_tasks(age_seconds=300, limit=100)
            except Exception:
                log.debug("Pending task redispatch failed", exc_info=True)

        # Worker status cache + queue depth metrics every 15s
        if now - last_status_update > 15:
            last_status_update = now
            try:
                from crate.db.ops_runtime import set_ops_runtime_state

                activity = get_task_activity_snapshot(
                    running_limit=100, pending_limit=100, recent_limit=10
                )
                running = activity["running_tasks"]
                pending = activity["pending_tasks"]
                recent = activity["recent_tasks"]
                max_workers = _configured_worker_slots(config)
                scan_running = next(
                    (task for task in running if task.get("type") == "scan"), None
                )
                worker_live = {
                    "engine": "dramatiq",
                    "running_count": int(activity["running_count"]),
                    "pending_count": int(activity["pending_count"]),
                    "running_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "pool": task.get("pool", "default"),
                            "progress": task.get("progress", ""),
                            "created_at": task.get("created_at"),
                            "started_at": task.get("started_at"),
                            "updated_at": task.get("updated_at"),
                        }
                        for task in running
                    ],
                    "pending_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "pool": task.get("pool", "default"),
                            "progress": task.get("progress", ""),
                            "created_at": task.get("created_at"),
                            "started_at": task.get("started_at"),
                            "updated_at": task.get("updated_at"),
                        }
                        for task in pending[:12]
                    ],
                    "recent_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "updated_at": task.get("updated_at"),
                        }
                        for task in recent
                    ],
                    "worker_slots": {
                        "max": max_workers,
                        "active": int(activity["running_count"]),
                    },
                    "queue_breakdown": activity.get("queue_breakdown")
                    or {
                        "running": {
                            "fast": 0,
                            "default": 0,
                            "heavy": 0,
                            "maintenance": 0,
                            "playback": 0,
                        },
                        "pending": {
                            "fast": 0,
                            "default": 0,
                            "heavy": 0,
                            "maintenance": 0,
                            "playback": 0,
                        },
                    },
                    "db_heavy_gate": activity.get("db_heavy_gate")
                    or {
                        "active": 0,
                        "pending": 0,
                        "blocking": False,
                    },
                    "scan": {
                        "running": scan_running is not None,
                        "progress": (scan_running or {}).get("progress", {})
                        if scan_running
                        else {},
                    },
                    "systems": {
                        "postgres": True,
                        "watcher": True,
                    },
                }
                set_cache(
                    "worker_status",
                    {
                        "running": int(activity["running_count"]),
                        "pending": int(activity["pending_count"]),
                        "engine": "dramatiq",
                    },
                    ttl=60,
                )
                set_ops_runtime_state("worker_live", worker_live)
                # Record queue depth as a metric
                try:
                    from crate.metrics import record

                    record("worker.queue.depth", int(activity["pending_count"]))
                    record("worker.queue.running", int(activity["running_count"]))
                except Exception:
                    pass
            except Exception:
                pass

        # Analysis coverage is expensive to compute; refresh it off the HTTP path.
        if now - last_analysis_status_update > 120:
            last_analysis_status_update = now
            try:
                from crate.analysis_daemon import get_analysis_status
                from crate.db.ops_runtime import set_ops_runtime_state
                from crate.db.queries.management import (
                    get_last_analyzed_track,
                    get_last_bliss_track,
                )

                status = get_analysis_status()
                set_ops_runtime_state(
                    "analysis_status",
                    {
                        **status,
                        "last_analyzed": get_last_analyzed_track(),
                        "last_bliss": get_last_bliss_track(),
                    },
                )
            except Exception:
                log.debug("Analysis status refresh failed", exc_info=True)

        # Metrics flush every 5 minutes
        if now - last_metrics_flush > 300:
            last_metrics_flush = now
            try:
                from crate.metrics import flush_to_postgres

                flush_to_postgres()
            except Exception:
                log.debug("Metrics flush failed", exc_info=True)

        # Media-worker Redis events → task progress/events every 2s.
        if now - last_media_worker_bridge > 2:
            last_media_worker_bridge = now
            try:
                from crate.media_worker_progress import bridge_media_worker_task_events

                bridge_media_worker_task_events(
                    limit=200, block_ms=0, consumer_name="service-loop"
                )
            except Exception:
                log.debug("Media-worker event bridge failed", exc_info=True)

        # Incrementally backfill shadow pipeline read models every 30s
        if now - last_shadow_backfill > 30:
            last_shadow_backfill = now
            try:
                from crate.db.jobs.analysis import backfill_pipeline_read_models

                result = backfill_pipeline_read_models(limit=1000)
                if any(result.values()):
                    log.info(
                        "Pipeline shadow backfill: analysis=%d bliss=%d features=%d embeddings=%d",
                        result["processing_analysis"],
                        result["processing_bliss"],
                        result["analysis_features"],
                        result["bliss_embeddings"],
                    )
            except Exception:
                log.debug("Pipeline shadow backfill failed", exc_info=True)

        # Old task/event/log cleanup every hour
        if now - last_cleanup > 3600:
            last_cleanup = now
            try:
                _run_periodic_cleanup(config)
            except Exception:
                log.debug("Auto-cleanup failed")

        stop_event.wait(2)

    # Shutdown watcher
    if watcher:
        try:
            watcher.stop()
        except Exception:
            pass
    log.info("Service loop stopped")


_HANDLER_GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "crate.worker_handlers.acquisition",
        "ACQUISITION_TASK_HANDLERS",
        (
            "tidal_download",
            "check_new_releases",
            "soulseek_download",
            "cleanup_incomplete_downloads",
            "library_upload",
            "import_queue_item",
            "import_queue_all",
            "import_queue_remove",
            "remux_m4a_dash",
        ),
    ),
    (
        "crate.worker_handlers.federation",
        "FEDERATION_TASK_HANDLERS",
        (
            "federation_sync_catalog",
            "federation_health_poll",
            "federation_import_album",
            "federation_directory_refresh",
        ),
    ),
    (
        "crate.worker_handlers.global_catalog",
        "GLOBAL_CATALOG_TASK_HANDLERS",
        (
            "global_catalog_reconcile_incremental",
            "global_catalog_reconcile_full",
        ),
    ),
    (
        "crate.worker_handlers.analysis",
        "ANALYSIS_TASK_HANDLERS",
        (
            "compute_analytics",
            "refresh_user_listening_stats",
            "refresh_home_discovery_snapshot",
            "refresh_user_stats_dashboard_snapshot",
            "index_genres",
            "infer_genre_taxonomy",
            "rebuild_genre_taxonomy_proposals",
            "enrich_genre_descriptions",
            "sync_musicbrainz_genre_graph",
            "cleanup_invalid_genre_taxonomy",
            "compute_popularity",
            "backfill_track_audio_fingerprints",
            "analyze_tracks",
            "analyze_all",
            "analyze_album_full",
            "compute_bliss",
        ),
    ),
    (
        "crate.worker_handlers.artwork",
        "ARTWORK_TASK_HANDLERS",
        (
            "materialize_artwork_variants",
            "compose_artist_hero",
            "preview_artist_hero",
            "recompose_artist_hero",
            "derive_artist_hero",
            "backfill_artist_heroes",
            "backfill_artwork_variants",
            "cleanup_artwork_variants",
            "repair_artwork_variants",
            "resolve_external_artist_artwork",
            "fetch_cover",
            "fetch_album_cover",
            "fetch_artist_covers",
            "fetch_artwork_all",
            "batch_covers",
            "scan_missing_covers",
            "apply_cover",
            "assign_artist_artwork_slot",
            "delete_artist_artwork_asset",
            "delete_artist_hero_composition",
            "import_artist_artwork_asset",
            "upload_image",
        ),
    ),
    (
        "crate.worker_handlers.enrichment",
        "ENRICHMENT_TASK_HANDLERS",
        (
            "enrich_artist",
            "enrich_artists",
            "sync_lyrics",
            "reset_enrichment",
            "enrich_mbids",
            "process_new_content",
            "compute_completeness",
            "refresh_probable_setlist",
            "normalize_artist_bios",
            "research_artist_bio",
        ),
    ),
    (
        "crate.worker_handlers.jam",
        "JAM_TASK_HANDLERS",
        ("prime_jam_auto_dj",),
    ),
    (
        "crate.worker_handlers.integrations",
        "INTEGRATION_TASK_HANDLERS",
        (
            "sync_shows",
            "backfill_similarities",
        ),
    ),
    (
        "crate.worker_handlers.bandcamp",
        "BANDCAMP_TASK_HANDLERS",
        (
            "bandcamp_connect_credentials",
            "bandcamp_sync_collection",
            "bandcamp_import_purchase",
            "bandcamp_radar_refresh",
            "bandcamp_backfill_entity_urls",
            "bandcamp_withdraw_contribution",
            "bandcamp_cleanup_user_contributions",
        ),
    ),
    (
        "crate.worker_handlers.contributions",
        "CONTRIBUTION_TASK_HANDLERS",
        (
            "library_withdraw_contribution",
            "library_cleanup_user_contributions",
        ),
    ),
    (
        "crate.worker_handlers.library",
        "LIBRARY_TASK_HANDLERS",
        (
            "scan",
            "fix_issues",
            "batch_retag",
            "library_sync",
        ),
    ),
    (
        "crate.worker_handlers.management",
        "MANAGEMENT_TASK_HANDLERS",
        (
            "health_check",
            "repair",
            "repair_duplicate_tracks",
            "library_pipeline",
            "delete_artist",
            "delete_album",
            "library_track_quarantine",
            "library_track_restore",
            "library_track_hard_delete",
            "library_quarantined_track_hard_delete",
            "library_quarantined_tracks_hard_delete_all",
            "library_track_move",
            "library_album_move_to_artist",
            "library_album_merge",
            "library_album_split",
            "library_artist_merge",
            "move_artist",
            "wipe_library",
            "rebuild_library",
            "match_apply",
            "update_artist_metadata",
            "update_album_tags",
            "update_track_tags",
            "resolve_duplicates",
            "generate_system_playlist",
            "refresh_system_smart_playlists",
            "persist_playlist_cover",
            "draft_i18n_translation",
            "write_portable_metadata",
            "rehydrate_portable_metadata",
            "export_rich_metadata",
        ),
    ),
    (
        "crate.worker_handlers.migration",
        "MIGRATION_TASK_HANDLERS",
        (
            "migrate_storage_v2",
            "fix_artist",
            "verify_storage_v2",
        ),
    ),
    (
        "crate.worker_handlers.playback",
        "PLAYBACK_TASK_HANDLERS",
        (
            "prepare_stream_variant",
            "warmup_stream_variants",
            "cleanup_stream_variants",
        ),
    ),
)


class LazyTaskHandlers(MutableMapping[str, TaskHandler]):
    """Mapping-compatible task registry that imports handler modules on demand."""

    def __init__(self, groups: tuple[tuple[str, str, tuple[str, ...]], ...]) -> None:
        task_modules: dict[str, tuple[str, str]] = {}
        for module_name, attr_name, task_types in groups:
            for task_type in task_types:
                if task_type in task_modules:
                    raise AssertionError(
                        f"Duplicate task_type in handlers: {task_type}"
                    )
                task_modules[task_type] = (module_name, attr_name)
        self._task_modules = task_modules
        self._loaded_groups: dict[tuple[str, str], dict[str, TaskHandler]] = {}
        self._overrides: dict[str, TaskHandler] = {}

    def _load_group(self, module_name: str, attr_name: str) -> dict[str, TaskHandler]:
        key = (module_name, attr_name)
        if key not in self._loaded_groups:
            module = import_module(module_name)
            handlers = getattr(module, attr_name)
            self._loaded_groups[key] = dict(handlers)
        return self._loaded_groups[key]

    def __getitem__(self, task_type: str) -> TaskHandler:
        if task_type in self._overrides:
            return self._overrides[task_type]
        module_name, attr_name = self._task_modules[task_type]
        return self._load_group(module_name, attr_name)[task_type]

    def __setitem__(self, task_type: str, handler: TaskHandler) -> None:
        self._overrides[task_type] = handler

    def __delitem__(self, task_type: str) -> None:
        if task_type in self._overrides:
            del self._overrides[task_type]
            return
        raise KeyError(task_type)

    def __iter__(self) -> Iterator[str]:
        return iter({*self._task_modules, *self._overrides})

    def __len__(self) -> int:
        return len({*self._task_modules, *self._overrides})


TASK_HANDLERS: MutableMapping[str, TaskHandler] = LazyTaskHandlers(_HANDLER_GROUPS)
