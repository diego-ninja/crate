import logging
import threading
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

log = logging.getLogger(__name__)


class _EventHandler(FileSystemEventHandler):
    def __init__(self, callback):
        self.callback = callback

    def on_any_event(self, event):
        self.callback(event.src_path)


class LibraryWatcher:
    def __init__(self, config: dict, sync):
        self.sync = sync
        self.library_path = Path(config["library_path"])
        self.debounce_timers: dict[str, threading.Timer] = {}
        self.debounce_seconds = 30
        self._lock = threading.Lock()
        self._observer = None

    def start(self):
        handler = _EventHandler(self._on_change)
        self._observer = Observer()
        self._observer.schedule(handler, str(self.library_path), recursive=True)
        self._observer.daemon = True
        self._observer.start()
        log.info("Library watcher started on %s", self.library_path)

    def stop(self):
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)

    def _on_change(self, path: str):
        try:
            rel = Path(path).relative_to(self.library_path)
        except ValueError:
            return
        parts = rel.parts
        if len(parts) < 2:
            return
        album_dir = self.library_path / parts[0] / parts[1]
        artist_name = parts[0]
        key = str(album_dir)

        with self._lock:
            if key in self.debounce_timers:
                self.debounce_timers[key].cancel()
            timer = threading.Timer(
                self.debounce_seconds, self._sync_album, args=(album_dir, artist_name)
            )
            timer.daemon = True
            timer.start()
            self.debounce_timers[key] = timer

    def _sync_album(self, album_dir: Path, artist_name: str):
        with self._lock:
            self.debounce_timers.pop(str(album_dir), None)
        try:
            artist_dir = album_dir.parent
            canonical = self.sync._canonical_artist_name(artist_dir, artist_name)

            # Check if artist is new (not in DB yet)
            from musicdock.db import get_library_artist
            is_new = get_library_artist(canonical) is None

            if album_dir.is_dir():
                log.info("Watcher: syncing album %s/%s", canonical, album_dir.name)
                self.sync.sync_album(album_dir, canonical)
            self.sync.sync_artist(artist_dir)

            # Trigger enrichment for new artists
            if is_new:
                try:
                    from musicdock.db import create_task
                    create_task("enrich_artist", {"artist": canonical})
                    log.info("Watcher: queued enrichment for new artist %s", canonical)
                except Exception:
                    log.debug("Watcher: failed to queue enrichment for %s", canonical)
        except Exception:
            log.exception("Watcher: failed to sync %s/%s", artist_name, album_dir.name)
