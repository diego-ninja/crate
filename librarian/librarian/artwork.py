"""Album art management: detect missing, fetch from Cover Art Archive, extract embedded."""

import logging
from io import BytesIO
from pathlib import Path

import mutagen
import requests

from librarian.audio import get_audio_files

log = logging.getLogger(__name__)

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"]
CAA_URL = "https://coverartarchive.org/release/{mbid}/front-500"


def scan_missing_covers(library_path: Path, extensions: set[str]) -> list[dict]:
    """Find albums without cover art (no file and no embedded)."""
    missing = []
    for artist_dir in sorted(library_path.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        for album_dir in sorted(artist_dir.iterdir()):
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            has_file_cover = any((album_dir / c).exists() for c in COVER_NAMES)
            if has_file_cover:
                continue

            tracks = get_audio_files(album_dir, extensions)
            if not tracks:
                continue

            has_embedded = _has_embedded_art(tracks[0])

            if not has_embedded:
                # Try to get MBID for potential fetch
                from librarian.audio import read_tags
                tags = read_tags(tracks[0])
                missing.append({
                    "artist": artist_dir.name,
                    "album": album_dir.name,
                    "path": str(album_dir),
                    "track_count": len(tracks),
                    "mbid": tags.get("musicbrainz_albumid"),
                    "has_embedded": False,
                    "has_file": False,
                })

    return missing


def fetch_cover_from_caa(mbid: str) -> bytes | None:
    """Fetch cover art from the Cover Art Archive."""
    try:
        resp = requests.get(CAA_URL.format(mbid=mbid), timeout=15, allow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 1000:
            return resp.content
    except Exception as e:
        log.debug("CAA fetch failed for %s: %s", mbid, e)
    return None


def extract_embedded_cover(track_path: Path) -> bytes | None:
    """Extract embedded cover art from an audio file."""
    try:
        audio = mutagen.File(track_path)
        if audio is None:
            return None

        # FLAC
        if hasattr(audio, "pictures") and audio.pictures:
            return audio.pictures[0].data

        # MP3 (ID3)
        if hasattr(audio, "tags") and audio.tags:
            for key in audio.tags:
                if key.startswith("APIC"):
                    return audio.tags[key].data

        # M4A (MP4)
        if hasattr(audio, "tags") and audio.tags and "covr" in audio.tags:
            covers = audio.tags["covr"]
            if covers:
                return bytes(covers[0])
    except Exception as e:
        log.debug("Failed to extract embedded art from %s: %s", track_path, e)
    return None


def save_cover(album_dir: Path, image_data: bytes, filename: str = "cover.jpg") -> Path:
    """Save cover art to album directory."""
    cover_path = album_dir / filename
    cover_path.write_bytes(image_data)
    return cover_path


def _has_embedded_art(track_path: Path) -> bool:
    return extract_embedded_cover(track_path) is not None
