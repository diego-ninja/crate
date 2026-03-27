import logging
from collections.abc import Callable
from pathlib import Path

from crate.models import Issue
from crate.scanners.nested import NestedLibraryScanner
from crate.scanners.naming import NamingScanner
from crate.scanners.duplicates import DuplicateScanner
from crate.scanners.mergeable import MergeableScanner
from crate.scanners.incomplete import IncompleteScanner

log = logging.getLogger(__name__)

# Ordered from fastest to slowest
SCANNER_ORDER: list[tuple[str, type]] = [
    ("nested", NestedLibraryScanner),
    ("naming", NamingScanner),
    ("duplicates", DuplicateScanner),
    ("mergeable", MergeableScanner),
    ("incomplete", IncompleteScanner),
]

SCANNER_MAP = dict(SCANNER_ORDER)


class LibraryScanner:
    def __init__(self, config: dict,
                 progress_callback: Callable[[dict], None] | None = None,
                 scanner_done_callback: Callable[[str, list[Issue]], None] | None = None):
        self.config = config
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))
        self._progress_callback = progress_callback
        self._scanner_done_callback = scanner_done_callback

    def scan(self, only: str | None = None) -> list[Issue]:
        issues = []

        if only:
            scanners = [(only, SCANNER_MAP[only])]
        else:
            scanners = SCANNER_ORDER

        for name, scanner_cls in scanners:
            scanner_config = self.config.get("scanners", {}).get(name, {})
            if not scanner_config.get("enabled", True):
                log.info("Scanner %s disabled, skipping", name)
                continue

            log.info("Running scanner: %s", name)
            scanner = scanner_cls(
                self.library_path, self.extensions, scanner_config,
                progress_callback=self._progress_callback,
            )
            found = scanner.scan()
            log.info("Scanner %s found %d issues", name, len(found))
            issues.extend(found)

            if self._scanner_done_callback:
                self._scanner_done_callback(name, found)

        return issues
