import logging
import re
import time
import threading

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from librarian.scanner import LibraryScanner
from librarian.fixer import LibraryFixer
from librarian.report import save_report

log = logging.getLogger(__name__)


def parse_interval(interval: str) -> int:
    """Parse interval string like '6h', '30m', '1d' to seconds."""
    match = re.match(r"(\d+)\s*([smhd])", interval)
    if not match:
        return 21600  # default 6h
    value, unit = int(match.group(1)), match.group(2)
    multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    return value * multipliers[unit]


class LibraryEventHandler(FileSystemEventHandler):
    def __init__(self, config: dict):
        self.config = config
        self._debounce_timer = None
        self._lock = threading.Lock()

    def on_any_event(self, event):
        if event.is_directory:
            return
        # Debounce: wait 30s after last event before scanning
        with self._lock:
            if self._debounce_timer:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(30.0, self._run_scan)
            self._debounce_timer.start()

    def _run_scan(self):
        log.info("Change detected, running scan...")
        try:
            scanner = LibraryScanner(self.config)
            issues = scanner.scan()
            fixer = LibraryFixer(self.config)
            fixer.fix(issues, dry_run=True)
            save_report(issues, self.config)
        except Exception:
            log.exception("Scan failed")


def run_daemon(config: dict):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    library_path = config["library_path"]
    interval = parse_interval(config.get("scan_interval", "6h"))

    log.info("Starting librarian daemon")
    log.info("Library: %s", library_path)
    log.info("Scan interval: %ds", interval)

    # Watchdog
    observer = None
    if config.get("watch_enabled", True):
        handler = LibraryEventHandler(config)
        observer = Observer()
        observer.schedule(handler, library_path, recursive=True)
        observer.start()
        log.info("Watchdog started")

    # Scheduled scans
    try:
        while True:
            log.info("Running scheduled scan...")
            scanner = LibraryScanner(config)
            issues = scanner.scan()
            fixer = LibraryFixer(config)
            fixer.fix(issues, dry_run=True)
            save_report(issues, config)
            log.info("Next scan in %ds", interval)
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("Shutting down")
    finally:
        if observer:
            observer.stop()
            observer.join()
