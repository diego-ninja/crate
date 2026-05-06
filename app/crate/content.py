"""Content hashing + task gating for process_new_content.

Single source of truth for:
 - computing an artist directory's content hash (preferring the Rust CLI
   `crate-cli scan --hash`, falling back to Python MD5 over filenames+sizes).
 - deciding whether a `process_new_content` task should actually be enqueued
   for a given artist. Call sites that used to blindly call
   ``create_task_dedup("process_new_content", ...)`` should go through
   :func:`queue_process_new_content_if_needed` instead, so we stop flooding
   the queue with no-ops that the worker then discards with
   ``skipped: content_unchanged``.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

from crate.storage_layout import resolve_artist_dir

log = logging.getLogger(__name__)


def _get_library_artist(artist_name: str):
    from crate.db.repositories.library import get_library_artist

    return get_library_artist(artist_name)


def _create_process_new_content_task(params: dict, *, dedup_key: str) -> str | None:
    from crate.db.repositories.tasks import create_task_dedup

    return create_task_dedup("process_new_content", params, dedup_key=dedup_key)


def process_new_content_dedup_key(artist_name: str) -> str:
    """Return a stable task-dedup identity for ``process_new_content``.

    We deduplicate by normalized artist identity rather than raw params so
    call sites can safely vary incidental flags like ``force=True`` without
    flooding the queue with parallel processing for the same artist.
    """
    normalized = re.sub(r"\s+", " ", str(artist_name or "").strip().lower())
    return f"process_new_content:{normalized}"


def compute_dir_hash(directory: Path) -> str:
    """Return a content hash for ``directory``.

    Tries ``crate-cli scan --hash`` first; falls back to a pure-Python
    MD5 over ``filename:size`` pairs for every file under the directory.
    """
    try:
        from crate.crate_cli import has_subcommands, is_available, run_scan

        if is_available() and has_subcommands():
            data = run_scan(str(directory), hash=True, covers=False)
            if data and data.get("artists"):
                content_hash = data["artists"][0].get("content_hash")
                if content_hash:
                    return content_hash
    except Exception:
        log.debug("crate-cli scan failed for %s, falling back to md5", directory, exc_info=True)

    digest = hashlib.md5(usedforsecurity=False)
    for file_path in sorted(directory.rglob("*")):
        if file_path.is_file():
            digest.update(f"{file_path.relative_to(directory)}:{file_path.stat().st_size}\n".encode())
    return digest.hexdigest()


def should_process_artist(artist_name: str, library_path: Path | str | None = None) -> bool:
    """Return True iff the filesystem content for ``artist_name`` differs from
    the stored ``library_artists.content_hash``.

    Returns True when:
    - the artist has no stored hash yet (never processed),
    - the stored hash differs from the freshly computed filesystem hash.

    Returns False when:
    - the artist directory cannot be located,
    - the hash already matches (no new content to process).
    """
    if library_path is None:
        from crate.config import load_config

        library_path = load_config()["library_path"]
    lib = Path(library_path)

    artist_row = _get_library_artist(artist_name)
    artist_dir = resolve_artist_dir(lib, artist_row, fallback_name=artist_name, existing_only=True)
    if not artist_dir or not artist_dir.is_dir():
        return False

    old_hash = artist_row.get("content_hash") if artist_row else None
    if not old_hash:
        return True

    new_hash = compute_dir_hash(artist_dir)
    return new_hash != old_hash


def queue_process_new_content_if_needed(
    artist_name: str,
    *,
    library_path: Path | str | None = None,
    force: bool = False,
    triggered_by: str | None = None,
) -> str | None:
    """Enqueue ``process_new_content`` for ``artist_name`` only if the
    filesystem content has actually changed since the last time the artist
    was fully processed.

    Returns the task id (string) if a task was enqueued, ``None`` if the
    call was suppressed because content is unchanged or the dedup window
    already contains a pending task for the same artist.
    """
    if not artist_name:
        return None

    if not force and not should_process_artist(artist_name, library_path=library_path):
        log.debug("Skip queuing process_new_content for %s — content unchanged", artist_name)
        return None

    params: dict = {"artist": artist_name}
    if force:
        params["force"] = True
    if triggered_by:
        params["triggered_by"] = triggered_by
    return _create_process_new_content_task(
        params,
        dedup_key=process_new_content_dedup_key(artist_name),
    )
