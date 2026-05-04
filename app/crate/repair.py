import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

from crate.audio import read_tags
from crate.db.audit import log_audit
from crate.db.jobs.repair import (
    count_artist_tracks,
    find_artist_canonical,
    find_canonical_artist_by_folder,
    get_tracks_by_paths,
    merge_album_folder,
    reassign_album_artist,
    rename_artist,
    update_album_path_and_name,
    update_artist_has_photo,
    update_track_artist,
)
from crate.db.repositories.library import delete_album, delete_artist, delete_track, get_library_artist
from crate.repair_catalog import REPAIR_CATALOG, REPAIR_CATALOG_BY_CHECK
from crate.utils import PHOTO_NAMES
from crate.worker_handlers.migration import _fix_artist, preview_fix_artist

log = logging.getLogger(__name__)


class LibraryRepair:
    FIXER_METHODS: dict[str, str] = {
        entry.check_type: entry.fixer_method
        for entry in REPAIR_CATALOG
        if entry.fixer_method
    }

    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))

    def _normalized_issues(self, report: dict, *, auto_only: bool) -> list[tuple[str, dict, object | None]]:
        normalized: list[tuple[str, dict, object | None]] = []
        for raw_issue in report.get("issues", []):
            issue = dict(raw_issue)
            check = issue.get("check") or issue.get("check_type", "")
            if "details" not in issue and "details_json" in issue:
                issue["details"] = issue["details_json"]
            catalog_entry = REPAIR_CATALOG_BY_CHECK.get(check)
            if catalog_entry is not None:
                issue["auto_fixable"] = catalog_entry.auto_fixable
                issue["support"] = catalog_entry.support
                issue["risk"] = catalog_entry.risk
                issue["scope"] = catalog_entry.scope
                issue["requires_confirmation"] = catalog_entry.requires_confirmation
                issue["supports_batch"] = catalog_entry.supports_batch
                issue["supports_artist_scope"] = catalog_entry.supports_artist_scope
                issue["supports_global_scope"] = catalog_entry.supports_global_scope
            if auto_only and not issue.get("auto_fixable", False):
                continue
            normalized.append((check, issue, catalog_entry))
        return normalized

    def preview(self, report: dict, *, auto_only: bool = False) -> dict:
        items: list[dict] = []
        fixers = {
            check: getattr(self, method_name)
            for check, method_name in self.FIXER_METHODS.items()
        }

        for check, issue, catalog_entry in self._normalized_issues(report, auto_only=auto_only):
            support = getattr(catalog_entry, "support", "manual")
            item = {
                "issue_id": issue.get("id"),
                "check_type": check,
                "severity": issue.get("severity"),
                "description": issue.get("description"),
                "support": support,
                "risk": getattr(catalog_entry, "risk", None),
                "scope": getattr(catalog_entry, "scope", None),
                "requires_confirmation": bool(getattr(catalog_entry, "requires_confirmation", False)),
                "supports_batch": bool(getattr(catalog_entry, "supports_batch", True)),
                "supports_artist_scope": bool(getattr(catalog_entry, "supports_artist_scope", True)),
                "supports_global_scope": bool(getattr(catalog_entry, "supports_global_scope", True)),
                "auto_fixable": bool(issue.get("auto_fixable")),
                "executable": False,
                "action": None,
                "target": None,
                "message": None,
                "fs_write": False,
                "details": None,
                "issue": issue,
            }
            item["item_key"] = self._issue_item_key(check, issue, item.get("target"))
            item["plan_item_id"] = self._issue_plan_item_id(
                check,
                issue,
                target=item.get("target"),
                action=item.get("action"),
            )

            fixer = fixers.get(check)
            if not fixer:
                item["message"] = f"{check.replace('_', ' ').title()} still requires manual repair"
                items.append(item)
                continue

            try:
                result = fixer(issue, dry_run=True, task_id=None)
            except Exception as exc:
                log.exception("Repair preview failed for %s: %s", check, issue)
                item["message"] = f"Preview failed: {exc}"
                item["details"] = {"error": str(exc)}
                items.append(item)
                continue

            if result:
                event_payload = self._build_event_payload(check, result)
                item.update({
                    "executable": bool(issue.get("auto_fixable")),
                    "action": result.get("action"),
                    "target": result.get("target"),
                    "message": event_payload.get("message"),
                    "fs_write": bool(result.get("fs_write")),
                    "details": result.get("details"),
                })
            else:
                item["message"] = f"No automatic action available for {check.replace('_', ' ')}"
            item["item_key"] = self._issue_item_key(check, issue, item.get("target"))
            item["plan_item_id"] = self._issue_plan_item_id(
                check,
                issue,
                target=item.get("target"),
                action=item.get("action"),
            )
            items.append(item)

        plan_version = self._compute_plan_version(items)
        generated_at = datetime.now(timezone.utc).isoformat()

        return {
            "items": items,
            "total": len(items),
            "executable": sum(1 for item in items if item.get("executable")),
            "manual_only": sum(1 for item in items if not item.get("executable")),
            "plan_version": plan_version,
            "generated_at": generated_at,
        }

    def _issue_target(self, check: str, issue: dict) -> str:
        details = issue.get("details") or {}
        artist = str(details.get("artist") or details.get("db_artist") or "").strip()
        album = str(details.get("album") or details.get("album_name") or "").strip()
        title = str(details.get("title") or "").strip()
        path = str(details.get("path") or details.get("track_path") or "").strip()

        if artist and album:
            return f"{artist}/{album}"
        if artist and title:
            return f"{artist}/{title}"
        if artist:
            return artist
        if path:
            return path
        description = str(issue.get("description") or "").strip()
        return description or check

    def _issue_item_key(self, check: str, issue: dict, target: str | None = None) -> str:
        issue_id = issue.get("id")
        if isinstance(issue_id, int):
            return f"issue:{issue_id}"
        resolved_target = str(target or self._issue_target(check, issue) or "item").strip()
        return f"{check}:{resolved_target}"

    def _issue_plan_item_id(
        self,
        check: str,
        issue: dict,
        *,
        target: str | None = None,
        action: str | None = None,
    ) -> str:
        payload = {
            "check_type": check,
            "issue_id": issue.get("id") if isinstance(issue.get("id"), int) else None,
            "item_key": self._issue_item_key(check, issue, target),
            "target": str(target or self._issue_target(check, issue)),
            "action": str(action or check),
        }
        digest = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        return f"repair-plan:{digest[:16]}"

    def _compute_plan_version(self, items: list[dict]) -> str:
        normalized = [
            {
                "plan_item_id": item.get("plan_item_id"),
                "item_key": item.get("item_key"),
                "check_type": item.get("check_type"),
                "action": item.get("action"),
                "target": item.get("target"),
                "message": item.get("message"),
                "risk": item.get("risk"),
                "scope": item.get("scope"),
                "requires_confirmation": item.get("requires_confirmation"),
                "executable": item.get("executable"),
                "details": item.get("details"),
            }
            for item in items
        ]
        digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        return f"repair-preview:{digest[:24]}"

    def _build_item_result(
        self,
        check: str,
        issue: dict,
        *,
        outcome: str,
        message: str,
        level: str,
        result: dict | None = None,
    ) -> dict:
        target = str((result or {}).get("target") or self._issue_target(check, issue))
        catalog_entry = REPAIR_CATALOG_BY_CHECK.get(check)
        action = (result or {}).get("action") or check
        return {
            "issue_id": issue.get("id") if isinstance(issue.get("id"), int) else None,
            "item_key": self._issue_item_key(check, issue, target),
            "plan_item_id": self._issue_plan_item_id(check, issue, target=target, action=str(action)),
            "check_type": check,
            "outcome": outcome,
            "level": level,
            "support": getattr(catalog_entry, "support", None),
            "risk": getattr(catalog_entry, "risk", None),
            "scope": getattr(catalog_entry, "scope", None),
            "requires_confirmation": bool(getattr(catalog_entry, "requires_confirmation", False)),
            "action": action,
            "target": target,
            "applied": bool((result or {}).get("applied")),
            "fs_write": bool((result or {}).get("fs_write")),
            "message": message,
            "details": (result or {}).get("details") or {},
        }

    def _build_item_event_payload(self, item_result: dict) -> dict:
        return {
            "event_type": "item",
            "level": item_result.get("level", "info"),
            "category": "repair",
            "issue_id": item_result.get("issue_id"),
            "item_key": item_result.get("item_key"),
            "plan_item_id": item_result.get("plan_item_id"),
            "check": item_result.get("check_type"),
            "check_type": item_result.get("check_type"),
            "outcome": item_result.get("outcome"),
            "support": item_result.get("support"),
            "risk": item_result.get("risk"),
            "scope": item_result.get("scope"),
            "requires_confirmation": item_result.get("requires_confirmation"),
            "action": item_result.get("action"),
            "target": item_result.get("target"),
            "fs_write": item_result.get("fs_write"),
            "details": item_result.get("details"),
            "message": item_result.get("message"),
        }

    def repair(self, report: dict, dry_run: bool = True, auto_only: bool = True,
               task_id: str | None = None, progress_callback=None, event_callback=None) -> dict:
        issues = report.get("issues", [])
        actions = []
        item_results: list[dict] = []
        resolved_ids: list[int] = []
        unsupported_checks: set[str] = set()
        fs_changed = False
        db_changed = False
        summary = {
            "applied": 0,
            "skipped": 0,
            "failed": 0,
            "unsupported": 0,
        }

        fixers = {
            check: getattr(self, method_name)
            for check, method_name in self.FIXER_METHODS.items()
        }

        by_check: dict[str, list[dict]] = {}
        for check, issue, _catalog_entry in self._normalized_issues({"issues": issues}, auto_only=auto_only):
            by_check.setdefault(check, []).append(issue)

        total_groups = len(by_check)
        for i, (check, group) in enumerate(by_check.items()):
            if progress_callback:
                progress_callback({"phase": "repair", "fix": check, "done": i, "total": total_groups})

            fixer = fixers.get(check)
            if not fixer:
                unsupported_checks.add(check)
                for issue in group:
                    item_result = self._build_item_result(
                        check,
                        issue,
                        outcome="unsupported",
                        message=f"{check.replace('_', ' ').title()} still requires manual repair",
                        level="warning",
                    )
                    item_results.append(item_result)
                    summary["unsupported"] += 1
                    if event_callback:
                        event_callback(self._build_item_event_payload(item_result))
                continue

            for issue in group:
                if event_callback:
                    event_callback(self._build_item_event_payload(self._build_item_result(
                        check,
                        issue,
                        outcome="started",
                        message=f"Starting {check.replace('_', ' ')} for {self._issue_target(check, issue)}",
                        level="info",
                    )))
                try:
                    result = fixer(issue, dry_run=dry_run, task_id=task_id)
                    if result:
                        actions.append(result)
                        if result.get("applied"):
                            outcome = "applied"
                            level = "info"
                            summary["applied"] += 1
                        else:
                            outcome = "skipped"
                            level = "warning"
                            summary["skipped"] += 1
                        item_result = self._build_item_result(
                            check,
                            issue,
                            outcome=outcome,
                            message=self._build_event_payload(check, result)["message"],
                            level=level,
                            result=result,
                        )
                        item_results.append(item_result)
                        if event_callback:
                            event_callback(self._build_item_event_payload(item_result))
                        if result.get("applied"):
                            if result.get("fs_write"):
                                fs_changed = True
                            else:
                                db_changed = True
                            issue_id = issue.get("id")
                            if isinstance(issue_id, int):
                                resolved_ids.append(issue_id)
                    else:
                        item_result = self._build_item_result(
                            check,
                            issue,
                            outcome="skipped",
                            message=f"No automatic action available for {check.replace('_', ' ')}",
                            level="warning",
                        )
                        item_results.append(item_result)
                        summary["skipped"] += 1
                        if event_callback:
                            event_callback(self._build_item_event_payload(item_result))
                except Exception:
                    log.exception("Repair failed for %s: %s", check, issue)
                    target = self._issue_target(check, issue)
                    item_result = self._build_item_result(
                        check,
                        issue,
                        outcome="failed",
                        message=f"Repair failed for {check.replace('_', ' ')}: {target}",
                        level="error",
                        result={"target": target, "details": {"error": "exception"}, "applied": False, "fs_write": False},
                    )
                    item_results.append(item_result)
                    summary["failed"] += 1
                    if event_callback:
                        event_callback(self._build_item_event_payload(item_result))

        return {
            "actions": actions,
            "item_results": item_results,
            "summary": summary,
            "fs_changed": fs_changed,
            "db_changed": db_changed,
            "resolved_ids": resolved_ids,
            "unsupported_checks": sorted(unsupported_checks),
        }

    def _build_event_payload(self, check: str, result: dict) -> dict:
        target = str(result.get("target") or check)
        details = result.get("details") or {}
        action = str(result.get("action") or check).replace("_", " ")
        if result.get("message"):
            message = str(result["message"])
        elif result.get("applied"):
            message = f"Applied {action} on {target}"
        else:
            reason = details.get("reason") or details.get("error") or result.get("reason")
            message = f"Skipped {action} on {target}"
            if reason:
                message += f": {reason}"
        return {
            "level": "info" if result.get("applied") else "warning",
            "check": check,
            "target": target,
            "message": message,
        }

    def _fix_artist_layout(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist_name = str(details.get("artist") or "").strip()
        if not artist_name:
            return None

        artist = get_library_artist(artist_name)
        if not artist:
            return {
                "action": "fix_artist_layout",
                "target": artist_name,
                "applied": False,
                "fs_write": True,
                "details": {"reason": "artist_not_found"},
                "message": f"Could not resolve artist record for {artist_name}",
            }

        preview = preview_fix_artist(self.library_path, artist, {
            "library_path": str(self.library_path),
            "audio_extensions": sorted(self.extensions),
        })
        if str(preview.get("status") or "") != "needs_fix":
            return {
                "action": "fix_artist_layout",
                "target": artist_name,
                "applied": False,
                "fs_write": True,
                "details": {
                    "status": preview.get("status"),
                    "target_artist_dir": preview.get("target_artist_dir"),
                    "candidate_dirs": list(preview.get("candidate_dirs") or []),
                    "reason": preview.get("message"),
                },
                "message": str(preview.get("message") or f"No artist layout fix needed for {artist_name}"),
            }

        if dry_run:
            return {
                "action": "fix_artist_layout",
                "target": artist_name,
                "applied": False,
                "fs_write": True,
                "details": {
                    "target_artist_dir": preview.get("target_artist_dir"),
                    "candidate_dirs": list(preview.get("candidate_dirs") or []),
                    "album_moves": list(preview.get("album_moves") or []),
                    "artist_files": list(preview.get("artist_files") or []),
                    "folder_name_mismatch": bool(preview.get("folder_name_mismatch")),
                    "skipped_existing": int(preview.get("skipped_existing") or 0),
                    "skipped_foreign": int(preview.get("skipped_foreign") or 0),
                    "preview_errors": list(preview.get("preview_errors") or []),
                },
                "message": str(preview.get("message") or f"Would fix artist layout for {artist_name}"),
            }

        if task_id is None:
            raise RuntimeError("fix_artist_layout requires a task_id when applying changes")

        result = _fix_artist(self.library_path, artist, task_id, {
            "library_path": str(self.library_path),
            "audio_extensions": sorted(self.extensions),
        })
        status = str(result.get("status") or "")
        applied = status == "fixed"
        details_payload = {
            "status": status,
            "artist_entity_uid": result.get("artist_entity_uid"),
            "candidate_dirs": list(result.get("candidate_dirs") or []),
            "albums_fixed": int(result.get("albums_fixed") or 0),
            "albums_skipped": int(result.get("albums_skipped") or 0),
            "albums_failed": int(result.get("albums_failed") or 0),
            "album_files_moved": int(result.get("album_files_moved") or 0),
            "artist_files_moved": int(result.get("artist_files_moved") or 0),
            "dirs_cleaned": int(result.get("dirs_cleaned") or 0),
            "synced_tracks": int(result.get("synced_tracks") or 0),
        }
        if not applied:
            details_payload["reason"] = result.get("reason") or result.get("message")

        message = (
            f"Fixed artist layout for {artist_name}: "
            f"{details_payload['albums_fixed']} albums, "
            f"{details_payload['album_files_moved']} files moved"
            if applied
            else str(result.get("reason") or result.get("message") or f"Skipped artist layout fix for {artist_name}")
        )
        return {
            "action": "fix_artist_layout",
            "target": artist_name,
            "applied": applied,
            "fs_write": True,
            "details": details_payload,
            "message": message,
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
            result["message"] = f"Synced artist photo flag for {artist_name}"

        return result

    def _fix_duplicate_albums(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        from crate.duplicate_album import apply_duplicate_resolution, classify_duplicate_album

        details = issue.get("details", {})
        artist = details.get("artist", "")
        album_name = details.get("album", "")
        paths = [Path(path) for path in details.get("paths", []) if path]
        if len(paths) < 2:
            return {
                "action": "fix_duplicate_albums",
                "target": f"{artist}/{album_name}",
                "details": {"reason": "Not enough duplicate paths to classify"},
                "applied": False,
                "fs_write": False,
                "message": f"Skipped duplicate album {artist}/{album_name}: not enough paths to classify",
            }

        artist_dir = self.library_path / artist
        loose_candidates = [path for path in paths if path.parent == artist_dir]
        if not loose_candidates:
            return {
                "action": "fix_duplicate_albums",
                "target": f"{artist}/{album_name}",
                "details": {"reason": "No loose duplicate folder at artist root"},
                "applied": False,
                "fs_write": False,
                "message": f"Skipped duplicate album {artist}/{album_name}: no loose duplicate folder at artist root",
            }

        loose_dir = sorted(loose_candidates, key=lambda path: len(path.parts))[0]
        verdict = classify_duplicate_album(loose_dir, self.library_path)
        action_result = apply_duplicate_resolution(verdict, dry_run=dry_run)
        result = {
            "action": action_result.get("action", "fix_duplicate_albums"),
            "target": f"{artist}/{album_name}",
            "details": {
                "loose_dir": action_result.get("loose"),
                "canonical_dir": action_result.get("canonical"),
                "reason": action_result.get("reason"),
                "moved": action_result.get("moved", []),
                "loose_tracks": action_result.get("loose_tracks"),
                "canonical_tracks": action_result.get("canonical_tracks"),
                "common_tracks": action_result.get("common_tracks"),
            },
            "applied": action_result.get("applied", False),
            "fs_write": action_result.get("fs_write", False),
        }

        if dry_run:
            result["message"] = (
                f"Would {result['action'].replace('_', ' ')} for duplicate album {artist}/{album_name}"
            )
            return result

        if not result["applied"]:
            result["message"] = (
                f"Skipped duplicate album {artist}/{album_name}: {result['details'].get('reason') or 'manual review needed'}"
            )
            return result

        if verdict.action == "delete_loose":
            delete_album(str(loose_dir))
            log_audit(
                "delete_duplicate_album_folder",
                "album",
                f"{artist}/{album_name}",
                details=result["details"],
                task_id=task_id,
            )
        elif verdict.action == "merge_into_canonical" and verdict.canonical_dir is not None:
            merge_album_folder(str(loose_dir), str(verdict.canonical_dir), album_name)
            log_audit(
                "merge_duplicate_album_folder",
                "album",
                f"{artist}/{album_name}",
                details=result["details"],
                task_id=task_id,
            )

        result["details"]["enrich_artist"] = artist
        result["message"] = f"Applied {verdict.action.replace('_', ' ')} for duplicate album {artist}/{album_name}"
        return result

    @staticmethod
    def _duplicate_track_tag_identity(track: dict) -> tuple[str, str, str, str]:
        path = Path(str(track.get("path") or ""))
        tags = read_tags(path) if path.is_file() else {}
        return (
            str(tags.get("artist") or "").strip().casefold(),
            str(tags.get("album") or "").strip().casefold(),
            str(tags.get("title") or "").strip().casefold(),
            str(tags.get("tracknumber") or "").strip(),
        )

    @staticmethod
    def _duplicate_track_keep_key(track: dict) -> tuple[int, int, int, int, int, str]:
        path = Path(str(track.get("path") or ""))
        tag_artist, tag_album, tag_title, tag_tracknumber = LibraryRepair._duplicate_track_tag_identity(track)
        readable_tag_score = sum(1 for value in (tag_artist, tag_album, tag_title, tag_tracknumber) if value)
        return (
            1 if path.is_file() else 0,
            readable_tag_score,
            1 if track.get("audio_fingerprint") else 0,
            int(track.get("size") or 0),
            int(track.get("bitrate") or 0),
            str(track.get("path") or ""),
        )

    def _safe_duplicate_track_resolution(self, issue: dict) -> tuple[dict, list[dict]] | None:
        details = issue.get("details", {})
        artist = str(details.get("artist") or "").strip()
        album = str(details.get("album") or "").strip()
        title = str(details.get("title") or "").strip()
        paths = [str(path) for path in details.get("paths", []) if path]
        if len(paths) < 2:
            return None

        tracks = get_tracks_by_paths(paths)
        if len(tracks) < 2:
            return None

        album_ids = {track.get("album_id") for track in tracks if track.get("album_id") is not None}
        if len(album_ids) != 1:
            return None

        parents = {str(Path(str(track.get("path") or "")).parent) for track in tracks}
        if len(parents) != 1:
            return None

        durations = [float(track["duration"]) for track in tracks if track.get("duration") is not None]
        if durations and max(durations) - min(durations) > 1.0:
            return None

        track_numbers = {int(track["track_number"]) for track in tracks if track.get("track_number") is not None}
        if len(track_numbers) > 1:
            return None

        disc_numbers = {int(track["disc_number"]) for track in tracks if track.get("disc_number") is not None}
        if len(disc_numbers) > 1:
            return None

        fingerprints = {str(track["audio_fingerprint"]) for track in tracks if track.get("audio_fingerprint")}
        if len(fingerprints) > 1:
            return None

        expected_artist = artist.casefold()
        expected_album = album.casefold()
        expected_title = title.casefold()
        tag_identities = [self._duplicate_track_tag_identity(track) for track in tracks]
        mismatched_tags = [
            track.get("path")
            for track, (tag_artist, tag_album, tag_title, _tag_tracknumber) in zip(tracks, tag_identities, strict=False)
            if any(
                (
                    tag_artist and tag_artist != expected_artist,
                    tag_album and tag_album != expected_album,
                    tag_title and tag_title != expected_title,
                )
            )
        ]
        if mismatched_tags:
            return None

        keep = max(tracks, key=self._duplicate_track_keep_key)
        remove = [track for track in tracks if track is not keep]
        if not remove:
            return None
        return keep, remove

    def _fix_duplicate_tracks(self, issue: dict, dry_run: bool, task_id: str | None = None) -> dict | None:
        details = issue.get("details", {})
        artist = str(details.get("artist") or "").strip()
        album = str(details.get("album") or "").strip()
        title = str(details.get("title") or "").strip()

        resolution = self._safe_duplicate_track_resolution(issue)
        if resolution is None:
            return None

        keep, remove = resolution
        keep_path = str(keep.get("path") or "")
        remove_paths = [str(track.get("path") or "") for track in remove if track.get("path")]
        if not remove_paths:
            return None
        result = {
            "action": "delete_duplicate_tracks",
            "target": f"{artist}/{album}/{title}",
            "details": {
                "artist": artist,
                "album": album,
                "title": title,
                "keep_path": keep_path,
                "remove_paths": remove_paths,
                "duplicate_count": 1 + len(remove_paths),
                "reason": "same album/title/track number and matching duration",
                "enrich_artist": artist,
            },
            "applied": False,
            "fs_write": True,
        }

        if dry_run:
            result["message"] = f"Would delete {len(remove_paths)} duplicate track file(s) for {artist}/{album}/{title}"
            return result

        removed_paths: list[str] = []
        missing_paths: list[str] = []
        for track in remove:
            path_str = str(track.get("path") or "")
            if not path_str:
                continue
            path = Path(path_str)
            if path.exists():
                try:
                    path.unlink()
                    removed_paths.append(path_str)
                except OSError as exc:
                    result["details"]["error"] = f"Failed to delete {path_str}: {exc}"
                    result["message"] = f"Failed to delete duplicate track file for {artist}/{album}/{title}"
                    return result
            else:
                missing_paths.append(path_str)

            delete_track(path_str)

        result["applied"] = True
        result["details"]["removed_paths"] = removed_paths
        if missing_paths:
            result["details"]["missing_paths"] = missing_paths
        result["message"] = f"Deleted {len(remove_paths)} duplicate track file(s) for {artist}/{album}/{title}"
        log_audit(
            "delete_duplicate_tracks",
            "track",
            f"{artist}/{album}/{title}",
            details=result["details"],
            task_id=task_id,
        )
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
