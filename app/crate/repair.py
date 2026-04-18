import logging
import shutil
from pathlib import Path

from crate.db.audit import log_audit
from crate.db.jobs.repair import (
    count_artist_tracks,
    find_artist_canonical,
    find_canonical_artist_by_folder,
    merge_album_folder,
    reassign_album_artist,
    rename_artist,
    update_album_path_and_name,
    update_artist_has_photo,
    update_track_artist,
)
from crate.db.library import delete_album, delete_artist, delete_track, upsert_artist
from crate.utils import PHOTO_NAMES

log = logging.getLogger(__name__)


class LibraryRepair:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))

    def repair(self, report: dict, dry_run: bool = True, auto_only: bool = True,
               task_id: str | None = None, progress_callback=None) -> dict:
        issues = report.get("issues", [])
        actions = []
        resolved_ids: list[int] = []
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
            "tag_mismatch": self._fix_tag_mismatch,
            "folder_naming": self._fix_folder_naming,
            "missing_cover": self._fix_missing_cover,
        }

        by_check: dict[str, list[dict]] = {}
        for issue in issues:
            # Normalize: DB uses check_type/details_json, health_check uses check/details
            check = issue.get("check") or issue.get("check_type", "")
            if "details" not in issue and "details_json" in issue:
                issue["details"] = issue["details_json"]
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
                            issue_id = issue.get("id")
                            if isinstance(issue_id, int):
                                resolved_ids.append(issue_id)
                except Exception:
                    log.exception("Repair failed for %s: %s", check, issue)

        return {
            "actions": actions,
            "fs_changed": fs_changed,
            "db_changed": db_changed,
            "resolved_ids": resolved_ids,
        }

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
        row = find_artist_canonical(album_artist)

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
            reassign_album_artist(album_path, canonical)
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
        # has_photo is an INTEGER column; JSONB deserializes `true`/`false` to
        # Python bool which Postgres refuses to coerce implicitly. Normalize.
        fs_has_photo = 1 if details.get("fs_has_photo") else 0

        result = {
            "action": "fix_has_photo",
            "target": artist_name,
            "details": {"new_value": fs_has_photo},
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            update_artist_has_photo(artist_name, fs_has_photo)
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
            rename_artist(artist_name, tag_name, details.get("folder", ""))
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
            "applied": False,
            "fs_write": False,
        }

        if dry_run:
            result["applied"] = True  # dry_run: always "applied" in the sense of "would apply"
            return result

        import re
        unindexed_dir = Path(dir_path)
        if not unindexed_dir.exists():
            result["details"]["missing"] = True
            result["applied"] = True  # dir is gone, nothing to index — treat as resolved
            return result

        try:
            dir_parts = unindexed_dir.relative_to(self.library_path).parts
        except ValueError:
            result["details"]["outside_library"] = True
            return result
        folder_artist_name = dir_parts[0] if dir_parts else ""

        # Check if this is a "YYYY - AlbumName" residue with a correct "YYYY/AlbumName" already indexed
        folder_name = unindexed_dir.name
        year_prefix = re.match(r"^(\d{4})\s*[-–]\s*(.+)$", folder_name)
        if year_prefix and folder_artist_name:
            year, clean_name = year_prefix.group(1), year_prefix.group(2).strip()
            correct_dir = self.library_path / folder_artist_name / year / clean_name
            if correct_dir.is_dir():
                # Duplicate residue — merge into correct dir and remove
                src_files = {f.name for f in unindexed_dir.iterdir() if f.is_file()}
                dst_files = {f.name for f in correct_dir.iterdir() if f.is_file()}
                for name in src_files - dst_files:
                    shutil.move(str(unindexed_dir / name), str(correct_dir / name))
                shutil.rmtree(str(unindexed_dir))
                result["action"] = "remove_duplicate_folder"
                result["details"]["removed"] = str(unindexed_dir)
                result["details"]["merged_into"] = str(correct_dir)
                result["applied"] = True
                result["fs_write"] = True
                log_audit("remove_duplicate_folder", "album", f"{folder_artist_name}/{folder_name}",
                          details=result["details"], task_id=task_id)
                return result

        # Check for a duplicate album folder pattern: a loose `/Artist/Album`
        # dir that collides with a canonical `/Artist/YYYY/Album` already
        # indexed in the DB. Classify and act before the sync path (which
        # would hit UNIQUE(artist, name) and silently fail).
        if folder_artist_name:
            try:
                from crate.duplicate_album import classify_duplicate_album, apply_duplicate_resolution

                verdict = classify_duplicate_album(unindexed_dir, self.library_path)
                if verdict.action in ("delete_loose", "merge_into_canonical"):
                    action_result = apply_duplicate_resolution(verdict, dry_run=dry_run)
                    result["action"] = verdict.action
                    result["details"].update(
                        {
                            "canonical_dir": action_result.get("canonical"),
                            "reason": action_result.get("reason"),
                            "loose_tracks": action_result.get("loose_tracks"),
                            "canonical_tracks": action_result.get("canonical_tracks"),
                            "common_tracks": action_result.get("common_tracks"),
                        }
                    )
                    if "moved" in action_result:
                        result["details"]["moved"] = action_result["moved"]
                    result["applied"] = action_result.get("applied", False)
                    result["fs_write"] = action_result.get("fs_write", False)
                    log_audit(
                        verdict.action,
                        "album",
                        f"{folder_artist_name}/{folder_name}",
                        details=result["details"],
                        task_id=task_id,
                    )
                    return result
                elif verdict.action == "manual" and verdict.canonical_dir is not None:
                    # Leave the issue open with a clear reason so a human can
                    # resolve the distinct-release / partial-overlap case.
                    result["details"]["duplicate_classification"] = "manual"
                    result["details"]["canonical_dir"] = str(verdict.canonical_dir)
                    result["details"]["reason"] = verdict.reason
                    return result
            except Exception:
                log.debug("duplicate_album classifier failed for %s", unindexed_dir, exc_info=True)

        # Not a residue — sync files into DB, then enrich
        if not folder_artist_name:
            result["details"]["no_artist_folder"] = True
            return result

        # Resolve canonical artist name from DB (folder name may differ from canonical)
        canonical_artist = folder_artist_name
        try:
            row = find_canonical_artist_by_folder(folder_artist_name)
            if row:
                canonical_artist = row["name"]
        except Exception:
            log.debug("Could not resolve canonical artist for %s", folder_artist_name, exc_info=True)

        try:
            from crate.library_sync import LibrarySync
            from crate.config import load_config
            syncer = LibrarySync(load_config())
            artist_dir = self.library_path / folder_artist_name
            if not artist_dir.is_dir():
                result["details"]["artist_dir_missing"] = True
                return result
            tracks_before = self._count_artist_tracks(canonical_artist)
            syncer.sync_artist(artist_dir)
            tracks_after = self._count_artist_tracks(canonical_artist)
            result["action"] = "reindex_unindexed"
            result["details"]["synced"] = True
            result["details"]["tracks_before"] = tracks_before
            result["details"]["tracks_after"] = tracks_after
            # Only claim the fix actually landed if sync imported new rows.
            # If tracks_after == tracks_before the sync silently failed on this
            # album (most often: UNIQUE(artist, name) conflict against a
            # duplicate album already indexed under a different path). Leaving
            # applied=False keeps the issue open so a human can merge the
            # duplicate, instead of resolving it only for the next health
            # check to re-create it.
            if tracks_after > tracks_before:
                result["applied"] = True
            else:
                result["details"]["no_progress"] = True
                result["details"]["reason"] = (
                    "sync completed but no new tracks were indexed — likely a "
                    "duplicate album folder or UNIQUE(artist, name) conflict"
                )
        except Exception as exc:
            log.warning("Failed to sync unindexed dir %s", dir_path, exc_info=True)
            result["details"]["sync_error"] = str(exc)[:200]
            return result

        # Report the affected canonical artist so _handle_repair can queue
        # process_new_content once per artist after the full batch, instead of
        # re-enqueueing per-album and flooding dedup.
        if result.get("applied"):
            result["details"]["enrich_artist"] = canonical_artist
        log_audit("reindex_unindexed", "directory", dir_path,
                  details={"count": details.get("count", 0), "artist": canonical_artist}, task_id=task_id)
        return result

    def _count_artist_tracks(self, artist_name: str) -> int:
        try:
            return count_artist_tracks(artist_name)
        except Exception:
            return 0

    def _fix_tag_mismatch(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        """Update DB track artist to match the albumartist tag (tag is source of truth)."""
        details = issue.get("details", {})
        track_path = details.get("track_path", "")
        tag_artist = details.get("tag_artist", "")

        if not tag_artist:
            return None

        result = {
            "action": "fix_tag_mismatch",
            "target": track_path,
            "details": {"old_artist": details.get("db_artist"), "new_artist": tag_artist},
            "applied": not dry_run,
            "fs_write": False,
        }

        if not dry_run:
            update_track_artist(track_path, tag_artist)
            log_audit("fix_tag_mismatch", "track", track_path,
                      details={"old_artist": details.get("db_artist"), "new_artist": tag_artist},
                      task_id=task_id)

        return result

    def _fix_folder_naming(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        """Move album folder to expected structure: Artist/Year/AlbumName."""
        details = issue.get("details", {})
        artist = details.get("artist", "")
        clean_name = details.get("clean_name", "")
        year = details.get("year", "")
        current_path = details.get("current_path", "")
        expected_path = details.get("expected_path", "")

        if not current_path or not expected_path or current_path == expected_path:
            return None

        current_dir = Path(current_path)
        expected_dir = Path(expected_path)

        result = {
            "action": "reorganize_album_folder",
            "target": f"{artist}/{details.get('current_folder', '')}",
            "details": {
                "from": str(current_dir.relative_to(self.library_path)),
                "to": str(expected_dir.relative_to(self.library_path)),
                "reason": details.get("reason", ""),
            },
            "applied": not dry_run,
            "fs_write": True,
        }

        if not dry_run:
            if not current_dir.is_dir():
                result["applied"] = False
                result["details"]["error"] = "Source folder not found"
                return result

            if expected_dir.exists() and expected_dir != current_dir:
                # Smart merge: copy missing files, upgrade lossy→lossless
                QUALITY_RANK = {".flac": 3, ".wav": 3, ".alac": 3, ".ogg": 2, ".opus": 2, ".m4a": 2, ".mp3": 1}
                src_files = {f.name: f for f in current_dir.iterdir() if f.is_file()}
                dst_files = {f.name: f for f in expected_dir.iterdir() if f.is_file()}
                # Build stem→file maps for quality comparison
                src_by_stem: dict[str, Path] = {}
                for f in current_dir.iterdir():
                    if f.is_file():
                        src_by_stem[f.stem.lower()] = f
                dst_by_stem: dict[str, Path] = {}
                for f in expected_dir.iterdir():
                    if f.is_file():
                        dst_by_stem[f.stem.lower()] = f
                copied = []
                upgraded = []
                for name, src_file in src_files.items():
                    if name not in dst_files:
                        # Check if dest has same track in lower quality
                        stem = src_file.stem.lower()
                        dst_match = dst_by_stem.get(stem)
                        src_rank = QUALITY_RANK.get(src_file.suffix.lower(), 0)
                        if dst_match and src_rank > QUALITY_RANK.get(dst_match.suffix.lower(), 0):
                            # Source is higher quality — replace
                            dst_match.unlink()
                            shutil.move(str(src_file), str(expected_dir / src_file.name))
                            upgraded.append(f"{dst_match.name} → {src_file.name}")
                        elif not dst_match:
                            shutil.move(str(src_file), str(expected_dir / name))
                            copied.append(name)
                shutil.rmtree(str(current_dir))
                log.info("Merged %s → %s (%d copied, %d upgraded, folder removed)",
                         current_dir, expected_dir, len(copied), len(upgraded))
                old_path_str = str(current_dir)
                new_path_str = str(expected_dir)
                merge_album_folder(details.get("path", old_path_str), new_path_str, clean_name)
                result["details"]["merged"] = True
                result["details"]["files_copied"] = len(copied)
                result["details"]["files_upgraded"] = upgraded
                log_audit("merge_duplicate_album_folder", "album", f"{artist}/{year}/{clean_name}",
                          details=result["details"], task_id=task_id)
                return result

            try:
                # Create year subdirectory if needed
                expected_dir.parent.mkdir(parents=True, exist_ok=True)
                # Move album folder
                shutil.move(str(current_dir), str(expected_dir))
                # Update DB
                old_path_str = str(current_dir)
                new_path_str = str(expected_dir)
                update_album_path_and_name(details.get("path", old_path_str), new_path_str, clean_name)
                log_audit("reorganize_album_folder", "album", f"{artist}/{year}/{clean_name}",
                          details=result["details"], task_id=task_id)
            except Exception as e:
                log.error("Failed to reorganize folder %s -> %s: %s", current_dir, expected_dir, e)
                result["applied"] = False
                result["details"]["error"] = str(e)

        return result

    def _fix_missing_cover(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        from crate.artwork import fetch_cover_from_caa, fetch_cover_from_tidal, extract_embedded_cover, save_cover
        from crate.audio import get_audio_files

        details = issue.get("details", {})
        artist = details.get("artist", "")
        album = details.get("album", "")
        album_path = details.get("path", "")

        if not album_path:
            return None

        album_dir = Path(album_path)

        result = {
            "action": "fetch_missing_cover",
            "target": f"{artist}/{album}",
            "applied": not dry_run,
            "fs_write": True,
        }

        if dry_run:
            return result

        image_data: bytes | None = None
        source = None

        mbid = details.get("mbid")
        if mbid:
            image_data = fetch_cover_from_caa(mbid)
            if image_data:
                source = "caa"

        if not image_data and artist and album:
            image_data = fetch_cover_from_tidal(artist, album)
            if image_data:
                source = "tidal"

        if not image_data:
            tracks = get_audio_files(album_dir, self.extensions)
            for track in tracks:
                image_data = extract_embedded_cover(track)
                if image_data:
                    source = "embedded"
                    break

        if image_data:
            save_cover(album_dir, image_data)
            result["details"] = {"source": source}
            log_audit("fetch_missing_cover", "album", f"{artist}/{album}",
                      details={"source": source, "path": album_path}, task_id=task_id)
        else:
            result["applied"] = False
            result["details"] = {"error": "no cover source found"}

        return result
