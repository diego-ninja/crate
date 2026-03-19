import logging
from pathlib import Path

from librarian.models import Issue, IssueType, Severity
from librarian.scanners.base import BaseScanner

log = logging.getLogger(__name__)


class NestedLibraryScanner(BaseScanner):
    """Detect nested library directories (e.g., music/music/, music/tidal/)."""

    def scan(self) -> list[Issue]:
        issues = []
        total = self.artist_count
        done = 0

        for entry in sorted(self.library_path.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue

            # Check if this directory looks like another library root
            # (contains artist-like subdirectories that themselves contain album dirs)
            artist_count = 0
            sample_artists = []

            for sub in entry.iterdir():
                if not sub.is_dir() or sub.name.startswith("."):
                    continue
                # Check if sub has album-like directories with audio files
                has_albums = any(
                    any(f.suffix.lower() in self.extensions for f in album.iterdir() if f.is_file())
                    for album in sub.iterdir()
                    if album.is_dir()
                )
                if has_albums:
                    artist_count += 1
                    if len(sample_artists) < 5:
                        sample_artists.append(sub.name)

            # If the directory contains many artist-like subdirs, it's a nested library
            if artist_count >= 10:
                issues.append(Issue(
                    type=IssueType.NESTED_LIBRARY,
                    severity=Severity.CRITICAL,
                    confidence=98,
                    description=f"Nested library found: {entry.name}/ contains {artist_count} artists",
                    paths=[entry],
                    suggestion=f"Move contents of {entry.name}/ up to library root, merging with existing artists",
                    details={
                        "nested_path": str(entry),
                        "artist_count": artist_count,
                        "sample_artists": sample_artists,
                    }
                ))

            done += 1
            self._report_progress("nested", entry.name, done, total, len(issues))

        return issues
