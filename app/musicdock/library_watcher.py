"""Filesystem watcher — detects new content and triggers sync + enrichment.

Uses a processing lock to prevent infinite loops: when process_new_content
writes tags/photos back to /music, the watcher ignores those changes.
"""

import logging
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler, EVENT_TYPE_CREATED
from watchdog.observers import Observer

log = logging.getLogger(__name__)

# Files that enrichment/analysis writes — ignore changes to these
IGNORE_PATTERNS = {"artist.jpg", "artist.png", "photo.jpg", "cover.jpg", "folder.jpg"}
AUDIO_EXTENSIONS = {".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav"}


class _EventHandler(FileSystemEventHandler):
    def __init__(self, callback):
        self.callback = callback

    def on_created(self, event):
        """Only react to NEW files, not modifications (avoids tag-write loops)."""
        if not event.is_directory:
            self.callback(event.src_path, is_new_file=True)

    def on_moved(self, event):
        """React to moved files (Tidarr moves from processing to library)."""
        if not event.is_directory:
            self.callback(event.dest_path, is_new_file=True)


class LibraryWatcher:
    def __init__(self, config: dict, sync):
        self.sync = sync
        self.library_path = Path(config["library_path"])
        self.debounce_timers: dict[str, threading.Timer] = {}
        self.debounce_seconds = 60
        self._lock = threading.Lock()
        self._observer = None
        # Track albums currently being processed to avoid re-triggering
        self._processing: set[str] = set()

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

    def mark_processing(self, artist_name: str):
        """Called by worker before writing to /music — suppresses watcher triggers.
        NOTE: With multi-process workers, use the DB-based mark_processing in worker.py instead.
        This method is kept for backward compatibility within the same process."""
        self._processing.add(artist_name.lower())

    def unmark_processing(self, artist_name: str):
        """Called by worker after writing to /music."""
        self._processing.discard(artist_name.lower())

    def _on_change(self, path: str, is_new_file: bool = False):
        try:
            p = Path(path)
            rel = p.relative_to(self.library_path)
        except ValueError:
            return

        parts = rel.parts
        if len(parts) < 2:
            return

        # Ignore non-audio files (covers, photos written by enrichment)
        if p.name.lower() in IGNORE_PATTERNS:
            return
        if p.suffix.lower() not in AUDIO_EXTENSIONS and not p.is_dir():
            return

        artist_name = parts[0]
        album_dir = self.library_path / parts[0] / parts[1]

        # Skip if this artist is currently being processed by worker
        # Check both in-process set and DB cache (for cross-process coordination)
        if artist_name.lower() in self._processing:
            log.debug("Watcher: ignoring change during processing for %s", artist_name)
            return
        try:
            from musicdock.db import get_cache
            if get_cache(f"processing:{artist_name.lower()}"):
                log.debug("Watcher: ignoring change during processing for %s (DB flag)", artist_name)
                return
        except Exception:
            pass

        key = str(album_dir)
        with self._lock:
            if key in self.debounce_timers:
                self.debounce_timers[key].cancel()
            timer = threading.Timer(
                self.debounce_seconds, self._sync_album, args=(album_dir, artist_name, is_new_file)
            )
            timer.daemon = True
            timer.start()
            self.debounce_timers[key] = timer

    def _sync_album(self, album_dir: Path, artist_name: str, is_new_file: bool):
        with self._lock:
            self.debounce_timers.pop(str(album_dir), None)
        try:
            artist_dir = album_dir.parent
            canonical = self.sync._canonical_artist_name(artist_dir, artist_name)

            # Check if artist is new (not in DB yet)
            from musicdock.db import get_library_artist
            is_new_artist = get_library_artist(canonical) is None

            if album_dir.is_dir():
                log.info("Watcher: syncing album %s/%s", canonical, album_dir.name)
                self.sync.sync_album(album_dir, canonical)
            self.sync.sync_artist(artist_dir)

            # Queue enrichment for new content (new artist or new album)
            if is_new_file:
                try:
                    from musicdock.db import create_task_dedup
                    create_task_dedup("process_new_content", {
                        "artist": canonical,
                        "album_folder": album_dir.name,
                    })
                    log.info("Watcher: queued process_new_content for %s/%s", canonical, album_dir.name)
                except Exception:
                    log.debug("Watcher: failed to queue processing for %s", canonical)

        except Exception:
            log.exception("Watcher: failed to sync %s/%s", artist_name, album_dir.name)
