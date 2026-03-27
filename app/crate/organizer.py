"""File organizer: rename/move files and folders using configurable patterns."""

import logging
import re
import shutil
from pathlib import Path

import mutagen

from crate.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)

PRESETS = {
    "standard": "{artist}/{album}/{track:02d} - {title}",
    "with_year": "{artist}/{album} ({year})/{track:02d} - {title}",
    "disc_aware": "{artist}/{album}/{disc:d}-{track:02d} - {title}",
}

DEFAULT_PATTERN = PRESETS["standard"]


def preview_organize(album_dir: Path, extensions: set[str], pattern: str = None) -> list[dict]:
    """Preview what renaming would look like for an album."""
    pattern = pattern or DEFAULT_PATTERN
    tracks = get_audio_files(album_dir, extensions)
    if not tracks:
        return []

    preview = []
    for track in tracks:
        tags = read_tags(track)
        new_name = _format_filename(pattern, tags, track)
        new_name = _sanitize(new_name) + track.suffix.lower()

        preview.append({
            "current": track.name,
            "proposed": new_name,
            "changed": track.name != new_name,
            "tags": {
                "title": tags.get("title", ""),
                "tracknumber": tags.get("tracknumber", ""),
                "discnumber": tags.get("discnumber", "1"),
            },
        })

    return preview


def organize_album(
    album_dir: Path,
    extensions: set[str],
    pattern: str = None,
    rename_folder: str = None,
) -> dict:
    """Rename tracks in an album according to pattern. Optionally rename album folder."""
    pattern = pattern or DEFAULT_PATTERN
    tracks = get_audio_files(album_dir, extensions)
    renamed = 0
    errors = []

    for track in tracks:
        tags = read_tags(track)
        new_name = _format_filename(pattern, tags, track)
        new_name = _sanitize(new_name) + track.suffix.lower()

        if track.name == new_name:
            continue

        new_path = track.parent / new_name
        if new_path.exists() and new_path != track:
            errors.append({"file": track.name, "error": f"Target exists: {new_name}"})
            continue

        try:
            track.rename(new_path)
            renamed += 1
        except Exception as e:
            errors.append({"file": track.name, "error": str(e)})

    result = {"renamed_tracks": renamed, "total": len(tracks), "errors": errors}

    if rename_folder and rename_folder != album_dir.name:
        new_dir = album_dir.parent / _sanitize(rename_folder)
        if new_dir.exists() and new_dir != album_dir:
            result["folder_error"] = f"Target folder exists: {rename_folder}"
        else:
            try:
                album_dir.rename(new_dir)
                result["folder_renamed"] = rename_folder
            except Exception as e:
                result["folder_error"] = str(e)

    return result


def suggest_folder_name(album_dir: Path, extensions: set[str], include_year: bool = False) -> str:
    """Suggest a clean folder name based on tags."""
    tracks = get_audio_files(album_dir, extensions)
    if not tracks:
        return album_dir.name

    tags = read_tags(tracks[0])
    album = tags.get("album", "") or album_dir.name
    year = tags.get("date", "")[:4]

    name = _sanitize(album)
    if include_year and year:
        name = f"{name} ({year})"

    return name


def _format_filename(pattern: str, tags: dict, track: Path) -> str:
    """Format a filename using pattern and tags."""
    # Extract just the filename part (last segment of pattern)
    parts = pattern.split("/")
    file_pattern = parts[-1] if parts else pattern

    track_num = _parse_track_number(tags.get("tracknumber", ""))
    disc_num = _parse_track_number(tags.get("discnumber", "1"))
    title = tags.get("title", "") or track.stem

    replacements = {
        "{track:02d}": f"{track_num:02d}" if track_num else "00",
        "{track:d}": str(track_num) if track_num else "0",
        "{disc:d}": str(disc_num) if disc_num else "1",
        "{disc:02d}": f"{disc_num:02d}" if disc_num else "01",
        "{title}": title,
        "{artist}": tags.get("artist", ""),
        "{albumartist}": tags.get("albumartist", ""),
        "{album}": tags.get("album", ""),
        "{year}": tags.get("date", "")[:4],
    }

    result = file_pattern
    for key, val in replacements.items():
        result = result.replace(key, val)

    return result


def _parse_track_number(raw: str) -> int:
    """Parse track number from various formats (3, 3/12, 03)."""
    if not raw:
        return 0
    match = re.match(r"(\d+)", str(raw))
    return int(match.group(1)) if match else 0


def _sanitize(name: str) -> str:
    """Sanitize a filename/folder name."""
    # Remove characters not allowed in filenames
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()
    # Remove trailing dots/spaces
    name = name.rstrip(". ")
    return name or "Unknown"
