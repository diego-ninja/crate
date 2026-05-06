from pathlib import Path

import mutagen


def _read_mp4_tags_raw(filepath: Path) -> dict:
    """Fallback: read tags from an MP4/M4A using raw (non-easy) tag keys.

    mutagen's EasyMP4 may return empty for some M4A variants.  The raw
    MP4 tag namespace uses iTunes-style atoms like ``©nam``, ``©ART``,
    etc.  This function translates them to the same keys that easy mode
    returns.
    """
    try:
        from mutagen.mp4 import MP4
        audio = MP4(filepath)
    except Exception:
        return {}
    if not audio or not audio.tags:
        return {}

    def first(keys):
        for key in keys:
            val = audio.tags.get(key)
            if val and isinstance(val, list) and val[0]:
                v = str(val[0]).strip()
                if v:
                    return v
        return None

    return {
        "title": first(["©nam"]) or "",
        "artist": first(["©ART", "aART"]) or "",
        "album": first(["©alb"]) or "",
        "albumartist": first(["aART", "©ART"]) or "",
        "tracknumber": first(["trkn"]) or "",
        "discnumber": first(["disk"]) or "1",
        "date": first(["©day"]) or "",
        "genre": first(["©gen"]) or "",
        "musicbrainz_albumid": None,
        "musicbrainz_trackid": None,
    }


def read_tags(filepath: Path) -> dict:
    """Read audio tags from a file. Returns normalized dict."""
    try:
        audio = mutagen.File(filepath, easy=True)
    except Exception:
        return {}

    if audio is None:
        return {}

    def first(key):
        val = audio.get(key)
        if val and isinstance(val, list):
            val = val[0]
        return val if val and val.strip() else None

    tags = {
        "title": first("title") or "",
        "artist": first("artist") or first("albumartist") or "",
        "album": first("album") or "",
        "albumartist": first("albumartist") or first("artist") or "",
        "tracknumber": first("tracknumber") or "",
        "discnumber": first("discnumber") or "1",
        "date": first("date") or "",
        "genre": first("genre") or "",
        "musicbrainz_albumid": first("musicbrainz_albumid"),
        "musicbrainz_trackid": first("musicbrainz_trackid"),
    }

    # If easy mode returned blank artist+title+album (common with M4A DASH
    # containers), try the raw MP4 tag namespace as a fallback.
    if (
        filepath.suffix.lower() in (".m4a", ".mp4", ".aac")
        and not tags["title"]
        and not tags["artist"]
        and not tags["album"]
    ):
        raw = _read_mp4_tags_raw(filepath)
        if raw.get("title") or raw.get("artist") or raw.get("album"):
            return raw

    return tags


def _read_audio_quality_native(filepath: Path) -> dict[str, int | float | None] | None:
    try:
        from crate.crate_cli import run_quality

        payload = run_quality(file=str(filepath))
    except Exception:
        return None

    if not payload or not payload.get("tracks"):
        return None
    track = payload["tracks"][0]
    if not track.get("ok"):
        return None

    return {
        "duration": float(track.get("duration") or 0) or None,
        "bitrate": int(track.get("bitrate") or 0) or None,
        "sample_rate": int(track.get("sample_rate") or 0) or None,
        "bit_depth": int(track.get("bit_depth") or 0) or None,
    }


def read_audio_quality(filepath: Path) -> dict[str, int | float | None]:
    """Read lightweight technical audio metadata from a file."""
    native = _read_audio_quality_native(filepath)
    if native:
        return native

    try:
        audio = mutagen.File(filepath)
    except Exception:
        return {
            "duration": None,
            "bitrate": None,
            "sample_rate": None,
            "bit_depth": None,
        }

    info = audio.info if audio else None
    return {
        "duration": float(getattr(info, "length", 0) or 0) or None,
        "bitrate": int(getattr(info, "bitrate", 0) or 0) or None,
        "sample_rate": int(getattr(info, "sample_rate", 0) or 0) or None,
        "bit_depth": int(getattr(info, "bits_per_sample", 0) or 0) or None,
    }


def get_audio_files(directory: Path, extensions: list[str]) -> list[Path]:
    """Get all audio files in a directory (non-recursive)."""
    files = []
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix.lower() in extensions:
            files.append(f)
    return files
