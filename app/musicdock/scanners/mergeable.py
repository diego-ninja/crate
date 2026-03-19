import logging

from thefuzz import fuzz

from musicdock.audio import read_tags
from musicdock.models import Album, Issue, IssueType, Severity
from musicdock.scanners.base import BaseScanner
from musicdock.scanners.duplicates import normalize_album_name

log = logging.getLogger(__name__)


class MergeableScanner(BaseScanner):
    """Detect partial albums that together form a complete album.

    Example: "Album" with tracks 1-8 and "Album" with tracks 9-10
    should be merged into one complete album.
    """

    def scan(self) -> list[Issue]:
        issues = []
        similarity = self.config.get("name_similarity", 85)
        total = self.artist_count
        done = 0

        for artist_name, artist_path in self.iter_artists():
            albums = list(self.iter_albums(artist_path))
            if len(albums) >= 2:
                issues.extend(self._find_mergeable(albums, similarity))

            done += 1
            self._report_progress("mergeable", artist_name, done, total, len(issues))

        return issues

    def _find_mergeable(self, albums: list[Album], similarity: int) -> list[Issue]:
        issues = []
        checked = set()

        for i, a in enumerate(albums):
            if a.path in checked:
                continue

            norm_a = normalize_album_name(a.name)
            group = [a]

            for b in albums[i + 1:]:
                if b.path in checked:
                    continue

                norm_b = normalize_album_name(b.name)
                ratio = fuzz.ratio(norm_a, norm_b)

                if ratio >= similarity:
                    group.append(b)
                    checked.add(b.path)

            if len(group) < 2:
                continue

            # Check if tracks are complementary (non-overlapping track numbers)
            track_sets = self._get_track_numbers(group)
            if not track_sets:
                continue

            all_tracks = set()
            is_complementary = True
            for ts in track_sets:
                if ts & all_tracks:
                    is_complementary = False
                    break
                all_tracks.update(ts)

            if not is_complementary:
                continue

            checked.add(a.path)
            total = sum(alb.track_count for alb in group)
            merged_tracks = sorted(all_tracks)

            # Find the most complete album to merge into
            best = max(group, key=lambda x: x.track_count)
            sources = [alb for alb in group if alb.path != best.path]

            issues.append(Issue(
                type=IssueType.MERGEABLE_ALBUM,
                severity=Severity.HIGH,
                confidence=90,
                description=(
                    f'[{a.artist}] "{a.name}" can be merged from {len(group)} partial albums '
                    f"({total} tracks total: {merged_tracks})"
                ),
                paths=[alb.path for alb in group],
                suggestion=(
                    f'Merge tracks into "{best.name}" ({best.track_count} tracks), '
                    f"absorbing {len(sources)} partial album(s)"
                ),
                details={
                    "target": str(best.path),
                    "sources": [str(s.path) for s in sources],
                    "track_numbers": {str(alb.path): sorted(ts) for alb, ts in zip(group, track_sets)},
                    "total_tracks": total,
                }
            ))

        return issues

    def _get_track_numbers(self, albums: list[Album]) -> list[set[int]] | None:
        """Extract track numbers from each album via tags."""
        result = []

        for album in albums:
            numbers = set()
            for track in album.tracks:
                tags = read_tags(track)
                tn = tags.get("tracknumber", "")
                # Handle "3/10" format
                if "/" in str(tn):
                    tn = str(tn).split("/")[0]
                try:
                    numbers.add(int(tn))
                except (ValueError, TypeError):
                    pass

            if not numbers:
                return None
            result.append(numbers)

        return result
