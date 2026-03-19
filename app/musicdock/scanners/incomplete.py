import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import musicbrainzngs

from musicdock.audio import read_tags
from musicdock.db import get_mb_cache, set_mb_cache
from musicdock.models import Issue, IssueType, Severity
from musicdock.scanners.base import BaseScanner

log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("musicdock-librarian", "0.1", "https://github.com/musicdock")

# Rate-limit semaphore: allows overlapping waits but max 1 req/sec
_mb_semaphore = threading.Semaphore(1)


def _rate_limited_get_expected_tracks(mbid: str) -> tuple[str, int | None]:
    """Fetch expected track count from MusicBrainz, rate-limited. Uses SQLite cache."""
    cache_key = f"release:{mbid}:track_count"
    cached = get_mb_cache(cache_key)
    if cached is not None:
        return mbid, cached.get("track_count")

    _mb_semaphore.acquire()
    try:
        time.sleep(1.1)
        result = musicbrainzngs.get_release_by_id(mbid, includes=["recordings"])
        media = result.get("release", {}).get("medium-list", [])
        total = sum(int(m.get("track-count", 0)) for m in media)
        track_count = total if total > 0 else None
        set_mb_cache(cache_key, {"track_count": track_count})
        return mbid, track_count
    except Exception as e:
        log.debug("MusicBrainz lookup failed for %s: %s", mbid, e)
        return mbid, None
    finally:
        _mb_semaphore.release()


class IncompleteScanner(BaseScanner):
    """Detect albums that are missing tracks compared to MusicBrainz."""

    def scan(self) -> list[Issue]:
        issues = []
        min_tracks = self.config.get("min_tracks", 3)
        total = self.artist_count
        done = 0

        # Phase 1: collect all albums with MBIDs (fast, filesystem + tag reads only)
        album_jobs = []  # list of (album, mbid)
        for artist_name, artist_path in self.iter_artists():
            for album in self.iter_albums(artist_path):
                if album.track_count < min_tracks:
                    continue
                mbid = self._get_mbid(album)
                if mbid:
                    album_jobs.append((album, mbid))

            done += 1
            self._report_progress("incomplete", artist_name, done, total, len(issues))

        if not album_jobs:
            return issues

        # Phase 2: parallel MB lookups
        mb_results: dict[str, int | None] = {}
        with ThreadPoolExecutor(max_workers=2) as executor:
            # Deduplicate MBIDs to avoid redundant lookups
            unique_mbids = {mbid for _, mbid in album_jobs}
            futures = {
                executor.submit(_rate_limited_get_expected_tracks, mbid): mbid
                for mbid in unique_mbids
            }
            completed = 0
            for future in as_completed(futures):
                mbid, expected = future.result()
                mb_results[mbid] = expected
                completed += 1
                # Report progress as fraction of MB lookups
                self._report_progress(
                    "incomplete",
                    f"MB lookup {completed}/{len(unique_mbids)}",
                    completed, len(unique_mbids), len(issues),
                )

        # Phase 3: compare and build issues
        for album, mbid in album_jobs:
            expected = mb_results.get(mbid)
            if expected is None or expected <= 0:
                continue

            if album.track_count < expected:
                missing = expected - album.track_count
                pct = round(album.track_count / expected * 100)

                issues.append(Issue(
                    type=IssueType.INCOMPLETE_ALBUM,
                    severity=Severity.MEDIUM if pct >= 70 else Severity.HIGH,
                    confidence=85,
                    description=(
                        f"[{album.artist}] \"{album.name}\" has {album.track_count}/{expected} tracks "
                        f"({pct}% complete, {missing} missing)"
                    ),
                    paths=[album.path],
                    suggestion=f"Missing {missing} tracks. Check MusicBrainz release {mbid}",
                    details={
                        "mbid": mbid,
                        "expected": expected,
                        "actual": album.track_count,
                        "completeness_pct": pct,
                    }
                ))

        return issues

    def _get_mbid(self, album) -> str | None:
        if album.tracks:
            tags = read_tags(album.tracks[0])
            return tags.get("musicbrainz_albumid")
        return None
