"""Storage V2 migration — move library from name-based to UUID-based layout.

Migrates artist-by-artist, album-by-album using os.rename (same filesystem,
atomic and instant). Updates DB paths after each album. Fully resumable:
already-migrated artists/albums are detected and skipped.

The migration task emits progress events and can be cancelled via the
standard task cancellation mechanism.
"""

import logging
import os
import shutil
from pathlib import Path

from crate.db.cache_store import delete_cache, set_cache
from crate.db.events import emit_task_event
from crate.task_progress import TaskProgress, emit_item_event, emit_progress, entity_label
from crate.db.jobs.migration import (
    get_album_tracks,
    get_all_artists_for_migration,
    get_all_tracks_for_verification,
    get_artist_album_paths,
    get_artist_albums_ordered,
    update_album_path,
    update_artist_folder_name,
    update_track_path,
)
from crate.db.repositories.library import get_library_album, get_library_artist
from crate.entity_ids import album_entity_uid
from crate.library_sync import LibrarySync
from crate.storage_import import infer_album_identity, move_album_tree
from crate.storage_layout import album_dir as managed_album_dir
from crate.storage_layout import entity_uid_for, looks_like_entity_uid
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _uid(record: dict | None) -> str:
    return str(entity_uid_for(record, "entity_uid") or "")


def _is_already_migrated_artist(artist: dict) -> bool:
    """Check if an artist is fully migrated: folder_name is UUID AND all albums are in V2 paths."""
    folder = artist.get("folder_name") or ""
    if not looks_like_entity_uid(folder):
        return False
    # Verify albums are actually at V2 paths
    albums = get_artist_album_paths(artist["name"], limit=5)
    if not albums:
        return True
    # If any album path doesn't contain the artist entity UID, not fully migrated
    artist_uid = _uid(artist)
    return all(artist_uid in (a.get("path") or "") for a in albums)


def _is_already_migrated_album(album: dict) -> bool:
    """Check if an album path already uses V2 layout (UUID-based segments)."""
    path = album.get("path") or ""
    parts = Path(path).parts
    # V2 layout: /music/<artist_uuid>/<album_uuid>/...
    # Check if the last two directory segments are UUIDs
    if len(parts) >= 2:
        return looks_like_entity_uid(parts[-1]) and looks_like_entity_uid(parts[-2])
    if len(parts) >= 1:
        return looks_like_entity_uid(parts[-1])
    return False


def _migrate_album(
    lib: Path,
    artist: dict,
    album: dict,
    target_artist_dir: Path,
) -> dict:
    """Migrate a single album to V2 layout.

    Returns {"status": "migrated"|"skipped"|"error", ...}
    """
    album_id = album["id"]
    album_entity_uid = _uid(album)
    old_album_path = Path(album["path"])

    if not old_album_path.is_dir():
        return {"status": "skipped", "reason": "source_missing", "album_id": album_id}

    target_album_dir = target_artist_dir / album_entity_uid

    if target_album_dir.exists() and old_album_path.resolve() == target_album_dir.resolve():
        return {"status": "skipped", "reason": "already_at_target", "album_id": album_id}

    # Move all tracks to V2 filenames
    target_album_dir.mkdir(parents=True, exist_ok=True)

    tracks_moved = 0
    tracks_failed = 0

    tracks = get_album_tracks(album_id)

    for track in tracks:
        track_id = track["id"]
        track_entity_uid = _uid(track)
        old_track_path = Path(track["path"])

        if not old_track_path.is_file():
            # Track file might already have been moved or doesn't exist
            new_candidate = target_album_dir / f"{track_entity_uid}{old_track_path.suffix.lower()}"
            if new_candidate.is_file():
                # Already moved — just update DB
                update_track_path(track_id, str(new_candidate), new_candidate.name)
                tracks_moved += 1
                continue
            tracks_failed += 1
            log.warning("Track file missing during migration: %s (id=%d)", old_track_path, track_id)
            continue

        new_filename = f"{track_entity_uid}{old_track_path.suffix.lower()}"
        new_track_path = target_album_dir / new_filename

        try:
            os.rename(str(old_track_path), str(new_track_path))
        except OSError:
            # Cross-device fallback (shouldn't happen on same mount)
            try:
                shutil.move(str(old_track_path), str(new_track_path))
            except Exception:
                tracks_failed += 1
                log.warning("Failed to move track %s -> %s", old_track_path, new_track_path, exc_info=True)
                continue

        # Update DB path for this track
        update_track_path(track_id, str(new_track_path), new_filename)
        tracks_moved += 1

    # Move non-audio files (cover.jpg, artwork, etc.) preserving names
    if old_album_path.is_dir():
        for item in old_album_path.iterdir():
            if item.is_file():
                dest = target_album_dir / item.name
                if not dest.exists():
                    try:
                        os.rename(str(item), str(dest))
                    except OSError:
                        try:
                            shutil.move(str(item), str(dest))
                        except Exception:
                            log.debug("Failed to move non-audio file %s", item)

    # Update album path in DB
    update_album_path(album_id, str(target_album_dir))

    # Clean up empty source directory (only if different from target)
    if old_album_path.resolve() != target_album_dir.resolve():
        try:
            _rmdir_if_empty(old_album_path)
        except Exception:
            pass

    return {
        "status": "migrated",
        "album_id": album_id,
        "tracks_moved": tracks_moved,
        "tracks_failed": tracks_failed,
    }


def _rmdir_if_empty(path: Path):
    """Remove directory and empty parents up to 2 levels."""
    for _ in range(3):
        if not path.is_dir():
            break
        if any(path.iterdir()):
            break
        path.rmdir()
        path = path.parent


AUDIO_EXTS = {".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac"}


def _rmtree_if_no_audio(path: Path):
    """Remove directory tree if it contains no audio files."""
    if not path.is_dir():
        return
    has_audio = any(
        f.suffix.lower() in AUDIO_EXTS
        for f in path.rglob("*") if f.is_file()
    )
    if not has_audio:
        shutil.rmtree(str(path), ignore_errors=True)
        log.info("Removed empty legacy dir tree: %s", path.name)


def _same_artist_name(left: str, right: str) -> bool:
    return left.strip().casefold() == right.strip().casefold()


def _iter_album_candidate_dirs(artist_dir: Path) -> list[Path]:
    album_dirs: list[Path] = []
    if not artist_dir.is_dir():
        return album_dirs

    for child in sorted(artist_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        if child.name.isdigit() and len(child.name) == 4:
            album_dirs.extend(
                nested
                for nested in sorted(child.iterdir())
                if nested.is_dir() and not nested.name.startswith(".")
            )
            continue
        album_dirs.append(child)
    return album_dirs


def _move_artist_level_files(source_dir: Path, target_artist_dir: Path) -> int:
    if not source_dir.is_dir():
        return 0

    moved = 0
    target_artist_dir.mkdir(parents=True, exist_ok=True)
    for item in sorted(source_dir.iterdir()):
        if not item.is_file():
            continue
        dest = target_artist_dir / item.name
        if dest.exists():
            continue
        try:
            os.rename(str(item), str(dest))
        except OSError:
            try:
                shutil.move(str(item), str(dest))
            except Exception:
                log.debug("Failed to move artist-level file %s", item, exc_info=True)
                continue
        moved += 1
    return moved


def _artist_level_files(source_dir: Path) -> list[Path]:
    if not source_dir.is_dir():
        return []
    return [item for item in sorted(source_dir.iterdir()) if item.is_file()]


def _album_root_for_path(album_path: Path) -> Path:
    parent = album_path.parent
    if parent.name.isdigit() and len(parent.name) == 4 and parent.parent.exists():
        return parent.parent
    return parent


def _album_dir_has_audio(album_dir: Path) -> bool:
    try:
        return any(p.is_file() and p.suffix.lower() in {".flac", ".mp3", ".m4a", ".ogg", ".opus"} for p in album_dir.rglob("*"))
    except OSError:
        return False


def _artist_dir_has_album_audio(artist_dir: Path) -> bool:
    return any(_album_dir_has_audio(album_dir) for album_dir in _iter_album_candidate_dirs(artist_dir))


def _discover_artist_candidate_dirs(lib: Path, artist: dict, artist_name: str, target_artist_dir: Path) -> list[Path]:
    raw_candidates = [
        target_artist_dir,
        lib / str(artist.get("folder_name") or artist_name),
        lib / artist_name,
    ]
    for row in get_artist_album_paths(artist_name, limit=5000):
        album_path = Path(str(row.get("path") or ""))
        if album_path.is_dir():
            raw_candidates.append(_album_root_for_path(album_path))

    candidate_dirs: list[Path] = []
    for candidate in raw_candidates:
        if candidate not in candidate_dirs and candidate.is_dir():
            candidate_dirs.append(candidate)

    if any(candidate != target_artist_dir and _artist_dir_has_album_audio(candidate) for candidate in candidate_dirs):
        return candidate_dirs

    for top_level_dir in sorted(lib.iterdir()):
        if not top_level_dir.is_dir() or top_level_dir.name.startswith(".") or top_level_dir in candidate_dirs:
            continue
        for album_dir in _iter_album_candidate_dirs(top_level_dir):
            if not _album_dir_has_audio(album_dir):
                continue
            try:
                inferred_artist, _ = infer_album_identity(album_dir, fallback_artist=artist_name)
            except Exception:
                continue
            if inferred_artist and _same_artist_name(inferred_artist, artist_name):
                candidate_dirs.append(top_level_dir)
                break

    return candidate_dirs


def _resolve_fix_album_target(lib: Path, artist: dict, artist_name: str, album_name: str) -> Path:
    artist_entity_uid = _uid(artist)
    if not artist_entity_uid:
        raise RuntimeError(f"Artist {artist_name} has no entity_uid")

    existing_album = get_library_album(artist_name, album_name)
    existing_album_uid = _uid(existing_album) if existing_album else None
    album_uid = str(
        existing_album_uid
        if existing_album_uid
        else album_entity_uid(
            artist_name=artist_name,
            artist_uid=artist_entity_uid,
            album_name=album_name,
        )
    )
    return managed_album_dir(lib, artist_entity_uid, album_uid)


def build_artist_layout_fix_issue(preview: dict, *, issue_id: int | None = None) -> dict | None:
    if str(preview.get("status") or "") != "needs_fix":
        return None

    artist_name = str(preview.get("artist") or "").strip()
    album_moves = preview.get("album_moves") or []
    artist_files = preview.get("artist_files") or []
    severity = "high" if album_moves else "medium"

    issue = {
        "check": "artist_layout_fix",
        "severity": severity,
        "description": f"Artist layout fix needed for {artist_name}",
        "auto_fixable": True,
        "details": {
            "artist": artist_name,
            "target_artist_dir": preview.get("target_artist_dir"),
            "candidate_dirs": list(preview.get("candidate_dirs") or []),
            "album_move_count": len(album_moves),
            "artist_file_count": len(artist_files),
            "folder_name_mismatch": bool(preview.get("folder_name_mismatch")),
            "skipped_existing": int(preview.get("skipped_existing") or 0),
            "skipped_foreign": int(preview.get("skipped_foreign") or 0),
            "preview_errors": list(preview.get("preview_errors") or []),
        },
    }
    if issue_id is not None:
        issue["id"] = issue_id
    return issue


def preview_fix_artist(lib: Path, artist: dict, config: dict | None = None) -> dict:
    artist_name = artist["name"]
    artist_entity_uid = _uid(artist)
    if not artist_entity_uid:
        return {
            "status": "unavailable",
            "applicable": False,
            "artist": artist_name,
            "message": f"{artist_name} has no entity_uid, so canonical fix is unavailable",
            "candidate_dirs": [],
            "target_artist_dir": None,
            "album_moves": [],
            "artist_files": [],
            "folder_name_mismatch": False,
        }

    target_artist_dir = lib / artist_entity_uid
    candidate_dirs = _discover_artist_candidate_dirs(lib, artist, artist_name, target_artist_dir)
    if not candidate_dirs:
        return {
            "status": "unavailable",
            "applicable": False,
            "artist": artist_name,
            "message": f"No artist directories found for {artist_name}",
            "candidate_dirs": [],
            "target_artist_dir": str(target_artist_dir),
            "album_moves": [],
            "artist_files": [],
            "folder_name_mismatch": bool((artist.get("folder_name") or "") != artist_entity_uid),
        }

    album_moves: list[dict[str, str]] = []
    artist_files: list[str] = []
    preview_errors: list[dict[str, str]] = []
    skipped_foreign = 0
    skipped_existing = 0

    for candidate_dir in candidate_dirs:
        if candidate_dir != target_artist_dir:
            for item in _artist_level_files(candidate_dir):
                if not (target_artist_dir / item.name).exists():
                    artist_files.append(str(item))

        if candidate_dir == target_artist_dir:
            continue

        for album_dir in _iter_album_candidate_dirs(candidate_dir):
            try:
                inferred_artist, inferred_album = infer_album_identity(album_dir, fallback_artist=artist_name)
                if inferred_artist and not _same_artist_name(inferred_artist, artist_name):
                    skipped_foreign += 1
                    continue

                target_album_dir = _resolve_fix_album_target(lib, artist, artist_name, inferred_album)
                if album_dir.resolve() == target_album_dir.resolve():
                    skipped_existing += 1
                    continue

                album_moves.append({
                    "album": inferred_album,
                    "source": str(album_dir),
                    "target": str(target_album_dir),
                })
            except Exception as exc:
                preview_errors.append({"album_dir": str(album_dir), "error": str(exc)})

    folder_name_mismatch = bool((artist.get("folder_name") or "") != artist_entity_uid)
    applicable = bool(album_moves or artist_files or folder_name_mismatch)
    target_has_audio = _artist_dir_has_album_audio(target_artist_dir)

    if applicable:
        message = (
            f"Would consolidate {len(album_moves)} album director"
            f"{'' if len(album_moves) == 1 else 'ies'}"
        )
        if artist_files:
            message += f" and move {len(artist_files)} artist file{'' if len(artist_files) == 1 else 's'}"
        message += " into canonical entity_uid layout"
        status = "needs_fix"
    elif target_has_audio:
        message = f"{artist_name} already uses canonical entity_uid layout"
        status = "already_canonical"
    else:
        message = f"No canonical fix actions available for {artist_name}"
        status = "unavailable"

    return {
        "status": status,
        "applicable": applicable,
        "artist": artist_name,
        "message": message,
        "candidate_dirs": [str(path) for path in candidate_dirs],
        "target_artist_dir": str(target_artist_dir),
        "album_moves": album_moves,
        "artist_files": artist_files,
        "folder_name_mismatch": folder_name_mismatch,
        "skipped_existing": skipped_existing,
        "skipped_foreign": skipped_foreign,
        "preview_errors": preview_errors,
    }


def _fix_artist(
    lib: Path,
    artist: dict,
    task_id: str,
    config: dict,
) -> dict:
    artist_name = artist["name"]
    artist_entity_uid = _uid(artist)
    if not artist_entity_uid:
        raise RuntimeError(f"Artist {artist_name} has no entity_uid")

    preview = preview_fix_artist(lib, artist, config)
    if preview.get("status") == "already_canonical":
        return {
            "status": "skipped",
            "artist": artist_name,
            "artist_entity_uid": artist_entity_uid,
            "reason": preview.get("message"),
            "candidate_dirs": preview.get("candidate_dirs", []),
        }
    if preview.get("status") != "needs_fix":
        raise RuntimeError(str(preview.get("message") or f"Unable to fix {artist_name}"))

    target_artist_dir = Path(str(preview.get("target_artist_dir")))
    candidate_dirs = [Path(path) for path in preview.get("candidate_dirs", [])]

    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)

    moved_artist_files = 0
    moved_album_files = 0
    fixed_albums = 0
    skipped_albums = 0
    failed_albums = 0
    cleaned_dirs = 0

    try:
        update_artist_folder_name(artist_name, artist_entity_uid)
        target_artist_dir.mkdir(parents=True, exist_ok=True)
        emit_task_event(task_id, "info", {
            "message": f"Fixing {artist_name} from {len(candidate_dirs)} candidate director{'' if len(candidate_dirs) == 1 else 'ies'}",
            "candidate_dirs": [str(path) for path in candidate_dirs],
        })

        for candidate_dir in candidate_dirs:
            if is_cancelled(task_id):
                break

            if candidate_dir != target_artist_dir:
                moved_artist_files += _move_artist_level_files(candidate_dir, target_artist_dir)

            if candidate_dir == target_artist_dir:
                continue

            for album_dir in _iter_album_candidate_dirs(candidate_dir):
                if is_cancelled(task_id):
                    break

                try:
                    inferred_artist, inferred_album = infer_album_identity(album_dir, fallback_artist=artist_name)
                    if inferred_artist and not _same_artist_name(inferred_artist, artist_name):
                        skipped_albums += 1
                        emit_task_event(task_id, "info", {
                            "message": f"Skipped foreign album dir {album_dir.name} while fixing {artist_name}",
                            "album_dir": str(album_dir),
                        })
                        continue

                    target_album_dir = _resolve_fix_album_target(lib, artist, artist_name, inferred_album)
                    if album_dir.resolve() == target_album_dir.resolve():
                        skipped_albums += 1
                        continue

                    moved_album_files += move_album_tree(
                        album_dir,
                        target_album_dir,
                        managed_track_names=True,
                        artist_name=artist_name,
                        album_name=inferred_album,
                    )
                    fixed_albums += 1
                except Exception:
                    failed_albums += 1
                    log.warning("Failed to consolidate album dir %s for %s", album_dir, artist_name, exc_info=True)

            before_cleanup = candidate_dir.exists()
            _rmtree_if_no_audio(candidate_dir)
            if candidate_dir.exists():
                try:
                    _rmdir_if_empty(candidate_dir)
                except Exception:
                    pass
            if before_cleanup and not candidate_dir.exists():
                cleaned_dirs += 1

        if not _artist_dir_has_album_audio(target_artist_dir):
            raise RuntimeError(f"No album audio directories found for {artist_name} after consolidation")

        sync = LibrarySync(config)
        synced_tracks = sync.sync_artist_dirs(artist_name, [target_artist_dir])
        update_artist_folder_name(artist_name, artist_entity_uid)

        refreshed = get_library_artist(artist_name) or artist
        return {
            "status": "fixed",
            "artist": artist_name,
            "artist_entity_uid": artist_entity_uid,
            "folder_name": refreshed.get("folder_name"),
            "albums_fixed": fixed_albums,
            "albums_skipped": skipped_albums,
            "albums_failed": failed_albums,
            "artist_files_moved": moved_artist_files,
            "album_files_moved": moved_album_files,
            "cleaned_dirs": cleaned_dirs,
            "synced_tracks": synced_tracks,
        }
    finally:
        delete_cache(f"processing:{artist_name.lower()}")


def _migrate_artist(
    lib: Path,
    artist: dict,
    task_id: str,
) -> dict:
    """Migrate all albums for a single artist to V2 layout."""
    artist_name = artist["name"]
    artist_entity_uid = _uid(artist)
    target_artist_dir = lib / artist_entity_uid

    # Suppress the library watcher for this artist during migration
    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)

    # Fetch all albums for this artist
    albums = get_artist_albums_ordered(artist_name)

    if not albums:
        return {"status": "skipped", "reason": "no_albums", "artist": artist_name}

    albums_migrated = 0
    albums_skipped = 0
    albums_failed = 0
    total_tracks_moved = 0

    for album in albums:
        if is_cancelled(task_id):
            break

        if _is_already_migrated_album(album):
            albums_skipped += 1
            continue

        result = _migrate_album(lib, artist, album, target_artist_dir)

        if result["status"] == "migrated":
            albums_migrated += 1
            total_tracks_moved += result.get("tracks_moved", 0)
        elif result["status"] == "skipped":
            albums_skipped += 1
        else:
            albums_failed += 1

    # Update artist folder_name to entity UID
    update_artist_folder_name(artist_name, artist_entity_uid)

    # Move artist-level files (artist.jpg, background.jpg) to new dir
    old_folder = artist.get("folder_name") or artist_name
    old_artist_dir = lib / old_folder
    if old_artist_dir.is_dir() and old_artist_dir.resolve() != target_artist_dir.resolve():
        target_artist_dir.mkdir(parents=True, exist_ok=True)
        for item in old_artist_dir.iterdir():
            if item.is_file():
                dest = target_artist_dir / item.name
                if not dest.exists():
                    try:
                        os.rename(str(item), str(dest))
                    except OSError:
                        try:
                            shutil.move(str(item), str(dest))
                        except Exception:
                            log.debug("Failed to move artist file %s", item)
        # Clean up legacy artist dir if no audio remains
        _rmtree_if_no_audio(old_artist_dir)

    if old_folder != artist_name:
        name_dir = lib / artist_name
        if name_dir.is_dir() and name_dir.resolve() != target_artist_dir.resolve():
            for item in name_dir.iterdir():
                if item.is_file():
                    dest = target_artist_dir / item.name
                    if not dest.exists():
                        try:
                            os.rename(str(item), str(dest))
                        except OSError:
                            pass
            _rmtree_if_no_audio(name_dir)

    # Release watcher suppression
    delete_cache(f"processing:{artist_name.lower()}")

    return {
        "status": "migrated",
        "artist": artist_name,
        "albums_migrated": albums_migrated,
        "albums_skipped": albums_skipped,
        "albums_failed": albums_failed,
        "tracks_moved": total_tracks_moved,
    }


def _handle_migrate_storage_v2(task_id: str, params: dict, config: dict) -> dict:
    """Migrate library from name-based to UUID-based storage layout.

    Processes all artists, or a specific artist if params["artist"] is set.
    Fully resumable — already-migrated content is skipped.
    """
    lib = Path(config["library_path"])

    # Optional: migrate a single artist
    single_artist = params.get("artist")

    artists = get_all_artists_for_migration(single_artist)

    total = len(artists)
    migrated = 0
    skipped = 0
    failed = 0
    total_tracks = 0

    p = TaskProgress(phase="migrating", phase_count=2, total=total)

    emit_task_event(task_id, "info", {"message": f"Starting V2 storage migration for {total} artists"})

    for i, artist in enumerate(artists):
        if is_cancelled(task_id):
            emit_task_event(task_id, "info", {"message": "Migration cancelled by user"})
            break

        artist_name = artist["name"]

        if _is_already_migrated_artist(artist):
            skipped += 1
            continue

        p.done = i
        p.item = entity_label(artist=artist_name)
        p.errors = failed
        emit_progress(task_id, p)

        try:
            result = _migrate_artist(lib, artist, task_id)
            if result["status"] == "migrated":
                migrated += 1
                total_tracks += result.get("tracks_moved", 0)
                emit_task_event(task_id, "info", {
                    "message": f"Migrated {artist_name}: {result.get('albums_migrated', 0)} albums, {result.get('tracks_moved', 0)} tracks",
                })
            else:
                skipped += 1
        except Exception:
            failed += 1
            log.warning("Migration failed for artist %s", artist_name, exc_info=True)
            emit_task_event(task_id, "info", {
                "message": f"Failed to migrate {artist_name}",
                "error": True,
            })

    # Verification pass
    emit_task_event(task_id, "info", {"message": "Running verification..."})
    p.phase = "verifying"
    p.phase_index = 1
    p.done = 0
    p.total = 0
    emit_progress(task_id, p, force=True)

    orphaned_dirs = []
    if not single_artist:
        try:
            for item in lib.iterdir():
                if not item.is_dir():
                    continue
                if looks_like_entity_uid(item.name):
                    continue
                # This is a legacy name-based directory
                has_audio = any(
                    f.suffix.lower() in {".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav"}
                    for f in item.rglob("*") if f.is_file()
                )
                if has_audio:
                    orphaned_dirs.append(item.name)
                else:
                    # Empty legacy dir, safe to clean
                    try:
                        shutil.rmtree(str(item))
                        log.info("Removed empty legacy dir: %s", item.name)
                    except Exception:
                        orphaned_dirs.append(item.name)
        except Exception:
            log.debug("Verification scan failed", exc_info=True)

    summary = {
        "total_artists": total,
        "migrated": migrated,
        "skipped": skipped,
        "failed": failed,
        "total_tracks_moved": total_tracks,
        "orphaned_legacy_dirs": orphaned_dirs,
    }

    if orphaned_dirs:
        emit_task_event(task_id, "info", {
            "message": f"Migration complete with {len(orphaned_dirs)} orphaned legacy directories",
            "orphaned": orphaned_dirs[:20],
        })
    else:
        emit_task_event(task_id, "info", {
            "message": f"Migration complete: {migrated} artists, {total_tracks} tracks moved",
        })

    return summary


def _handle_fix_artist(task_id: str, params: dict, config: dict) -> dict:
    lib = Path(config["library_path"])
    artist_name = (params.get("artist") or "").strip()
    if not artist_name:
        raise RuntimeError("fix_artist requires params.artist")

    artist = get_library_artist(artist_name)
    if not artist:
        raise RuntimeError(f"Artist not found: {artist_name}")

    emit_task_event(task_id, "info", {
        "message": f"Fixing artist {artist_name}",
        "artist": artist_name,
        "artist_entity_uid": _uid(artist),
    })

    result = _fix_artist(lib, artist, task_id, config)
    emit_task_event(task_id, "info", {
        "message": (
            f"Fixed {artist_name}: {result.get('albums_fixed', 0)} albums consolidated, "
            f"{result.get('synced_tracks', 0)} tracks synced"
        ),
        **result,
    })
    return result


def _handle_verify_storage_v2(task_id: str, params: dict, config: dict) -> dict:
    """Verify library storage integrity after V2 migration.

    Checks that all DB paths point to existing files and that
    all files on disk are accounted for in the DB.
    """
    lib = Path(config["library_path"])

    missing_files = []
    orphaned_files = []
    ok_tracks = 0

    # Check all tracks in DB have existing files
    tracks = get_all_tracks_for_verification()

    total = len(tracks)
    p_v = TaskProgress(phase="checking_db", phase_count=2, total=total)
    for i, track in enumerate(tracks):
        if is_cancelled(task_id):
            break
        if i % 500 == 0:
            p_v.done = i
            emit_progress(task_id, p_v)

        track_path = Path(track["path"])
        if track_path.is_file():
            ok_tracks += 1
        else:
                missing_files.append({
                    "track_id": track["id"],
                    "entity_uid": str(track.get("entity_uid") or ""),
                    "path": track["path"],
                    "artist": track["artist"],
                "title": track["title"],
            })

    # Check for files on disk not in DB
    p_v.phase = "checking_filesystem"
    p_v.phase_index = 1
    p_v.done = 0
    p_v.total = 0
    emit_progress(task_id, p_v, force=True)
    audio_exts = {".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac"}
    known_paths = {t["path"] for t in tracks}

    try:
        for f in lib.rglob("*"):
            if f.is_file() and f.suffix.lower() in audio_exts:
                if str(f) not in known_paths:
                    orphaned_files.append(str(f))
                    if len(orphaned_files) >= 200:
                        break
    except Exception:
        log.debug("Filesystem scan for orphans failed", exc_info=True)

    emit_task_event(task_id, "info", {
        "message": f"Verification complete: {ok_tracks}/{total} tracks OK, {len(missing_files)} missing, {len(orphaned_files)} orphaned",
    })
    return {
        "total_tracks": total,
        "ok": ok_tracks,
        "missing_files": len(missing_files),
        "missing_details": missing_files[:50],
        "orphaned_files": len(orphaned_files),
        "orphaned_details": orphaned_files[:50],
    }


MIGRATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "migrate_storage_v2": _handle_migrate_storage_v2,
    "fix_artist": _handle_fix_artist,
    "verify_storage_v2": _handle_verify_storage_v2,
}
