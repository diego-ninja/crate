import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from crate.audio import read_tags
from crate.db.health import upsert_health_issue, resolve_stale_artist_issues, resolve_stale_issues
from crate.db.queries.health import (
    get_albums_with_year,
    get_all_albums,
    get_all_albums_for_covers,
    get_all_artists,
    get_all_track_paths,
    get_artists_with_folder,
    get_artists_with_photo,
    get_duplicate_albums,
    get_duplicate_tracks,
    get_orphan_albums,
    get_orphan_tracks,
    get_tracks_sample,
    get_tracks_tag_sample,
    get_zombie_artists,
)
from crate.db.repositories.library import get_library_artist
from crate.repair_catalog import REPAIR_CATALOG, REPAIR_CATALOG_BY_CHECK, RepairCatalogEntry
from crate.storage_layout import looks_like_entity_uid
from crate.utils import PHOTO_NAMES, normalize_key
from crate.worker_handlers.migration import build_artist_layout_fix_issue, preview_fix_artist

log = logging.getLogger(__name__)


class LibraryHealthCheck:
    CHECK_METHODS: tuple[tuple[str, str], ...] = tuple(
        (entry.check_type, entry.scanner_method) for entry in REPAIR_CATALOG
    )

    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(
            config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"])
        )

    def run(self, progress_callback=None, persist: bool = True) -> dict:
        return self._run_entries(REPAIR_CATALOG, progress_callback=progress_callback, persist=persist)

    def run_selected(
        self,
        check_types: set[str] | list[str] | tuple[str, ...],
        *,
        progress_callback=None,
        persist: bool = True,
    ) -> dict:
        selected = []
        for check_type in check_types:
            entry = REPAIR_CATALOG_BY_CHECK.get(str(check_type))
            if entry is not None:
                selected.append(entry)
        return self._run_entries(selected, progress_callback=progress_callback, persist=persist)

    def run_selected_for_artists(
        self,
        check_types: set[str] | list[str] | tuple[str, ...],
        artist_names: set[str] | list[str] | tuple[str, ...],
        *,
        progress_callback=None,
        persist: bool = True,
    ) -> dict:
        selected = [
            check_type
            for check_type in sorted({str(value) for value in check_types})
            if check_type in REPAIR_CATALOG_BY_CHECK
        ]
        artists = [str(value).strip() for value in artist_names if str(value).strip()]
        start = time.monotonic()
        issues: list[dict] = []

        total = max(1, len(selected) * max(1, len(artists)))
        done = 0
        for check_type in selected:
            entry = REPAIR_CATALOG_BY_CHECK[check_type]
            for artist_name in artists:
                if progress_callback:
                    progress_callback({"check": check_type, "artist": artist_name, "done": done, "total": total})
                if check_type == "artist_layout_fix":
                    issues.extend(self._check_artist_layout_fix_for_artists([artist_name]))
                else:
                    log.debug("No artist-scoped revalidation implemented for %s", check_type)
                done += 1
                if progress_callback:
                    progress_callback({"check": check_type, "artist": artist_name, "done": done, "total": total})

        if persist:
            self._persist_targeted_issues(issues)
            descriptions_by_check: dict[str, set[str]] = defaultdict(set)
            for issue in issues:
                descriptions_by_check[issue["check"]].add(self._issue_description(issue))
            for check_type in selected:
                resolve_stale_artist_issues(descriptions_by_check.get(check_type, set()), check_type, artists)

        summary: dict[str, int] = {}
        for issue in issues:
            key = issue["check"]
            summary[key] = summary.get(key, 0) + 1

        return {
            "issues": issues,
            "summary": summary,
            "check_count": len(selected),
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": int((time.monotonic() - start) * 1000),
            "artist_count": len(artists),
        }

    def _persist_issues(self, issues: list[dict], entries: list[RepairCatalogEntry]) -> None:
        by_type: dict[str, set[str]] = defaultdict(set)
        for issue in issues:
            desc = self._issue_description(issue)
            by_type[issue["check"]].add(desc)
            upsert_health_issue(
                check_type=issue["check"],
                severity=issue.get("severity", "medium"),
                description=desc,
                details=issue.get("details"),
                auto_fixable=issue.get("auto_fixable", False),
            )
        for entry in entries:
            descriptions = by_type.get(entry.check_type, set())
            resolve_stale_issues(descriptions, entry.check_type)

    def _persist_targeted_issues(self, issues: list[dict]) -> None:
        for issue in issues:
            desc = self._issue_description(issue)
            upsert_health_issue(
                check_type=issue["check"],
                severity=issue.get("severity", "medium"),
                description=desc,
                details=issue.get("details"),
                auto_fixable=issue.get("auto_fixable", False),
            )

    def _issue_description(self, issue: dict) -> str:
        return issue.get("description") or str(issue.get("details", {})).replace("{", "").replace("}", "").replace("'", "")[:200]

    def _run_entries(self, entries: list[RepairCatalogEntry] | tuple[RepairCatalogEntry, ...], *, progress_callback=None, persist: bool = True) -> dict:
        start = time.monotonic()
        issues = []
        checks = [
            (entry, getattr(self, entry.scanner_method))
            for entry in entries
        ]

        for i, (entry, check_fn) in enumerate(checks):
            if progress_callback:
                progress_callback({"check": entry.check_type, "done": i, "total": len(checks)})
            try:
                found = [self._normalize_issue(entry, issue) for issue in check_fn()]
                issues.extend(found)
            except Exception:
                log.exception("Health check '%s' failed", entry.check_type)

        duration_ms = int((time.monotonic() - start) * 1000)
        summary = {}
        for issue in issues:
            key = issue["check"]
            summary[key] = summary.get(key, 0) + 1

        if persist:
            self._persist_issues(issues, [entry for entry, _ in checks])

        return {
            "issues": issues,
            "summary": summary,
            "check_count": len(checks),
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
        }

    def _normalize_issue(self, entry: RepairCatalogEntry, issue: dict) -> dict:
        normalized = dict(issue)
        normalized["check"] = entry.check_type
        normalized["auto_fixable"] = entry.auto_fixable
        return normalized

    def _first_audio_albumartist(self, folder: Path) -> str | None:
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix.lower() in self.extensions:
                tags = read_tags(f)
                return tags.get("albumartist") or None
        # Check subdirectories (album folders)
        for sub in sorted(folder.iterdir()):
            if sub.is_dir():
                for f in sorted(sub.iterdir()):
                    if f.is_file() and f.suffix.lower() in self.extensions:
                        tags = read_tags(f)
                        return tags.get("albumartist") or None
        return None

    # ── Checks ────────────────────────────────────────────────────

    def _check_duplicate_folders(self) -> list[dict]:
        if not self.library_path.is_dir():
            return []
        groups: dict[str, list[str]] = defaultdict(list)
        for d in self.library_path.iterdir():
            if d.is_dir():
                groups[normalize_key(d.name)].append(d.name)
        issues = []
        for norm, folders in groups.items():
            if len(folders) > 1:
                issues.append({
                    "check": "duplicate_folders",
                    "severity": "high",
                    "auto_fixable": True,
                    "details": {"folders": sorted(folders), "normalized": norm},
                })
        return issues

    def _check_canonical_mismatch(self) -> list[dict]:
        issues = []
        artists = get_artists_with_folder()
        for row in artists:
            db_name = row["name"]
            folder_name = row["folder_name"]
            folder_path = self.library_path / folder_name
            if not folder_path.is_dir():
                continue
            tag_name = self._first_audio_albumartist(folder_path)
            if tag_name and tag_name != db_name:
                issues.append({
                    "check": "canonical_mismatch",
                    "severity": "medium",
                    "auto_fixable": True,
                    "details": {
                        "artist": db_name,
                        "folder": folder_name,
                        "tag_name": tag_name,
                    },
                })
        return issues

    def _check_artist_layout_fix(self) -> list[dict]:
        issues = []
        preview_config = {
            "library_path": str(self.library_path),
            "audio_extensions": sorted(self.extensions),
        }
        for artist in get_all_artists():
            try:
                preview = preview_fix_artist(self.library_path, artist, preview_config)
            except Exception:
                log.exception("Artist layout preview failed for %s", artist.get("name"))
                continue
            issue = build_artist_layout_fix_issue(preview)
            if issue:
                issues.append(issue)
        return issues

    def _check_artist_layout_fix_for_artists(self, artist_names: list[str]) -> list[dict]:
        issues = []
        preview_config = {
            "library_path": str(self.library_path),
            "audio_extensions": sorted(self.extensions),
        }
        for artist_name in artist_names:
            artist = get_library_artist(artist_name)
            if not artist:
                continue
            try:
                preview = preview_fix_artist(self.library_path, artist, preview_config)
            except Exception:
                log.exception("Artist layout preview failed for %s", artist.get("name"))
                continue
            issue = build_artist_layout_fix_issue(preview)
            if issue:
                issues.append(self._normalize_issue(REPAIR_CATALOG_BY_CHECK["artist_layout_fix"], issue))
        return issues

    def _check_fk_orphan_albums(self) -> list[dict]:
        rows = get_orphan_albums()
        return [
            {
                "check": "fk_orphan_albums",
                "severity": "critical",
                "auto_fixable": True,
                "details": {"album": r["name"], "artist": r["artist"], "path": r["path"]},
            }
            for r in rows
        ]

    def _check_fk_orphan_tracks(self) -> list[dict]:
        rows = get_orphan_tracks()
        return [
            {
                "check": "fk_orphan_tracks",
                "severity": "critical",
                "auto_fixable": True,
                "details": {"track_path": r["path"], "album_id": r["album_id"]},
            }
            for r in rows
        ]

    def _check_stale_artists(self) -> list[dict]:
        artists = get_all_artists()
        issues = []
        for row in artists:
            folder = row["folder_name"] or row["name"]
            expected = self.library_path / folder
            if not expected.is_dir():
                issues.append({
                    "check": "stale_artists",
                    "severity": "medium",
                    "auto_fixable": True,
                    "details": {"artist": row["name"], "expected_path": str(expected)},
                })
        return issues

    def _check_stale_albums(self) -> list[dict]:
        albums = get_all_albums()
        issues = []
        for row in albums:
            if not Path(row["path"]).is_dir():
                issues.append({
                    "check": "stale_albums",
                    "severity": "medium",
                    "auto_fixable": True,
                    "details": {
                        "album": row["name"],
                        "artist": row["artist"],
                        "path": row["path"],
                    },
                })
        return issues

    def _check_stale_tracks(self) -> list[dict]:
        tracks = get_tracks_sample(total_threshold=5000, modulo=10)
        issues = []
        for row in tracks:
            if not Path(row["path"]).is_file():
                issues.append({
                    "check": "stale_tracks",
                    "severity": "low",
                    "auto_fixable": True,
                    "details": {"track_path": row["path"], "artist": row["artist"]},
                })
        return issues

    def _check_zombie_artists(self) -> list[dict]:
        rows = get_zombie_artists()
        return [
            {
                "check": "zombie_artists",
                "severity": "low",
                "auto_fixable": True,
                "details": {"artist": r["name"]},
            }
            for r in rows
        ]

    def _check_has_photo_desync(self) -> list[dict]:
        artists = get_artists_with_photo()
        issues = []
        for row in artists:
            folder = row["folder_name"] or row["name"]
            artist_dir = self.library_path / folder
            if not artist_dir.is_dir():
                continue
            fs_has_photo = any(
                (artist_dir / p).is_file() for p in PHOTO_NAMES
            )
            db_has_photo = bool(row["has_photo"])
            if fs_has_photo != db_has_photo:
                issues.append({
                    "check": "has_photo_desync",
                    "severity": "low",
                    "auto_fixable": True,
                    "details": {
                        "artist": row["name"],
                        "db_has_photo": db_has_photo,
                        "fs_has_photo": fs_has_photo,
                    },
                })
        return issues

    def _check_duplicate_albums(self) -> list[dict]:
        rows = get_duplicate_albums()
        return [
            {
                "check": "duplicate_albums",
                "severity": "medium",
                "details": {
                    "artist": r["artist"],
                    "album": r["album_name"],
                    "count": r["cnt"],
                    "paths": r.get("paths", []),
                },
            }
            for r in rows
        ]

    def _check_duplicate_tracks(self) -> list[dict]:
        """Detect tracks that appear multiple times in the same album
        (same artist + title, different file paths)."""
        rows = get_duplicate_tracks()
        return [
            {
                "check": "duplicate_tracks",
                "severity": "medium",
                "details": {
                    "artist": r["artist"],
                    "album": r["album"],
                    "title": r["title"],
                    "count": r["cnt"],
                    "paths": r.get("paths", []),
                },
            }
            for r in rows
        ]

    def _check_unindexed_files(self) -> list[dict]:
        if not self.library_path.is_dir():
            return []
        # Collect all DB track paths
        db_paths = get_all_track_paths()

        unindexed_by_dir: dict[str, int] = defaultdict(int)
        for audio_file in self.library_path.rglob("*"):
            if not audio_file.is_file() or audio_file.suffix.lower() not in self.extensions:
                continue
            # Skip hidden dirs and trash
            if any(part.startswith(".") for part in audio_file.parts):
                continue
            if str(audio_file) not in db_paths:
                unindexed_by_dir[str(audio_file.parent)] += 1

        return [
            {
                "check": "unindexed_files",
                "severity": "low",
                "auto_fixable": True,
                "description": f"unindexed_files:{dir_path}",
                "details": {"dir": dir_path, "count": count},
            }
            for dir_path, count in sorted(unindexed_by_dir.items())
        ]

    def _check_tag_mismatch(self) -> list[dict]:
        tracks = get_tracks_tag_sample(total_threshold=5000, modulo=20)
        issues = []
        for row in tracks:
            track_path = Path(row["path"])
            if not track_path.is_file():
                continue
            tags = read_tags(track_path)
            tag_artist = tags.get("albumartist")
            if tag_artist and tag_artist != row["artist"]:
                issues.append({
                    "check": "tag_mismatch",
                    "severity": "medium",
                    "auto_fixable": True,
                    "details": {
                        "track_path": row["path"],
                        "db_artist": row["artist"],
                        "tag_artist": tag_artist,
                    },
                })
        return issues

    def _check_folder_naming(self) -> list[dict]:
        """Check album folders match expected structure: Artist/Year/AlbumName.

        Expected: /music/Quicksand/1993/Slip/
        Wrong:    /music/Quicksand/Slip/
        Wrong:    /music/Quicksand/1993 - Slip/
        """
        if not self.library_path.is_dir():
            return []

        issues = []
        year_prefix_re = re.compile(r"^(\d{4})\s*[-–]\s*(.+)$")

        albums = get_albums_with_year()

        for row in albums:
            folder_name = row["name"]
            artist = row["artist"]
            year = row["year"][:4]
            album_path = row["path"]

            # Skip entity-managed albums — their paths are UUID-based by design
            if album_path:
                parts = Path(album_path).parts
                if len(parts) >= 2 and looks_like_entity_uid(parts[-1]):
                    continue

            # Strip year prefix from folder name to get clean album name
            m = year_prefix_re.match(folder_name)
            clean_name = m.group(2).strip() if m else folder_name

            # Expected structure: Artist/Year/CleanAlbumName
            artist_dir = self.library_path / artist
            expected_dir = artist_dir / year / clean_name
            current_dir = Path(album_path) if album_path else artist_dir / folder_name

            if current_dir == expected_dir:
                continue  # Already correct

            # Determine what's wrong
            if m:
                reason = f"Year prefix in folder name — should be under {year}/ subdirectory"
            elif current_dir.parent == artist_dir:
                reason = f"Album directly under artist — should be under {year}/ subdirectory"
            else:
                reason = f"Unexpected structure"

            issues.append({
                "check": "folder_naming",
                "severity": "low",
                "auto_fixable": True,
                "details": {
                    "artist": artist,
                    "current_folder": folder_name,
                    "clean_name": clean_name,
                    "year": year,
                    "current_path": str(current_dir),
                    "expected_path": str(expected_dir),
                    "reason": reason,
                    "path": album_path,
                },
            })

        return issues

    def _check_missing_covers(self) -> list[dict]:
        """Albums without cover art (file on disk or embedded in audio).

        Two-stage strategy to avoid hangs and stay fast on a 4400-album library:
          1) Pure-stat pass — for every album, check the well-known cover
             filenames. This handles ~95% of cases in O(album_count * 4) syscalls.
          2) For the residue (no cover file), parallelize an embedded-art probe
             using mutagen with a 5s per-file ceiling so a corrupt FLAC can't
             stall the whole check. We previously called the Rust CLI here but
             it serializes every track tag for the entire library and routinely
             blew the 600s task budget.
        """
        cover_names = {"cover.jpg", "cover.png", "folder.jpg", "folder.png"}
        albums = get_all_albums_for_covers()

        candidates: list[dict] = []
        for row in albums:
            album_dir = Path(row["path"])
            if not album_dir.is_dir():
                continue
            if any((album_dir / c).exists() for c in cover_names):
                continue  # cover file present, no need to read audio
            candidates.append({**row, "_dir": album_dir})

        if not candidates:
            return []

        from concurrent.futures import ThreadPoolExecutor, wait

        def _has_embedded(album_dir: Path) -> bool:
            import mutagen

            for f in album_dir.iterdir():
                if not f.is_file() or f.suffix.lower() not in self.extensions:
                    continue
                try:
                    audio = mutagen.File(f)
                except Exception:
                    return False
                if audio is None:
                    return False
                # FLAC / Ogg / Opus expose pictures directly.
                pictures = getattr(audio, "pictures", None)
                if pictures:
                    return True
                tags = getattr(audio, "tags", None)
                if tags:
                    try:
                        keys = list(tags.keys()) if hasattr(tags, "keys") else list(tags)
                    except Exception:
                        return False
                    for key in keys:
                        # ID3 frames are strings; FLAC VComment yields tuples
                        # whose first member never starts with APIC, hence the
                        # isinstance guard prevents the AttributeError that
                        # historically crashed the cover endpoint.
                        if isinstance(key, str) and key.startswith("APIC"):
                            return True
                return False
            return False

        # 8 worker threads is plenty — the bottleneck is disk seeks, not CPU.
        # We use a hard wall-clock budget so a single corrupt file can't
        # stall the whole check; anything that hasn't reported by then is
        # treated as "no embedded art" (which is the conservative default —
        # the user will see it as a missing_cover issue and can investigate).
        executor = ThreadPoolExecutor(max_workers=8)
        budget_seconds = max(60.0, len(candidates) * 0.5)
        try:
            futures = {
                executor.submit(_has_embedded, c["_dir"]): c for c in candidates
            }
            done, not_done = wait(futures.keys(), timeout=budget_seconds)
        finally:
            # Don't wait for stragglers; if a mutagen call hung, the thread
            # will stay alive but the daemon worker process will reap it on
            # exit. The Python `concurrent.futures` API does not support
            # cancelling already-running futures, hence the lack of
            # cancel_futures here.
            executor.shutdown(wait=False)

        if not_done:
            log.warning(
                "missing_covers: %d albums timed out after %.0fs, treating as missing",
                len(not_done),
                budget_seconds,
            )

        issues: list[dict] = []
        for future, row in futures.items():
            if future in done:
                try:
                    has_cover = future.result(timeout=0)
                except Exception:
                    has_cover = False
            else:
                has_cover = False
            if has_cover:
                continue
            album_dir = row["_dir"]
            issues.append({
                "check": "missing_cover",
                "severity": "low",
                "auto_fixable": True,
                "description": f"Missing cover: {row['artist']} / {row['name']}",
                "details": {
                    "artist": row["artist"],
                    "album": row["name"],
                    "path": str(album_dir),
                },
            })

        return issues
