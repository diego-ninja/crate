import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from crate.audio import read_tags
from crate.db import get_db_ctx
from crate.db.health import upsert_health_issue, resolve_stale_issues
from crate.utils import PHOTO_NAMES, normalize_key

log = logging.getLogger(__name__)


class LibraryHealthCheck:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(
            config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"])
        )

    def run(self, progress_callback=None, persist: bool = True) -> dict:
        start = time.monotonic()
        issues = []

        checks = [
            ("duplicate_folders", self._check_duplicate_folders),
            ("canonical_mismatch", self._check_canonical_mismatch),
            ("fk_orphan_albums", self._check_fk_orphan_albums),
            ("fk_orphan_tracks", self._check_fk_orphan_tracks),
            ("stale_artists", self._check_stale_artists),
            ("stale_albums", self._check_stale_albums),
            ("stale_tracks", self._check_stale_tracks),
            ("zombie_artists", self._check_zombie_artists),
            ("has_photo_desync", self._check_has_photo_desync),
            ("duplicate_albums", self._check_duplicate_albums),
            ("unindexed_files", self._check_unindexed_files),
            ("tag_mismatch", self._check_tag_mismatch),
            ("folder_naming", self._check_folder_naming),
            ("missing_cover", self._check_missing_covers),
        ]

        for i, (name, check_fn) in enumerate(checks):
            if progress_callback:
                progress_callback({"check": name, "done": i, "total": len(checks)})
            try:
                found = check_fn()
                issues.extend(found)
            except Exception:
                log.exception("Health check '%s' failed", name)

        duration_ms = int((time.monotonic() - start) * 1000)
        summary = {}
        for issue in issues:
            key = issue["check"]
            summary[key] = summary.get(key, 0) + 1

        # Persist to health_issues table
        if persist:
            # Group by check type for stale resolution
            by_type: dict[str, set[str]] = defaultdict(set)
            for issue in issues:
                # Build description from details if not present
                desc = issue.get("description") or str(issue.get("details", {})
                    ).replace("{", "").replace("}", "").replace("'", "")[:200]
                by_type[issue["check"]].add(desc)
                upsert_health_issue(
                    check_type=issue["check"],
                    severity=issue.get("severity", "medium"),
                    description=desc,
                    details=issue.get("details"),
                    auto_fixable=issue.get("auto_fixable", False),
                )
            # Auto-resolve issues that no longer exist in this scan
            for check_name, _ in checks:
                descriptions = by_type.get(check_name, set())
                resolve_stale_issues(descriptions, check_name)

        return {
            "issues": issues,
            "summary": summary,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
        }

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
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT name, folder_name FROM library_artists WHERE folder_name IS NOT NULL"
            )
            artists = cur.fetchall()
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

    def _check_fk_orphan_albums(self) -> list[dict]:
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT name, artist, path FROM library_albums "
                "WHERE artist NOT IN (SELECT name FROM library_artists)"
            )
            rows = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT path, album_id FROM library_tracks "
                "WHERE album_id NOT IN (SELECT id FROM library_albums)"
            )
            rows = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute("SELECT name, folder_name FROM library_artists")
            artists = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute("SELECT name, artist, path FROM library_albums")
            albums = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
            total = cur.fetchone()["cnt"]
            if total < 5000:
                cur.execute("SELECT path, artist FROM library_tracks")
            else:
                cur.execute(
                    "SELECT path, artist FROM library_tracks "
                    "WHERE MOD(id, 10) = 0"
                )
            tracks = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT name FROM library_artists "
                "WHERE album_count = 0 AND track_count = 0"
            )
            rows = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute("SELECT name, folder_name, has_photo FROM library_artists")
            artists = cur.fetchall()
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
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT artist, LOWER(name) AS album_key, MIN(name) AS album_name, COUNT(*) AS cnt "
                "FROM library_albums GROUP BY artist, LOWER(name) HAVING COUNT(*) > 1"
            )
            rows = cur.fetchall()
        return [
            {
                "check": "duplicate_albums",
                "severity": "medium",
                "auto_fixable": False,
                "details": {
                    "artist": r["artist"],
                    "album": r["album_name"],
                    "count": r["cnt"],
                },
            }
            for r in rows
        ]

    def _check_unindexed_files(self) -> list[dict]:
        if not self.library_path.is_dir():
            return []
        # Collect all DB track paths
        with get_db_ctx() as cur:
            cur.execute("SELECT path FROM library_tracks")
            db_paths = {r["path"] for r in cur.fetchall()}

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
        with get_db_ctx() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
            total = cur.fetchone()["cnt"]
            if total < 5000:
                cur.execute("SELECT path, artist FROM library_tracks")
            else:
                cur.execute(
                    "SELECT path, artist FROM library_tracks "
                    "WHERE MOD(id, 20) = 0"
                )
            tracks = cur.fetchall()
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

        with get_db_ctx() as cur:
            cur.execute(
                "SELECT name, artist, year, path FROM library_albums "
                "WHERE year IS NOT NULL AND year != '' AND length(year) >= 4"
            )
            albums = cur.fetchall()

        for row in albums:
            folder_name = row["name"]
            artist = row["artist"]
            year = row["year"][:4]
            album_path = row["path"]

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
        with get_db_ctx() as cur:
            cur.execute("SELECT artist, name, path FROM library_albums")
            albums = [dict(r) for r in cur.fetchall()]

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
