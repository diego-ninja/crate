"""Handle Tidal/tiddl audio artifacts and mislabeled containers.

Historically, tiddl left behind ``.m4a`` DASH intermediates after converting
lossless downloads to FLAC. More recently we've also seen:

- extensionless ``tmp*`` MP4/AAC payloads
- ``.flac`` files whose content is actually MP4/AAC
- raw FLAC streams saved with the wrong extension

This module keeps the old M4A cleanup/remux helpers for compatibility, and
adds broader inspection/repair helpers so we can either recover real lossless
audio or fail cleanly when the staging tree only contains lossy wrappers.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

from mutagen.flac import FLAC

log = logging.getLogger(__name__)

FINAL_AUDIO_SUFFIXES = {".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".aac", ".alac"}
MP4_LIKE_SUFFIXES = {".m4a", ".mp4", ".aac"}
LOSSLESS_CODEC_NAMES = {"flac", "alac"}
LOSSY_CODEC_NAMES = {"aac"}
UUID_STEM_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _read_file_header(filepath: Path, size: int = 24) -> bytes:
    try:
        with open(filepath, "rb") as handle:
            return handle.read(size)
    except Exception:
        return b""


def _has_flac_header(filepath: Path) -> bool:
    return _read_file_header(filepath, 4) == b"fLaC"


def _has_mp4_ftyp_header(filepath: Path) -> bool:
    header = _read_file_header(filepath, 12)
    return len(header) >= 8 and header[4:8] == b"ftyp"


def _looks_machine_generated_name(filepath: Path) -> bool:
    stem = filepath.stem.strip()
    return filepath.name.startswith("tmp") or bool(UUID_STEM_RE.match(stem))


def _probe_audio_codec(filepath: Path) -> str | None:
    """Best-effort codec probe for MP4-like containers."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(filepath),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        log.warning("ffprobe not found — codec probe unavailable for %s", filepath)
        return None
    except Exception:
        log.debug("ffprobe failed for %s", filepath, exc_info=True)
        return None

    if result.returncode != 0:
        return None
    codec = (result.stdout or "").strip().splitlines()
    return codec[0].strip().lower() if codec else None


def is_m4a_dash(filepath: Path) -> bool:
    """Return True if *filepath* is an MP4 DASH container (ftyp iso8/iso6/dash)."""
    try:
        header = _read_file_header(filepath, 24)
        if len(header) < 12:
            return False
        if header[4:8] != b"ftyp":
            return False
        brand = header[8:12].decode("ascii", errors="replace").lower()
        return brand in ("iso8", "iso6", "dash")
    except Exception:
        return False


def is_flac_mislabeled_as_m4a(filepath: Path) -> bool:
    """Return True if *filepath* is a raw FLAC stream saved with the wrong extension."""
    return filepath.suffix.lower() != ".flac" and _has_flac_header(filepath)


def describe_tidal_artifact(filepath: Path) -> dict:
    """Classify *filepath* as valid audio, recoverable wrapper, or junk artifact."""
    suffix = filepath.suffix.lower()
    temp_name = filepath.name.startswith("tmp")

    try:
        size = filepath.stat().st_size
    except OSError:
        size = 0

    if size == 0 and temp_name:
        return {
            "kind": "empty_temp",
            "codec": None,
            "lossless": False,
            "recoverable": False,
            "suggested_suffix": None,
            "needs_remux": False,
            "suspicious": True,
            "temp_name": True,
            "final_audio": False,
        }

    if _has_flac_header(filepath):
        if suffix == ".flac":
            return {
                "kind": "native_flac",
                "codec": "flac",
                "lossless": True,
                "recoverable": False,
                "suggested_suffix": ".flac",
                "needs_remux": False,
                "suspicious": False,
                "temp_name": temp_name,
                "final_audio": not temp_name,
            }
        return {
            "kind": "raw_flac_wrong_ext",
            "codec": "flac",
            "lossless": True,
            "recoverable": True,
            "suggested_suffix": ".flac",
            "needs_remux": False,
            "suspicious": True,
            "temp_name": temp_name,
            "final_audio": False,
        }

    if _has_mp4_ftyp_header(filepath):
        codec = _probe_audio_codec(filepath)

        if suffix in MP4_LIKE_SUFFIXES and codec in LOSSLESS_CODEC_NAMES | LOSSY_CODEC_NAMES and not temp_name:
            return {
                "kind": f"final_{codec}_mp4",
                "codec": codec,
                "lossless": codec in LOSSLESS_CODEC_NAMES,
                "recoverable": False,
                "suggested_suffix": suffix,
                "needs_remux": False,
                "suspicious": False,
                "temp_name": False,
                "final_audio": True,
            }

        prefix = "temp_" if temp_name else "invalid_flac_" if suffix == ".flac" else "misnamed_" if suffix not in MP4_LIKE_SUFFIXES else ""
        kind_suffix = f"{codec}_in_mp4" if codec else "mp4_container"
        suggested_suffix = ".flac" if codec == "flac" else ".m4a"
        recoverable = not temp_name and (codec in LOSSLESS_CODEC_NAMES or codec in LOSSY_CODEC_NAMES)
        return {
            "kind": f"{prefix}{kind_suffix}",
            "codec": codec,
            "lossless": codec in LOSSLESS_CODEC_NAMES,
            "recoverable": recoverable,
            "suggested_suffix": suggested_suffix,
            "needs_remux": codec == "flac",
            "suspicious": True,
            "temp_name": temp_name,
            "final_audio": False,
        }

    if suffix in FINAL_AUDIO_SUFFIXES:
        return {
            "kind": "named_audio",
            "codec": None,
            "lossless": suffix in {".flac", ".wav", ".alac"},
            "recoverable": False,
            "suggested_suffix": suffix,
            "needs_remux": False,
            "suspicious": False,
            "temp_name": temp_name,
            "final_audio": not temp_name,
        }

    return {
        "kind": "other",
        "codec": None,
        "lossless": False,
        "recoverable": False,
        "suggested_suffix": None,
        "needs_remux": False,
        "suspicious": False,
        "temp_name": temp_name,
        "final_audio": False,
    }


def is_tidal_intermediate(filepath: Path) -> bool:
    """Return True if *filepath* looks like a tiddl artifact that needs attention."""
    info = describe_tidal_artifact(filepath)
    return bool(info.get("suspicious"))


def _parse_track_info_from_filename(filename: str) -> dict:
    """Extract track number and title from tiddl-style filenames."""
    stem = Path(filename).stem
    m = re.match(r"^(\d+)\s*[-–.]\s*(.+)$", stem)
    if m:
        return {"tracknumber": m.group(1), "title": m.group(2).strip()}
    m = re.match(r"^(\d+)$", stem)
    if m:
        return {"tracknumber": m.group(1), "title": ""}
    return {"tracknumber": "", "title": stem}


def _guess_artist_album(root: Path, filepath: Path) -> tuple[str, str]:
    try:
        parts = filepath.relative_to(root).parent.parts
    except ValueError:
        return "", ""
    if len(parts) >= 3 and parts[1].isdigit() and len(parts[1]) == 4:
        return parts[0], parts[2]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return "", ""


def _choose_output_path(filepath: Path, suffix: str) -> Path:
    candidate = filepath.with_suffix(suffix)
    if candidate == filepath or not candidate.exists():
        return candidate
    for idx in range(1, 1000):
        alt = filepath.with_name(f"{filepath.stem}.recovered{idx}{suffix}")
        if not alt.exists():
            return alt
    return filepath.with_name(f"{filepath.stem}.recovered999{suffix}")


def _write_basic_flac_tags(flac_path: Path, source_name: str, *, artist: str = "", album: str = "") -> None:
    info = _parse_track_info_from_filename(source_name)
    try:
        audio = FLAC(flac_path)
        if info.get("title") and not _looks_machine_generated_name(Path(source_name)):
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
        log.debug("Could not write FLAC tags to %s", flac_path, exc_info=True)


def _write_basic_mp4_tags(m4a_path: Path, source_name: str, *, artist: str = "", album: str = "") -> None:
    if _looks_machine_generated_name(Path(source_name)):
        return
    try:
        from mutagen.mp4 import MP4

        audio = MP4(m4a_path)
        info = _parse_track_info_from_filename(source_name)
        if info.get("title"):
            audio["\xa9nam"] = [info["title"]]
        if info.get("tracknumber"):
            try:
                audio["trkn"] = [(int(info["tracknumber"]), 0)]
            except ValueError:
                pass
        if artist:
            audio["\xa9ART"] = [artist]
            audio["aART"] = [artist]
        if album:
            audio["\xa9alb"] = [album]
        audio.save()
    except Exception:
        log.debug("Could not write MP4 tags to %s", m4a_path, exc_info=True)


def cleanup_tidal_intermediates(
    directory: Path,
    *,
    progress_callback=None,
) -> dict:
    """Remove obvious temp artifacts when a directory already has usable final audio."""
    if not directory.is_dir():
        return {"total": 0, "deleted": 0, "skipped": 0, "bytes_freed": 0}

    candidates: dict[Path, list[Path]] = {}
    for filepath in sorted(directory.rglob("*")):
        if not filepath.is_file():
            continue
        info = describe_tidal_artifact(filepath)
        if info["temp_name"] or info["kind"].startswith("invalid_flac_"):
            candidates.setdefault(filepath.parent, []).append(filepath)

    total = sum(len(files) for files in candidates.values())
    deleted = 0
    skipped = 0
    bytes_freed = 0
    done = 0

    for parent, files in candidates.items():
        has_final_audio = any(
            child.is_file() and describe_tidal_artifact(child)["final_audio"]
            for child in parent.iterdir()
        )
        if not has_final_audio:
            skipped += len(files)
            done += len(files)
            continue

        for artifact in files:
            done += 1
            if progress_callback:
                progress_callback({"phase": "cleaning", "done": done, "total": total, "file": artifact.name})
            try:
                bytes_freed += artifact.stat().st_size
                artifact.unlink()
                deleted += 1
            except Exception:
                log.warning("Failed to delete artifact %s", artifact, exc_info=True)

    return {"total": total, "deleted": deleted, "skipped": skipped, "bytes_freed": bytes_freed}


def remux_m4a_dash_to_flac(
    m4a_path: Path,
    *,
    artist: str = "",
    album: str = "",
    delete_original: bool = True,
) -> Path | None:
    """Remux a FLAC-in-MP4 container to a native ``.flac`` file."""
    if not m4a_path.is_file():
        return None

    flac_path = _choose_output_path(m4a_path, ".flac")
    tmp_path = _choose_output_path(m4a_path, ".recovered.flac")

    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(m4a_path), "-c:a", "copy", "-vn", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 or not tmp_path.is_file() or not _has_flac_header(tmp_path):
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

    _write_basic_flac_tags(flac_path, m4a_path.name, artist=artist, album=album)

    if delete_original and flac_path.is_file():
        m4a_path.unlink(missing_ok=True)

    return flac_path


def repair_tidal_artifacts(
    directory: Path,
    *,
    allow_lossy_rename: bool = False,
    progress_callback=None,
    dry_run: bool = False,
) -> dict:
    """Repair or classify suspicious Tidal artifacts within *directory*.

    The main policy is:

    - recover real FLAC payloads to native ``.flac`` files
    - optionally normalize valid AAC/ALAC MP4 payloads to ``.m4a``
    - delete ``tmp*`` / invalid wrappers once the directory has usable final audio
    - report remaining lossy or junk files so callers can fallback or abort
    """
    summary = {
        "scanned": 0,
        "deleted": 0,
        "bytes_freed": 0,
        "renamed_to_flac": 0,
        "remuxed_to_flac": 0,
        "renamed_to_m4a": 0,
        "lossy_files": [],
        "unrecoverable_files": [],
        "unrecoverable": 0,
        "dry_run": dry_run,
    }

    if not directory.is_dir():
        return summary

    lossy_files: set[str] = set()
    unrecoverable_files: set[str] = set()
    files = sorted(path for path in directory.rglob("*") if path.is_file())
    summary["scanned"] = len(files)

    def _mark_unrecoverable(path: Path, *, lossy: bool = False) -> None:
        rel = str(path.relative_to(directory))
        unrecoverable_files.add(rel)
        if lossy:
            lossy_files.add(rel)

    for idx, filepath in enumerate(files, start=1):
        info = describe_tidal_artifact(filepath)
        if progress_callback:
            progress_callback(
                {"phase": "repairing", "done": idx, "total": len(files), "file": filepath.name, "kind": info["kind"]}
            )

        if not info["suspicious"] or info["temp_name"]:
            continue

        artist, album = _guess_artist_album(directory, filepath)

        if info["kind"] == "raw_flac_wrong_ext":
            if dry_run:
                summary["renamed_to_flac"] += 1
                continue
            target = _choose_output_path(filepath, ".flac")
            try:
                shutil.move(str(filepath), str(target))
                _write_basic_flac_tags(target, filepath.name, artist=artist, album=album)
                summary["renamed_to_flac"] += 1
            except Exception:
                log.warning("Failed to rename raw FLAC artifact %s", filepath, exc_info=True)
                _mark_unrecoverable(filepath)
            continue

        if info["codec"] == "flac" and info["needs_remux"]:
            if dry_run:
                summary["remuxed_to_flac"] += 1
                continue
            if remux_m4a_dash_to_flac(filepath, artist=artist, album=album):
                summary["remuxed_to_flac"] += 1
            else:
                _mark_unrecoverable(filepath)
            continue

        if info["codec"] in LOSSLESS_CODEC_NAMES | LOSSY_CODEC_NAMES:
            rel = str(filepath.relative_to(directory))
            if info["codec"] in LOSSY_CODEC_NAMES:
                lossy_files.add(rel)
            if allow_lossy_rename and not _looks_machine_generated_name(filepath):
                if dry_run:
                    summary["renamed_to_m4a"] += 1
                    continue
                target = _choose_output_path(filepath, ".m4a")
                try:
                    if target != filepath:
                        shutil.move(str(filepath), str(target))
                    _write_basic_mp4_tags(target, filepath.name, artist=artist, album=album)
                    if target != filepath:
                        summary["renamed_to_m4a"] += 1
                except Exception:
                    log.warning("Failed to normalize MP4 artifact %s", filepath, exc_info=True)
                    _mark_unrecoverable(filepath, lossy=info["codec"] in LOSSY_CODEC_NAMES)
            else:
                _mark_unrecoverable(filepath, lossy=info["codec"] in LOSSY_CODEC_NAMES)
            continue

        _mark_unrecoverable(filepath)

    refreshed_files = sorted(path for path in directory.rglob("*") if path.is_file())
    for idx, filepath in enumerate(refreshed_files, start=1):
        info = describe_tidal_artifact(filepath)
        if not info["suspicious"]:
            continue
        has_final_audio = any(
            child.is_file() and describe_tidal_artifact(child)["final_audio"]
            for child in filepath.parent.iterdir()
        )
        if not has_final_audio:
            if info["temp_name"]:
                _mark_unrecoverable(filepath, lossy=info["codec"] in LOSSY_CODEC_NAMES)
            continue

        if not (info["temp_name"] or info["kind"].startswith("invalid_flac_")):
            continue

        if progress_callback:
            progress_callback(
                {
                    "phase": "cleaning",
                    "done": idx,
                    "total": len(refreshed_files),
                    "file": filepath.name,
                    "kind": info["kind"],
                }
            )
        try:
            summary["bytes_freed"] += filepath.stat().st_size
        except OSError:
            pass
        if not dry_run:
            try:
                filepath.unlink()
            except Exception:
                log.warning("Failed to delete artifact %s", filepath, exc_info=True)
                _mark_unrecoverable(filepath, lossy=info["codec"] in LOSSY_CODEC_NAMES)
                continue
        summary["deleted"] += 1

    summary["lossy_files"] = sorted(lossy_files)
    summary["unrecoverable_files"] = sorted(unrecoverable_files)
    summary["unrecoverable"] = len(summary["unrecoverable_files"])
    return summary
