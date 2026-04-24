"""Worker handler modules extracted from crate.worker.

Shared helpers used across multiple handler modules live here
to avoid duplication.
"""

import hashlib
import logging
from pathlib import Path
from typing import Callable

from crate.db.jobs.tasks import get_task_status

log = logging.getLogger(__name__)

# Type alias for task handler functions
TaskHandler = Callable[[str, dict, dict], dict]

# Audio file extensions recognized across all handlers
DEFAULT_AUDIO_EXTENSIONS = {".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".wma", ".aac", ".alac", ".aif", ".aiff"}


def audio_extensions() -> set[str]:
    return DEFAULT_AUDIO_EXTENSIONS


def is_cancelled(task_id: str) -> bool:
    """Check if a task has been cancelled."""
    try:
        status = get_task_status(task_id)
        return status == "cancelled"
    except Exception:
        return False


def compute_dir_hash(directory: Path, extensions: set[str] | None = None) -> str:
    """Compute a stable hash of a directory's audio file names + sizes."""
    exts = extensions or DEFAULT_AUDIO_EXTENSIONS
    entries = []
    if directory.is_dir():
        for f in sorted(directory.rglob("*")):
            if f.is_file() and f.suffix.lower() in exts:
                entries.append(f"{f.name}:{f.stat().st_size}")
    return hashlib.md5("|".join(entries).encode()).hexdigest()


# Enrichment cache key prefixes (used by enrichment + management handlers)
ENRICHMENT_CACHE_PREFIXES = (
    "enrichment:", "lastfm:artist:", "fanart:artist:",
    "fanart:bg:", "fanart:all:", "deezer:artist_img:",
    "spotify:artist:", "mb:artist:",
)

# Processing guard for content pipeline
_processing: set[str] = set()


def mark_processing(key: str) -> bool:
    """Mark an artist as being processed. Returns False if already processing."""
    if key in _processing:
        return False
    _processing.add(key)
    return True


def unmark_processing(key: str):
    _processing.discard(key)


def start_scan():
    """Queue a library scan task. Used by handlers after filesystem changes."""
    try:
        from crate.db.repositories.tasks import create_task_dedup
        create_task_dedup("scan")
    except Exception:
        log.debug("Failed to queue scan task", exc_info=True)
