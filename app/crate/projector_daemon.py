"""Standalone domain-event projector loop."""

from __future__ import annotations

import logging
import signal
import threading
import time

from crate.db.core import init_db

log = logging.getLogger(__name__)


def run_projector_loop(
    stop_event: threading.Event,
    *,
    interval_seconds: float = 5.0,
    limit: int = 200,
    home_warm_interval_seconds: float = 600.0,
) -> None:
    """Consume domain events and warm UI snapshots until stopped."""
    from crate.projector import process_domain_events, warm_recent_home_discovery_snapshots

    interval = max(0.5, float(interval_seconds))
    batch_limit = max(1, min(int(limit), 1000))
    home_warm_interval = max(0.0, float(home_warm_interval_seconds))
    last_home_warm = 0.0
    while not stop_event.is_set():
        try:
            result = process_domain_events(limit=batch_limit)
            if result.get("processed"):
                log.info(
                    "Processed %d domain events (ops=%d, home=%d)",
                    result.get("processed", 0),
                    result.get("ops_refreshes", 0),
                    result.get("home_refreshes", 0),
                )
            if home_warm_interval > 0:
                now = time.monotonic()
                if now - last_home_warm >= home_warm_interval:
                    last_home_warm = now
                    warmed = warm_recent_home_discovery_snapshots()
                    if warmed:
                        log.info("Warmed home discovery snapshots for %d recent user(s)", warmed)
        except Exception:
            log.debug("Snapshot projector failed", exc_info=True)
        stop_event.wait(interval)
    log.info("Projector loop stopped")


def run_projector(
    config: dict | None = None,
    *,
    interval_seconds: float = 5.0,
    limit: int = 200,
) -> None:
    """Run the projector as its own long-lived process."""
    del config
    init_db()

    stop_event = threading.Event()

    def handle_signal(signum, frame):
        del frame
        log.info("Received signal %d, shutting projector down...", signum)
        stop_event.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log.info(
        "Projector daemon started (interval=%.1fs, limit=%d)",
        max(0.5, float(interval_seconds)),
        max(1, min(int(limit), 1000)),
    )
    run_projector_loop(
        stop_event,
        interval_seconds=interval_seconds,
        limit=limit,
    )


__all__ = ["run_projector", "run_projector_loop"]
