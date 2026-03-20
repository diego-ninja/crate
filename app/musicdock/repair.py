import logging
import shutil
from pathlib import Path

from musicdock.db import (
    get_db_ctx,
    log_audit,
    delete_artist,
    delete_album,
    delete_track,
    upsert_artist,
)

log = logging.getLogger(__name__)

PHOTO_NAMES = {"artist.jpg", "artist.png", "photo.jpg"}


class LibraryRepair:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))

    def repair(self, report: dict, dry_run: bool = True, auto_only: bool = True,
               task_id: str | None = None, progress_callback=None) -> dict:
        issues = report.get("issues", [])
        actions = []
        fs_changed = False
        db_changed = False

        fixers = {
            "duplicate_folders": self._fix_duplicate_folders,
            "fk_orphan_albums": self._fix_fk_orphans,
            "fk_orphan_tracks": self._fix_fk_orphan_tracks,
            "stale_artists": self._fix_stale_entries,
            "stale_albums": self._fix_stale_albums,
            "stale_tracks": self._fix_stale_tracks,
            "zombie_artists": self._fix_zombie_artists,
            "has_photo_desync": self._fix_has_photo_desync,
            "canonical_mismatch": self._fix_canonical_mismatch,
            "unindexed_files": self._fix_unindexed_files,
        }

        by_check: dict[str, list[dict]] = {}
        for issue in issues:
            check = issue.get("check", "")
            if auto_only and not issue.get("auto_fixable", False):
                continue
            by_check.setdefault(check, []).append(issue)

        total_groups = len(by_check)
        for i, (check, group) in enumerate(by_check.items()):
            if progress_callback:
                progress_callback({"phase": "repair", "fix": check, "done": i, "total": total_groups})

            fixer = fixers.get(check)
            if not fixer:
                continue

            for issue in group:
                try:
                    result = fixer(issue, dry_run=dry_run, task_id=task_id)
                    if result:
                        actions.append(result)
                        if result.get("applied"):
                            if result.get("fs_write"):
                                fs_changed = True
                            else:
                                db_changed = True
                except Exception:
                    log.exception("Repair failed for %s: %s", check, issue)

        return {"actions": actions, "fs_changed": fs_changed, "db_changed": db_changed}

    def _fix_duplicate_folders(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        folders = details.get("folders", [])
        if len(folders) < 2:
            return None

        # Keep the first folder (alphabetically), move contents of others into it
        sorted_folders = sorted(folders)
        primary = self.library_path / sorted_folders[0]
        result = {
            "action": "merge_duplicate_folders",
            "target": sorted_folders[0],
            "details": {"merged_from": sorted_folders[1:]},
            "applied": not dry_run,
            "fs_write": True,
        }

        if dry_run:
            return result

        for other_name in sorted_folders[1:]:
            other_dir = self.library_path / other_name
            if not other_dir.is_dir():
                continue
            for item in other_dir.iterdir():
                dest = primary / item.name
                if not dest.exists():
                    shutil.move(str(item), str(dest))
                    log.info("Moved %s → %s", item, dest)
            # Remove empty dir
            try:
                other_dir.rmdir()
                log.info("Removed empty dir: %s", other_dir)
            except OSError:
                log.warning("Could not remove dir (not empty?): %s", other_dir)

        log_audit("merge_duplicate_folders", "artist", sorted_folders[0],
                  details={"merged_from": sorted_folders[1:]}, task_id=task_id)
        return result

    def _fix_fk_orphans(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        album_artist = details.get("artist", "")
        album_name = details.get("album", "")
        album_path = details.get("path", "")

        # Try to find canonical artist (case-insensitive match)
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT name FROM library_artists WHERE LOWER(name) = LOWER(%s) LIMIT 1",
                (album_artist,),
            )
            row = cur.fetchone()

        result = {
            "action": "fix_orphan_album",
            "target": f"{album_artist}/{album_name}",
            "applied": not dry_run,
            "fs_write": False,
        }

        if dry_run:
            result["details"] = {"would_reassign_to": row["name"] if row else None, "would_delete": not row}
            return result

        if row:
            canonical = row["name"]
            with get_db_ctx() as cur:
                cur.execute("UPDATE library_albums SET artist = %s WHERE path = %s", (canonical, album_path))
            result["details"] = {"reassigned_to": canonical}
            log_audit("fix_orphan_album", "album", album_name,
                      details={"reassigned_to": canonical}, task_id=task_id)
        else:
            delete_album(album_path)
            result["details"] = {"deleted": True}
            log_audit("delete_orphan_album", "album", album_name,
                      details={"artist": album_artist, "path": album_path}, task_id=task_id)

        return result

    def _fix_fk_orphan_tracks(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        track_path = details.get("track_path", "")

        result = {
            "action": "delete_orphan_track",
            "target": track_path,
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            delete_track(track_path)
            log_audit("delete_orphan_track", "track", track_path, task_id=task_id)

        return result

    def _fix_stale_entries(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist_name = details.get("artist", "")

        result = {
            "action": "delete_stale_artist",
            "target": artist_name,
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            delete_artist(artist_name)
            log_audit("delete_stale_artist", "artist", artist_name, task_id=task_id)

        return result

    def _fix_stale_albums(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        path = details.get("path", "")
        album_name = details.get("album", "")

        result = {
            "action": "delete_stale_album",
            "target": f"{details.get('artist', '')}/{album_name}",
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            delete_album(path)
            log_audit("delete_stale_album", "album", album_name,
                      details={"path": path}, task_id=task_id)

        return result

    def _fix_stale_tracks(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        track_path = details.get("track_path", "")

        result = {
            "action": "delete_stale_track",
            "target": track_path,
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            delete_track(track_path)
            log_audit("delete_stale_track", "track", track_path, task_id=task_id)

        return result

    def _fix_zombie_artists(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist_name = details.get("artist", "")

        result = {
            "action": "delete_zombie_artist",
            "target": artist_name,
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            delete_artist(artist_name)
            log_audit("delete_zombie_artist", "artist", artist_name, task_id=task_id)

        return result

    def _fix_has_photo_desync(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist_name = details.get("artist", "")
        fs_has_photo = details.get("fs_has_photo", 0)

        result = {
            "action": "fix_has_photo",
            "target": artist_name,
            "details": {"new_value": fs_has_photo},
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_artists SET has_photo = %s WHERE name = %s",
                    (fs_has_photo, artist_name),
                )
            log_audit("fix_has_photo", "artist", artist_name,
                      details={"new_value": fs_has_photo}, task_id=task_id)

        return result

    def _fix_canonical_mismatch(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist_name = details.get("artist", "")
        tag_name = details.get("tag_name", "")

        if not tag_name:
            return None

        result = {
            "action": "fix_canonical_mismatch",
            "target": artist_name,
            "details": {"tag_name": tag_name},
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            # Update DB artist name to match tag canonical name if different
            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_artists SET folder_name = %s WHERE name = %s",
                    (details.get("folder", ""), artist_name),
                )
            log_audit("fix_canonical_mismatch", "artist", artist_name,
                      details={"tag_name": tag_name}, task_id=task_id)

        return result

    def _fix_unindexed_files(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        dir_path = details.get("dir", "")

        result = {
            "action": "flag_unindexed",
            "target": dir_path,
            "details": {"count": details.get("count", 0)},
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            log_audit("flag_unindexed", "directory", dir_path,
                      details={"count": details.get("count", 0)}, task_id=task_id)

        return result
