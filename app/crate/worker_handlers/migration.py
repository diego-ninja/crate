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

from crate.db import emit_task_event, set_cache, delete_cache, update_task
from crate.task_progress import TaskProgress, emit_progress, emit_item_event, entity_label
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
from crate.storage_layout import looks_like_storage_id
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _is_already_migrated_artist(artist: dict) -> bool:
    """Check if an artist is fully migrated: folder_name is UUID AND all albums are in V2 paths."""
    folder = artist.get("folder_name") or ""
    if not looks_like_storage_id(folder):
        return False
    # Verify albums are actually at V2 paths
    albums = get_artist_album_paths(artist["name"], limit=5)
    if not albums:
        return True
    # If any album path doesn't contain the artist's storage_id, not fully migrated
    artist_sid = str(artist.get("storage_id") or "")
    return all(artist_sid in (a.get("path") or "") for a in albums)


def _is_already_migrated_album(album: dict) -> bool:
    """Check if an album path already uses V2 layout (UUID-based segments)."""
    path = album.get("path") or ""
    parts = Path(path).parts
    # V2 layout: /music/<artist_uuid>/<album_uuid>/...
    # Check if the last two directory segments are UUIDs
    if len(parts) >= 2:
        return looks_like_storage_id(parts[-1]) and looks_like_storage_id(parts[-2])
    if len(parts) >= 1:
        return looks_like_storage_id(parts[-1])
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
    album_storage_id = str(album["storage_id"])
    old_album_path = Path(album["path"])

    if not old_album_path.is_dir():
        return {"status": "skipped", "reason": "source_missing", "album_id": album_id}

    target_album_dir = target_artist_dir / album_storage_id

    if target_album_dir.exists() and old_album_path.resolve() == target_album_dir.resolve():
        return {"status": "skipped", "reason": "already_at_target", "album_id": album_id}

    # Move all tracks to V2 filenames
    target_album_dir.mkdir(parents=True, exist_ok=True)

    tracks_moved = 0
    tracks_failed = 0

    tracks = get_album_tracks(album_id)

    for track in tracks:
        track_id = track["id"]
        track_storage_id = str(track["storage_id"])
        old_track_path = Path(track["path"])

        if not old_track_path.is_file():
            # Track file might already have been moved or doesn't exist
            new_candidate = target_album_dir / f"{track_storage_id}{old_track_path.suffix.lower()}"
            if new_candidate.is_file():
                # Already moved — just update DB
                update_track_path(track_id, str(new_candidate), new_candidate.name)
                tracks_moved += 1
                continue
            tracks_failed += 1
            log.warning("Track file missing during migration: %s (id=%d)", old_track_path, track_id)
            continue

        new_filename = f"{track_storage_id}{old_track_path.suffix.lower()}"
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


def _migrate_artist(
    lib: Path,
    artist: dict,
    task_id: str,
) -> dict:
    """Migrate all albums for a single artist to V2 layout."""
    artist_id = artist["id"]
    artist_name = artist["name"]
    artist_storage_id = str(artist["storage_id"])
    target_artist_dir = lib / artist_storage_id

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

    # Update artist folder_name to storage_id
    update_artist_folder_name(artist_name, artist_storage_id)

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
                if looks_like_storage_id(item.name):
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
                "storage_id": str(track["storage_id"]),
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
    "verify_storage_v2": _handle_verify_storage_v2,
}
