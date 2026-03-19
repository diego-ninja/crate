from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class IssueType(Enum):
    NESTED_LIBRARY = "nested_library"
    DUPLICATE_ALBUM = "duplicate_album"
    INCOMPLETE_ALBUM = "incomplete_album"
    MERGEABLE_ALBUM = "mergeable_album"
    BAD_NAMING = "bad_naming"


class Severity(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class Album:
    path: Path
    artist: str
    name: str
    tracks: list[Path] = field(default_factory=list)
    track_count: int = 0
    formats: set[str] = field(default_factory=set)
    musicbrainz_id: str | None = None
    total_size: int = 0

    @property
    def is_flac(self):
        return ".flac" in self.formats

    @property
    def primary_format(self):
        for fmt in [".flac", ".m4a", ".mp3"]:
            if fmt in self.formats:
                return fmt
        return next(iter(self.formats), None)


@dataclass
class Issue:
    type: IssueType
    severity: Severity
    confidence: int  # 0-100
    description: str
    paths: list[Path]
    suggestion: str
    details: dict = field(default_factory=dict)
