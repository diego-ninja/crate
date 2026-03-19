"""Import queue: monitor download directories and import into library."""

import logging
import re
import shutil
import time
from pathlib import Path
from threading import Thread, Lock

from librarian.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)

# Download sources to monitor
DEFAULT_SOURCES = [
    {"name": "tidal", "path": "/music/.imports/tidal", "pattern": "{artist}/{album}"},
    {"name": "soulseek", "path": "/music/.imports/soulseek", "pattern": "{artist}/{album}"},
    {"name": "tidalrr", "path": "/music/.imports/tidalrr", "pattern": "{artist}/{album}"},
]


class ImportQueue:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))
        self.sources = config.get("import_sources", DEFAULT_SOURCES)
        self._queue: list[dict] = []
        self._lock = Lock()

    def scan_pending(self) -> list[dict]:
        """Scan all download directories for pending imports."""
        pending = []
        for source in self.sources:
            src_path = Path(source["path"])
            if not src_path.exists():
                continue

            for item in sorted(src_path.iterdir()):
                if not item.is_dir() or item.name.startswith("."):
                    continue

                # Could be artist dir or album dir directly
                albums = self._find_albums(item)
                for album_dir in albums:
                    tracks = get_audio_files(album_dir, self.extensions)
                    if not tracks:
                        continue

                    tags = read_tags(tracks[0])
                    artist = tags.get("albumartist") or tags.get("artist") or item.name
                    album = tags.get("album") or album_dir.name

                    dest = self.library_path / _sanitize(artist) / _sanitize(album)
                    exists = dest.exists()

                    pending.append({
                        "source": source["name"],
                        "source_path": str(album_dir),
                        "artist": artist,
                        "album": album,
                        "track_count": len(tracks),
                        "formats": list({t.suffix.lower() for t in tracks}),
                        "total_size_mb": round(sum(t.stat().st_size for t in tracks) / (1024**2)),
                        "dest_path": str(dest),
                        "dest_exists": exists,
                        "status": "pending",
                    })

        with self._lock:
            self._queue = pending
        return pending

    def import_item(self, source_path: str, dest_artist: str = None, dest_album: str = None) -> dict:
        """Import a single album from source to library."""
        src = Path(source_path)
        if not src.exists() or not src.is_dir():
            return {"error": "Source path not found"}

        tracks = get_audio_files(src, self.extensions)
        if not tracks:
            return {"error": "No audio files found"}

        tags = read_tags(tracks[0])
        artist = dest_artist or tags.get("albumartist") or tags.get("artist") or "Unknown Artist"
        album = dest_album or tags.get("album") or src.name

        dest = self.library_path / _sanitize(artist) / _sanitize(album)

        if dest.exists():
            # Merge: only copy files that don't exist
            copied = 0
            skipped = 0
            for f in src.iterdir():
                if f.is_file():
                    target = dest / f.name
                    if target.exists():
                        skipped += 1
                    else:
                        shutil.copy2(str(f), str(target))
                        copied += 1
            return {
                "status": "merged",
                "dest": str(dest),
                "copied": copied,
                "skipped": skipped,
            }
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(str(src), str(dest))
            return {
                "status": "imported",
                "dest": str(dest),
                "tracks": len(tracks),
            }

    def import_all(self, items: list[dict] = None) -> list[dict]:
        """Import multiple items."""
        if items is None:
            items = self.scan_pending()

        results = []
        for item in items:
            result = self.import_item(
                item["source_path"],
                item.get("artist"),
                item.get("album"),
            )
            result["source"] = item.get("source", "")
            result["source_path"] = item["source_path"]
            results.append(result)

        return results

    def remove_source(self, source_path: str) -> bool:
        """Remove imported source directory."""
        src = Path(source_path)
        if not src.exists():
            return False
        shutil.rmtree(str(src))
        return True

    def _find_albums(self, directory: Path) -> list[Path]:
        """Find album directories (dirs containing audio files)."""
        tracks = get_audio_files(directory, self.extensions)
        if tracks:
            return [directory]

        albums = []
        for child in sorted(directory.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                child_tracks = get_audio_files(child, self.extensions)
                if child_tracks:
                    albums.append(child)
        return albums


def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name.rstrip(". ") or "Unknown"
