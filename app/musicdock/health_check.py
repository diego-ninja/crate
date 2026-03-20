import logging
import re
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from musicdock.audio import read_tags
from musicdock.db import get_db_ctx

log = logging.getLogger(__name__)

PHOTO_NAMES = {"artist.jpg", "artist.png", "photo.jpg"}


class LibraryHealthCheck:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(
            config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"])
        )

    def run(self, progress_callback=None) -> dict:
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

        return {
            "issues": issues,
            "summary": summary,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
        }

    @staticmethod
    def _normalize_key(name: str) -> str:
        name = unicodedata.normalize("NFC", name.lower().strip())
        for ch in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d":
            name = name.replace(ch, "-")
        name = re.sub(r"\s+", " ", name)
        name = re.sub(r"-+", "-", name)
        return name

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
                groups[self._normalize_key(d.name)].append(d.name)
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
                    "WHERE id %% 10 = 0"
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
            if audio_file.is_file() and audio_file.suffix.lower() in self.extensions:
                if str(audio_file) not in db_paths:
                    unindexed_by_dir[str(audio_file.parent)] += 1

        return [
            {
                "check": "unindexed_files",
                "severity": "low",
                "auto_fixable": True,
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
                    "WHERE id %% 20 = 0"
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
                    "auto_fixable": False,
                    "details": {
                        "track_path": row["path"],
                        "db_artist": row["artist"],
                        "tag_artist": tag_artist,
                    },
                })
        return issues
