from abc import ABC, abstractmethod
from collections.abc import Callable
from functools import cached_property
from pathlib import Path

from crate.models import Album, Issue
from crate.audio import get_audio_files


class BaseScanner(ABC):
    def __init__(self, library_path: Path, extensions: set[str], config: dict,
                 progress_callback: Callable[[dict], None] | None = None):
        self.library_path = library_path
        self.extensions = extensions
        self.config = config
        self._progress_callback = progress_callback

    @cached_property
    def artist_count(self) -> int:
        return sum(
            1 for d in self.library_path.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        )

    @abstractmethod
    def scan(self) -> list[Issue]:
        ...

    def _report_progress(self, scanner_name: str, artist: str,
                         artists_done: int, artists_total: int, issues_found: int):
        if self._progress_callback:
            self._progress_callback({
                "scanner": scanner_name,
                "artist": artist,
                "artists_done": artists_done,
                "artists_total": artists_total,
                "issues_found": issues_found,
            })

    def iter_artists(self):
        """Yield (artist_name, artist_path) for each artist directory."""
        for artist_dir in sorted(self.library_path.iterdir()):
            if artist_dir.is_dir() and not artist_dir.name.startswith("."):
                yield artist_dir.name, artist_dir

    def iter_albums(self, artist_path: Path):
        """Yield Album objects for each album directory under an artist."""
        for album_dir in sorted(artist_path.iterdir()):
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            tracks = get_audio_files(album_dir, self.extensions)
            if not tracks:
                continue

            formats = {t.suffix.lower() for t in tracks}
            total_size = sum(t.stat().st_size for t in tracks)

            yield Album(
                path=album_dir,
                artist=artist_path.name,
                name=album_dir.name,
                tracks=tracks,
                track_count=len(tracks),
                formats=formats,
                total_size=total_size,
            )

    def build_album(self, album_dir: Path, artist_name: str) -> Album | None:
        """Build an Album from a directory."""
        tracks = get_audio_files(album_dir, self.extensions)
        if not tracks:
            return None

        formats = {t.suffix.lower() for t in tracks}
        total_size = sum(t.stat().st_size for t in tracks)

        return Album(
            path=album_dir,
            artist=artist_name,
            name=album_dir.name,
            tracks=tracks,
            track_count=len(tracks),
            formats=formats,
            total_size=total_size,
        )
