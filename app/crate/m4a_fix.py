"""Handle M4A intermediate files left behind by tiddl.

When tiddl downloads at lossless quality (high/max), it fetches raw
DASH streams from Tidal as .m4a files, then converts them to .flac via
ffmpeg and writes Vorbis tags.  The intermediate .m4a files should be
cleaned up but sometimes aren't — they have no metadata atoms, zero
duration, and zero bitrate.  Our library sync indexes them as ghost
tracks with no title/artist/album.

This module provides:

1. ``is_m4a_dash`` — fast check (reads first bytes) to identify
   leftover DASH containers vs regular AAC M4A files.

2. ``is_flac_mislabeled_as_m4a`` — detects raw FLAC streams saved
   with a .m4a extension (another tiddl intermediate artifact).

3. ``cleanup_tidal_intermediates`` — removes M4A intermediates from
   album directories that already contain the final FLAC files.

4. ``remux_m4a_dash_to_flac`` — lossless remux via ffmpeg for the rare
   case where only M4A files exist (tiddl conversion failed).
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

from mutagen.flac import FLAC

log = logging.getLogger(__name__)


def is_m4a_dash(filepath: Path) -> bool:
    """Return True if *filepath* is an MP4 DASH container (ftyp iso8/iso6/dash)."""
    try:
        with open(filepath, "rb") as f:
            header = f.read(24)
        if len(header) < 12:
            return False
        if header[4:8] != b"ftyp":
            return False
        brand = header[8:12].decode("ascii", errors="replace").lower()
        return brand in ("iso8", "iso6", "dash")
    except Exception:
        return False


def is_flac_mislabeled_as_m4a(filepath: Path) -> bool:
    """Return True if *filepath* is a raw FLAC stream saved with .m4a extension."""
    try:
        with open(filepath, "rb") as f:
            return f.read(4) == b"fLaC"
    except Exception:
        return False


def is_tidal_intermediate(filepath: Path) -> bool:
    """Return True if *filepath* looks like a tiddl intermediate (not a real AAC M4A)."""
    return is_m4a_dash(filepath) or is_flac_mislabeled_as_m4a(filepath)


def _parse_track_info_from_filename(filename: str) -> dict:
    """Extract track number and title from tiddl-style filenames.

    tiddl names files like ``01 - Track Title.m4a`` or ``1. Track Title.m4a``.
    """
    stem = Path(filename).stem
    m = re.match(r"^(\d+)\s*[-–.]\s*(.+)$", stem)
    if m:
        return {"tracknumber": m.group(1), "title": m.group(2).strip()}
    m = re.match(r"^(\d+)$", stem)
    if m:
        return {"tracknumber": m.group(1), "title": ""}
    return {"tracknumber": "", "title": stem}


def cleanup_tidal_intermediates(
    directory: Path,
    *,
    progress_callback=None,
) -> dict:
    """Remove tiddl intermediate M4A files from a directory tree.

    Only deletes M4A files that are DASH containers or mislabeled FLACs
    in directories that already contain proper .flac files.  M4A-only
    directories are left untouched (those need remux, not cleanup).

    Returns a summary dict.
    """
    if not directory.is_dir():
        return {"total": 0, "deleted": 0, "skipped": 0, "bytes_freed": 0}

    # Group M4A intermediates by parent directory
    by_dir: dict[Path, list[Path]] = {}
    for m4a in sorted(directory.rglob("*.m4a")):
        if m4a.is_file() and is_tidal_intermediate(m4a):
            by_dir.setdefault(m4a.parent, []).append(m4a)

    total = sum(len(files) for files in by_dir.values())
    deleted = 0
    skipped = 0
    bytes_freed = 0
    done = 0

    for parent, m4a_files in by_dir.items():
        has_flac = any(f.suffix.lower() == ".flac" for f in parent.iterdir() if f.is_file())
        if not has_flac:
            skipped += len(m4a_files)
            done += len(m4a_files)
            continue

        for m4a in m4a_files:
            done += 1
            if progress_callback:
                progress_callback({"phase": "cleaning", "done": done, "total": total, "file": m4a.name})
            try:
                bytes_freed += m4a.stat().st_size
                m4a.unlink()
                deleted += 1
            except Exception:
                log.warning("Failed to delete intermediate %s", m4a, exc_info=True)

    return {"total": total, "deleted": deleted, "skipped": skipped, "bytes_freed": bytes_freed}


def remux_m4a_dash_to_flac(
    m4a_path: Path,
    *,
    artist: str = "",
    album: str = "",
    delete_original: bool = True,
) -> Path | None:
    """Remux a DASH M4A (FLAC-in-MP4) to a native .flac file.

    Only needed when tiddl's ffmpeg conversion failed and an album
    contains only M4A files with no FLACs.

    Returns the path to the new .flac file, or None on failure.
    """
    if not m4a_path.is_file():
        return None

    flac_path = m4a_path.with_suffix(".flac")
    tmp_path = m4a_path.with_suffix(".flac.tmp")

    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(m4a_path), "-c:a", "copy", "-vn", str(tmp_path)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0 or not tmp_path.is_file() or tmp_path.stat().st_size == 0:
            log.warning("ffmpeg remux failed for %s: %s", m4a_path, (result.stderr or "")[-500:])
            tmp_path.unlink(missing_ok=True)
            return None
        shutil.move(str(tmp_path), str(flac_path))
    except FileNotFoundError:
        log.warning("ffmpeg not found — cannot remux %s", m4a_path)
        tmp_path.unlink(missing_ok=True)
        return None
    except Exception:
        log.warning("Failed to remux %s", m4a_path, exc_info=True)
        tmp_path.unlink(missing_ok=True)
        return None

    info = _parse_track_info_from_filename(m4a_path.name)
    try:
        audio = FLAC(flac_path)
        if info.get("title"):
            audio["title"] = info["title"]
        if info.get("tracknumber"):
            audio["tracknumber"] = info["tracknumber"]
        if artist:
            audio["artist"] = artist
            audio["albumartist"] = artist
        if album:
            audio["album"] = album
        audio.save()
    except Exception:
        log.debug("Could not write tags to %s", flac_path, exc_info=True)

    if delete_original and flac_path.is_file():
        m4a_path.unlink(missing_ok=True)

    return flac_path
