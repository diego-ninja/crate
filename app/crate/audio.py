from pathlib import Path

import mutagen


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

    return {
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


def get_audio_files(directory: Path, extensions: list[str]) -> list[Path]:
    """Get all audio files in a directory (non-recursive)."""
    files = []
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix.lower() in extensions:
            files.append(f)
    return files
