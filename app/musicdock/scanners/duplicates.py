import logging
import re
from pathlib import Path

from thefuzz import fuzz

from musicdock.audio import read_tags
from musicdock.enricher import are_different_releases
from musicdock.models import Album, Issue, IssueType, Severity
from musicdock.scanners.base import BaseScanner

log = logging.getLogger(__name__)

# Patterns to strip from album names for comparison
STRIP_PATTERNS = [
    r"\s*\(Deluxe[^)]*\)",
    r"\s*\(Anniversary[^)]*\)",
    r"\s*\(Remaster[^)]*\)",
    r"\s*\(Expanded[^)]*\)",
    r"\s*\[Deluxe[^\]]*\]",
    r"\s*\[Remaster[^\]]*\]",
    r"\s*\[\d{4}\]",             # [2014] suffix
    r"\s*\(\d{4}\)",             # (2021) suffix
    r"^\d{4}\s*-\s*",           # Year prefix: "2012 - Album"
    r"^\[\d{4}\]\s*",           # Year prefix: "[2024] Album"
    r"^\d{2}\s*-\s*",           # Track prefix: "08 - Album"
    r"\s*-\s*WEB\s*-.*$",       # Scene tags
    r"\s*\(YEAR\d+\)\s*\[FLAC\]$",  # (YEAR0001) [FLAC]
    r"\s*@\s*\d+\s*$",          # Bitrate suffix
    r"^.*?\s*-\s*\d{4}\s*-\s*", # "Artist - 2022 - Album"
]

# Patterns that indicate a numbered series (NOT duplicates)
SERIES_PATTERNS = [
    r"(?:vol(?:ume)?|pt|part|chapter|book|ep)\s*\.?\s*(?:#?\d+|[ivxlc]+)",
    r"(?:#\d+|\d+(?:st|nd|rd|th))",
    r"\b(?:1962|1967|1994|2009)\b.*\b(?:1966|1970|2009|2019)\b",  # Year ranges
]


def normalize_album_name(name: str) -> str:
    """Strip year prefixes, edition suffixes, scene tags for comparison."""
    normalized = name
    for pattern in STRIP_PATTERNS:
        normalized = re.sub(pattern, "", normalized, flags=re.IGNORECASE)
    return normalized.strip().lower()


def extract_series_key(name: str) -> str | None:
    """Extract the series base name and number if this is part of a numbered series.
    Returns None if not a series, or 'base|number' string."""
    normalized = name.lower()
    # Match patterns like "Vol. 1", "Pt. II", "EP III", "#2"
    series_re = re.compile(
        r"(.+?)\s*[,.]?\s*"
        r"(?:vol(?:ume|\.)?|pt\.?|part|ep|chapter|book)\s*\.?\s*"
        r"(?:#?\s*(\d+|[ivxlc]+))\s*(?:\(.*\))?$",
        re.IGNORECASE
    )
    m = series_re.match(normalized)
    if m:
        return f"{m.group(1).strip()}|{m.group(2).strip()}"

    # Match "Name 1", "Name 2" at the end
    num_suffix = re.match(r"(.+?)\s+(\d+)\s*$", normalized)
    if num_suffix:
        base = num_suffix.group(1).strip()
        # Only if the base is long enough to be meaningful
        if len(base) > 5:
            return f"{base}|{num_suffix.group(2)}"

    return None


def is_same_series_different_entry(a_name: str, b_name: str) -> bool:
    """Check if two albums are different entries in the same series."""
    key_a = extract_series_key(normalize_album_name(a_name))
    key_b = extract_series_key(normalize_album_name(b_name))

    if key_a is None or key_b is None:
        return False

    base_a, num_a = key_a.rsplit("|", 1)
    base_b, num_b = key_b.rsplit("|", 1)

    # Same series base but different number = different album, not duplicate
    return base_a == base_b and num_a != num_b


def has_different_date_range(a_name: str, b_name: str) -> bool:
    """Detect compilations with different year ranges (e.g., Beatles 1962-1966 vs 1967-1970)."""
    year_range = re.compile(r"(\d{4})\s*[-–]\s*(\d{4})")
    m_a = year_range.search(a_name)
    m_b = year_range.search(b_name)
    if m_a and m_b:
        return (m_a.group(1), m_a.group(2)) != (m_b.group(1), m_b.group(2))
    return False


class DuplicateScanner(BaseScanner):
    """Detect duplicate albums within the same artist."""

    def scan(self) -> list[Issue]:
        issues = []
        total = self.artist_count
        done = 0

        for artist_name, artist_path in self.iter_artists():
            albums = list(self.iter_albums(artist_path))
            if len(albums) >= 2:
                issues.extend(self._find_duplicates(albums))

            done += 1
            self._report_progress("duplicates", artist_name, done, total, len(issues))

        return issues

    def _find_duplicates(self, albums: list[Album]) -> list[Issue]:
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

                # Skip if they're different entries in a numbered series
                if is_same_series_different_entry(a.name, b.name):
                    continue

                # Skip compilations with different year ranges
                if has_different_date_range(a.name, b.name):
                    continue

                # Exact match after normalization
                if norm_a == norm_b:
                    group.append(b)
                    checked.add(b.path)
                    continue

                # Fuzzy match
                ratio = fuzz.ratio(norm_a, norm_b)
                if ratio >= 90:
                    group.append(b)
                    checked.add(b.path)
                    continue

                # Tag-based: same MusicBrainz album ID
                if self.config.get("match_method") == "tags":
                    mbid_a = self._get_album_mbid(a)
                    mbid_b = self._get_album_mbid(b)
                    if mbid_a and mbid_b and mbid_a == mbid_b:
                        group.append(b)
                        checked.add(b.path)

            if len(group) > 1:
                # Validate with MusicBrainz if enabled
                if self.config.get("match_method") == "tags":
                    group = self._validate_with_musicbrainz(group)

                if len(group) > 1:
                    checked.add(a.path)
                    issues.append(self._build_issue(group))

        return issues

    def _validate_with_musicbrainz(self, group: list[Album]) -> list[Album]:
        """Use MusicBrainz release groups to confirm duplicates.
        Albums in the same release group are true duplicates (different editions).
        Albums in different release groups are false positives."""
        if len(group) < 2:
            return group

        # Check pairs against MusicBrainz
        validated = [group[0]]
        for album in group[1:]:
            result = are_different_releases(group[0], album)
            if result is True:
                log.debug(
                    "MB confirmed different releases: %s vs %s",
                    group[0].name, album.name
                )
                continue  # Not a duplicate, different release group
            # Same release group or unknown -> keep as potential duplicate
            validated.append(album)

        return validated

    def _get_album_mbid(self, album: Album) -> str | None:
        if album.musicbrainz_id:
            return album.musicbrainz_id

        if album.tracks:
            tags = read_tags(album.tracks[0])
            mbid = tags.get("musicbrainz_albumid")
            album.musicbrainz_id = mbid
            return mbid
        return None

    def _build_issue(self, group: list[Album]) -> Issue:
        prefer_order = self.config.get("prefer", ["flac", "m4a", "mp3"])
        prefer_complete = self.config.get("prefer_complete", True)

        # Score each album
        def score(album: Album) -> tuple:
            fmt_score = 0
            for i, fmt in enumerate(reversed(prefer_order)):
                if f".{fmt}" in album.formats:
                    fmt_score = i + 1

            return (
                album.track_count if prefer_complete else 0,
                fmt_score,
                album.total_size,
            )

        ranked = sorted(group, key=score, reverse=True)
        best = ranked[0]
        rest = ranked[1:]

        confidence = 95 if all(
            normalize_album_name(a.name) == normalize_album_name(best.name)
            for a in rest
        ) else 80

        return Issue(
            type=IssueType.DUPLICATE_ALBUM,
            severity=Severity.HIGH,
            confidence=confidence,
            description=(
                f"[{best.artist}] {len(group)} copies: "
                + ", ".join(f'"{a.name}" ({a.track_count}t, {a.primary_format})' for a in group)
            ),
            paths=[a.path for a in group],
            suggestion=f'Keep "{best.name}" ({best.track_count} tracks, {best.primary_format}), remove {len(rest)} others',
            details={
                "keep": str(best.path),
                "remove": [str(a.path) for a in rest],
                "albums": [
                    {"path": str(a.path), "tracks": a.track_count, "format": a.primary_format, "size": a.total_size}
                    for a in group
                ],
            }
        )
