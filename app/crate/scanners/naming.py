import re
import logging

from crate.models import Issue, IssueType, Severity
from crate.scanners.base import BaseScanner

log = logging.getLogger(__name__)

# Scene/release group patterns in folder names
SCENE_PATTERNS = [
    r"-WEB-\d{4}-\w+",          # -WEB-2020-FiH
    r"\s*@\s*\d{2,4}\s*$",      # @320
    r"-(?:FLAC|MP3|AAC|WEB)",    # -FLAC, -MP3
    r"\bWEB[-_](?:DL|RIP)\b",
    r"\b(?:320|256|192|128)(?:kbps?)?\b",
]

# Year prefix patterns
YEAR_PREFIX_PATTERNS = [
    r"^\d{4}\s*-\s*",           # "2012 - Album"
    r"^\[\d{4}\]\s*",           # "[2024] Album"
]

# Artist name embedded in album folder
ARTIST_IN_ALBUM = [
    r"^.+?\s*-\s*\d{4}\s*-\s*",  # "Artist - 2022 - Album (Deluxe)"
    r"^.+?\s*-\s*",               # "Artist - Album" (only if parent is the same artist)
]


class NamingScanner(BaseScanner):
    """Detect inconsistent or messy folder naming."""

    def scan(self) -> list[Issue]:
        issues = []
        total = self.artist_count
        done = 0

        for artist_name, artist_path in self.iter_artists():
            for album in self.iter_albums(artist_path):
                name = album.name

                # Scene tags
                for pattern in SCENE_PATTERNS:
                    if re.search(pattern, name, re.IGNORECASE):
                        clean = re.sub(pattern, "", name, flags=re.IGNORECASE).strip()
                        clean = re.sub(r"[_]+", " ", clean).strip()
                        issues.append(Issue(
                            type=IssueType.BAD_NAMING,
                            severity=Severity.LOW,
                            confidence=95,
                            description=f'[{artist_name}] Scene tags in folder: "{name}"',
                            paths=[album.path],
                            suggestion=f'Rename to "{clean}"',
                            details={"current": name, "proposed": clean},
                        ))
                        break

                # Underscores instead of spaces
                if "_" in name and " " not in name:
                    clean = name.replace("_", " ")
                    # Strip scene suffixes from cleaned name too
                    for pattern in SCENE_PATTERNS:
                        clean = re.sub(pattern, "", clean, flags=re.IGNORECASE).strip()
                    issues.append(Issue(
                        type=IssueType.BAD_NAMING,
                        severity=Severity.LOW,
                        confidence=95,
                        description=f'[{artist_name}] Underscores in folder: "{name}"',
                        paths=[album.path],
                        suggestion=f'Rename to "{clean}"',
                        details={"current": name, "proposed": clean},
                    ))

                # Artist name repeated in album folder
                if name.lower().startswith(artist_name.lower()):
                    for pattern in ARTIST_IN_ALBUM:
                        match = re.match(pattern, name, re.IGNORECASE)
                        if match:
                            clean = name[match.end():].strip()
                            if clean:
                                issues.append(Issue(
                                    type=IssueType.BAD_NAMING,
                                    severity=Severity.LOW,
                                    confidence=85,
                                    description=f'[{artist_name}] Artist name in album folder: "{name}"',
                                    paths=[album.path],
                                    suggestion=f'Rename to "{clean}"',
                                    details={"current": name, "proposed": clean},
                                ))
                                break

            done += 1
            self._report_progress("naming", artist_name, done, total, len(issues))

        return issues
