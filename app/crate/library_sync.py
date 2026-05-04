import json
import logging
import subprocess
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import mutagen

from crate.audio import read_tags
from crate.db.engine import get_engine
from crate.db.repositories.library import (
    delete_album,
    delete_artist,
    get_library_albums,
    get_library_artist,
    get_library_artists,
)
from crate.db.repositories.library_writes import upsert_artist
from crate.db.repositories.library_sync_writes import upsert_scanned_album
from crate.db.jobs.sync import (
    delete_track_by_path,
    get_album_id_by_path,
    get_album_track_count,
    get_all_album_paths,
    get_all_artist_names_and_counts,
    get_album_paths_for_artist,
    get_tracks_by_album_id,
    merge_artist_into,
)
from crate.storage_layout import canonical_entity_uid, entity_uid_for, looks_like_entity_uid
from crate.utils import COVER_NAMES, PHOTO_NAMES, normalize_key, to_datetime

log = logging.getLogger(__name__)


def _ffprobe_duration_bitrate(filepath: Path) -> tuple[float, int]:
    """Use ffprobe to read duration and bitrate from files mutagen can't parse.

    Returns (duration_seconds, bitrate_bps). Falls back to (0.0, 0) on error.
    """
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                str(filepath),
            ],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return 0.0, 0
        info = json.loads(result.stdout).get("format", {})
        duration = float(info.get("duration") or 0)
        bitrate = int(info.get("bit_rate") or 0)
        return duration, bitrate
    except Exception:
        return 0.0, 0


def _read_audio_info(filepath: Path, fmt: str, mf: mutagen.FileType | None = None) -> tuple[float, int, int, int]:
    """Read duration/bitrate/sample rate/bit depth, with ffprobe fallback for Tidal M4A."""
    if mf is None:
        try:
            mf = mutagen.File(filepath)
        except Exception:
            mf = None

    duration = mf.info.length if mf and mf.info else 0.0
    bitrate = getattr(mf.info, "bitrate", 0) if mf and mf.info else 0
    sample_rate = getattr(mf.info, "sample_rate", 0) if mf and mf.info else 0
    bit_depth = getattr(mf.info, "bits_per_sample", 0) if mf and mf.info else 0

    if duration == 0.0 and fmt == "m4a":
        duration, bitrate = _ffprobe_duration_bitrate(filepath)

    return duration, bitrate, sample_rate, bit_depth


@contextmanager
def _artist_sync_lock(artist_name: str):
    """Serialize filesystem→DB sync per canonical artist across workers.

    Tidal imports can trigger multiple ``sync_artist()`` calls for the same
    artist at once. Without a cross-process lock, overlapping scans race on
    ``existing_paths - synced_paths`` and can delete albums the other sync just
    imported. A session-level advisory lock is a good fit here: it is scoped to
    the connection lifetime and does not require us to keep a transaction open
    while reading tags or walking the filesystem.
    """
    lock_key = f"library-sync:{artist_name.strip().lower()}"
    raw = get_engine().raw_connection()
    try:
        with raw.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_lock(hashtext(%s))", (lock_key,))
        yield
    finally:
        try:
            with raw.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(hashtext(%s))", (lock_key,))
        finally:
            raw.close()


def _album_artist_root(album_dir: Path) -> Path:
    parent = album_dir.parent
    if parent.name.isdigit() and len(parent.name) == 4 and parent.parent.exists():
        return parent.parent
    return parent


class LibrarySync:
    def __init__(self, config: dict):
        self.library_path = Path(config["library_path"])
        self.extensions = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
        self.exclude_dirs = set(config.get("exclude_dirs", []))

    def full_sync(self, progress_callback=None) -> dict:
        artists_added = 0
        artists_updated = 0
        artists_removed = 0
        tracks_total = 0
        failed_artists: list[str] = []

        artist_dirs = sorted([
            d for d in self.library_path.iterdir()
            if d.is_dir() and not d.name.startswith(".") and d.name not in self.exclude_dirs
        ])

        # Group folders by canonical artist name (multiple folders may map to one artist)
        # Uses case-insensitive key to merge "At the Drive-In" / "At The Drive-In"
        canonical_map: dict[str, list[Path]] = {}  # canonical_name → [dirs]
        name_key_map: dict[str, str] = {}  # lower_key → best canonical_name
        for artist_dir in artist_dirs:
            canonical = self._canonical_artist_name(artist_dir, artist_dir.name)
            lower_key = canonical.lower()
            # Keep the first canonical name seen (from audio tags) as the authoritative one
            if lower_key not in name_key_map:
                name_key_map[lower_key] = canonical
            best_name = name_key_map[lower_key]
            canonical_map.setdefault(best_name, []).append(artist_dir)

        total_artists = len(canonical_map)

        # Pre-fetch all existing artists to avoid N+1 queries
        all_existing, _ = get_library_artists(per_page=100000)
        existing_by_name = {a["name"].lower(): a for a in all_existing}
        existing_by_folder = {(a.get("folder_name") or "").lower(): a for a in all_existing if a.get("folder_name")}

        for i, (artist_name, dirs) in enumerate(sorted(canonical_map.items())):
            try:
                primary_dir = dirs[0]
                folder_names = [d.name for d in dirs]
                existing = existing_by_name.get(artist_name.lower()) or existing_by_folder.get(dirs[0].name.lower())

                # Check if any folder has changed
                max_mtime = max(d.stat().st_mtime for d in dirs)
                if existing and existing.get("dir_mtime") and existing["dir_mtime"] >= max_mtime:
                    tracks_total += existing.get("track_count", 0)
                    if progress_callback and i % 50 == 0:
                        progress_callback({
                            "phase": "sync",
                            "artist": artist_name,
                            "artists_done": i + 1,
                            "artists_total": total_artists,
                            "tracks_total": tracks_total,
                        })
                    continue

                count = self.sync_artist_dirs(artist_name, dirs)
                tracks_total += count

                if existing:
                    artists_updated += 1
                else:
                    artists_added += 1

            except Exception:
                log.exception("Failed to sync artist %s", artist_name)
                failed_artists.append(artist_name)

            if progress_callback and i % 10 == 0:
                progress_callback({
                    "phase": "sync",
                    "artist": artist_name,
                    "artists_done": i + 1,
                    "artists_total": total_artists,
                    "tracks_total": tracks_total,
                })

        return {
            "artists_added": artists_added,
            "artists_updated": artists_updated,
            "artists_removed": 0,
            "artists_merged": 0,
            "tracks_total": tracks_total,
            "failed_artists": failed_artists,
        }

    def sync_artist(self, artist_dir: Path) -> int:
        """Sync a single artist folder (used by watcher for incremental sync)."""
        folder_name = artist_dir.name
        artist_name = self._canonical_artist_name(artist_dir, folder_name)
        return self.sync_artist_dirs(artist_name, [artist_dir])

    def _scan_album_tree(self, album_dir: Path) -> tuple[list[Path], float]:
        latest_mtime = album_dir.stat().st_mtime
        all_audio: list[Path] = []

        for path in sorted(album_dir.rglob("*")):
            if any(part.startswith(".") for part in path.relative_to(album_dir).parts):
                continue
            try:
                latest_mtime = max(latest_mtime, path.stat().st_mtime)
            except OSError:
                continue
            if path.is_file() and path.suffix.lower() in self.extensions:
                all_audio.append(path)

        # When an album directory contains both FLAC and M4A files, skip the
        # M4A.  Tidal's lossless tier delivers FLAC-in-MP4 DASH containers
        # without metadata alongside proper FLAC files.  Indexing both would
        # double the track count and pollute tags with empty values.
        has_flac = any(f.suffix.lower() == ".flac" for f in all_audio)
        if has_flac:
            all_audio = [f for f in all_audio if f.suffix.lower() != ".m4a"]
        return all_audio, latest_mtime

    def _iter_album_audio_files(self, album_dir: Path) -> list[Path]:
        all_audio, _latest_mtime = self._scan_album_tree(album_dir)
        return all_audio

    def _album_tree_mtime(self, album_dir: Path) -> float:
        _all_audio, latest_mtime = self._scan_album_tree(album_dir)
        return latest_mtime

    def sync_artist_dirs(self, artist_name: str, artist_dirs: list[Path]) -> int:
        with _artist_sync_lock(artist_name):
            return self._sync_artist_dirs_unlocked(artist_name, artist_dirs)

    def _sync_artist_dirs_unlocked(self, artist_name: str, artist_dirs: list[Path]) -> int:
        """Sync one or more folders that all belong to the same canonical artist."""
        primary_dir = artist_dirs[0]
        primary_folder = primary_dir.name

        # Ensure artist exists in DB; use exact DB name for FK consistency
        existing = get_library_artist(artist_name)
        if existing:
            artist_name = existing["name"]
        else:
            artist_name = upsert_artist({
                "name": artist_name,
                "entity_uid": canonical_entity_uid(primary_folder),
                "folder_name": primary_folder,
                "album_count": 0,
                "track_count": 0,
                "total_size": 0,
                "formats": [],
                "dir_mtime": primary_dir.stat().st_mtime,
            })

        # Collect album dirs from ALL folders for this artist
        # Supports both 2-level (Artist/Album) and 3-level (Artist/Year/Album) structures
        album_dirs = []
        for artist_dir in artist_dirs:
            for sub in sorted(artist_dir.iterdir()):
                if not sub.is_dir() or sub.name.startswith("."):
                    continue
                # Check if this is a year subdirectory (contains album dirs, not audio files)
                if sub.name.isdigit() and len(sub.name) == 4:
                    # Year directory — collect album dirs inside it
                    album_dirs.extend(sorted([
                        d for d in sub.iterdir()
                        if d.is_dir() and not d.name.startswith(".")
                    ]))
                else:
                    album_dirs.append(sub)

        # Get existing albums for this artist to detect deletions
        existing_albums = get_library_albums(artist_name)
        existing_paths = {a["path"] for a in existing_albums}

        total_tracks = 0
        synced_paths = set()
        sync_failures = 0

        for album_dir in album_dirs:
            try:
                album_path = str(album_dir)

                existing_album = next((a for a in existing_albums if a["path"] == album_path), None)
                audio_files, tree_mtime = self._scan_album_tree(album_dir)
                actual_track_count = len(audio_files)

                if (
                    existing_album
                    and existing_album.get("dir_mtime")
                    and existing_album["dir_mtime"] >= tree_mtime
                    and existing_album.get("track_count", 0) == actual_track_count
                ):
                    # Self-heal: the denormalized track_count on library_albums
                    # can drift from the actual library_tracks rows (historically
                    # caused by sync_album crashing mid-insert). If the album
                    # row claims N tracks but fewer rows exist in library_tracks,
                    # force a full sync instead of trusting the counter.
                    actual_row_count = get_album_track_count(existing_album["id"])
                    if actual_row_count == actual_track_count:
                        total_tracks += existing_album.get("track_count", 0)
                        synced_paths.add(album_path)
                        continue

                result = self._sync_album_unlocked(
                    album_dir,
                    artist_name,
                    audio_files=audio_files,
                    tree_mtime=tree_mtime,
                )
                total_tracks += result["track_count"]
                synced_paths.add(album_path)

            except Exception:
                sync_failures += 1
                log.exception("Failed to sync album %s", album_dir.name)

        # Remove deleted albums
        if sync_failures:
            log.warning(
                "Skipping deletion of existing albums for %s because %d album syncs failed",
                artist_name,
                sync_failures,
            )
        elif not album_dirs and existing_paths:
            log.warning(
                "Skipping deletion of existing albums for %s because scan found no album directories",
                artist_name,
            )
        else:
            for path in existing_paths - synced_paths:
                delete_album(path)

        # Detect artist photo (check all folders)
        has_photo = int(any(
            (d / name).exists() for d in artist_dirs for name in PHOTO_NAMES
        ))

        # Recalculate totals from ALL albums in DB
        all_albums = get_library_albums(artist_name)
        db_track_count = sum(a.get("track_count", 0) for a in all_albums)
        db_total_size = sum(a.get("total_size", 0) for a in all_albums)
        db_formats: Counter = Counter()
        for a in all_albums:
            fmt = a.get("format")
            if fmt:
                db_formats[fmt] += 1

        formats_list = sorted(db_formats.keys())
        primary_format = db_formats.most_common(1)[0][0] if db_formats else None

        upsert_artist({
            "name": artist_name,
            "entity_uid": entity_uid_for(existing, "entity_uid") if existing else canonical_entity_uid(primary_folder),
            "folder_name": primary_folder,
            "album_count": len(all_albums),
            "track_count": db_track_count,
            "total_size": db_total_size,
            "formats": formats_list,
            "primary_format": primary_format,
            "has_photo": has_photo,
            "dir_mtime": max(d.stat().st_mtime for d in artist_dirs),
        })

        return total_tracks

    def sync_album(
        self,
        album_dir: Path,
        artist_name: str,
        *,
        audio_files: list[Path] | None = None,
        tree_mtime: float | None = None,
    ) -> dict:
        with _artist_sync_lock(artist_name):
            return self._sync_album_unlocked(
                album_dir,
                artist_name,
                audio_files=audio_files,
                tree_mtime=tree_mtime,
            )

    def _sync_album_unlocked(
        self,
        album_dir: Path,
        artist_name: str,
        *,
        audio_files: list[Path] | None = None,
        tree_mtime: float | None = None,
    ) -> dict:
        artist_root = _album_artist_root(album_dir)

        if audio_files is None or tree_mtime is None:
            audio_files, scanned_mtime = self._scan_album_tree(album_dir)
            if tree_mtime is None:
                tree_mtime = scanned_mtime

        # Get existing tracks for this album to reuse data for unchanged files
        existing_album_id = get_album_id_by_path(str(album_dir))

        existing_tracks_by_path: dict[str, dict] = {}
        if existing_album_id:
            existing_tracks_by_path = get_tracks_by_album_id(existing_album_id)

        total_size = 0
        total_duration = 0.0
        formats: Counter = Counter()
        year = None
        genre = None
        mb_albumid = None
        tag_album = None
        track_data_list = []
        album_entity_uid = canonical_entity_uid(album_dir.name)

        for f in audio_files:
            fpath = str(f)
            fstat = f.stat()
            total_size += fstat.st_size
            ext = f.suffix.lower()
            fmt = ext.lstrip(".")
            formats[fmt] += 1

            # Check if file is unchanged — reuse existing DB row
            existing = existing_tracks_by_path.get(fpath)
            if existing and existing.get("updated_at"):
                try:
                    stored_dt = to_datetime(existing["updated_at"])
                    stored_ts = stored_dt.timestamp() if stored_dt else 0.0
                    if stored_ts and fstat.st_mtime <= stored_ts:
                        duration = existing.get("duration") or 0.0
                        bitrate = existing.get("bitrate")
                        sample_rate = existing.get("sample_rate")
                        bit_depth = existing.get("bit_depth")
                        if (
                            not duration
                            or bitrate in (None, 0)
                            or sample_rate in (None, 0)
                            or (fmt in {"flac", "wav", "alac"} and bit_depth in (None, 0))
                        ):
                            scanned_duration, scanned_bitrate, scanned_sample_rate, scanned_bit_depth = _read_audio_info(f, fmt)
                            duration = duration or scanned_duration
                            bitrate = bitrate or scanned_bitrate or None
                            sample_rate = sample_rate or scanned_sample_rate or None
                            bit_depth = bit_depth or scanned_bit_depth or None
                        total_duration += duration
                        if not year and existing.get("year"):
                            year = existing["year"]
                        if not genre and existing.get("genre"):
                            genre = existing["genre"]
                        if not mb_albumid and existing.get("musicbrainz_albumid"):
                            mb_albumid = existing["musicbrainz_albumid"]
                        if not tag_album and existing.get("album"):
                            tag_album = existing["album"]
                        track_data_list.append({
                            "artist": existing["artist"],
                            "album": existing["album"],
                            "entity_uid": entity_uid_for(existing, "entity_uid"),
                            "filename": existing["filename"],
                            "title": existing.get("title"),
                            "track_number": existing.get("track_number"),
                            "disc_number": existing.get("disc_number", 1),
                            "format": fmt,
                            "bitrate": bitrate,
                            "sample_rate": sample_rate,
                            "bit_depth": bit_depth,
                            "duration": duration,
                            "size": fstat.st_size,
                            "year": existing.get("year"),
                            "genre": existing.get("genre"),
                            "albumartist": existing.get("albumartist"),
                            "musicbrainz_albumid": existing.get("musicbrainz_albumid"),
                            "musicbrainz_trackid": existing.get("musicbrainz_trackid"),
                            "audio_fingerprint": existing.get("audio_fingerprint"),
                            "audio_fingerprint_source": existing.get("audio_fingerprint_source"),
                            "path": fpath,
                        })
                        continue
                except (ValueError, OSError, TypeError):
                    pass

            # New or changed file — read tags + mutagen info
            try:
                mf = mutagen.File(f)
            except Exception:
                mf = None

            duration, bitrate, sample_rate, bit_depth = _read_audio_info(f, fmt, mf)

            total_duration += duration

            tags = read_tags(f)
            if not year and tags.get("date"):
                year = tags["date"][:4] if len(tags.get("date", "")) >= 4 else tags.get("date")
            if not genre:
                genre = tags.get("genre")
            if not mb_albumid:
                mb_albumid = tags.get("musicbrainz_albumid")
            if not tag_album and tags.get("album"):
                tag_album = tags["album"]

            track_data_list.append({
                "artist": tags.get("artist") or artist_name,
                "album": tags.get("album") or album_dir.name,
                "entity_uid": canonical_entity_uid(f.stem),
                "filename": f.name,
                "title": tags.get("title"),
                "track_number": _parse_int(tags.get("tracknumber")),
                "disc_number": _parse_int(tags.get("discnumber"), 1),
                "format": fmt,
                "bitrate": bitrate,
                "sample_rate": sample_rate or None,
                "bit_depth": bit_depth or None,
                "duration": duration,
                "size": fstat.st_size,
                "year": tags.get("date", "")[:4] if tags.get("date") else None,
                "genre": tags.get("genre"),
                "albumartist": tags.get("albumartist"),
                "musicbrainz_albumid": tags.get("musicbrainz_albumid"),
                "musicbrainz_trackid": tags.get("musicbrainz_trackid"),
                "audio_fingerprint": None,
                "audio_fingerprint_source": None,
                "path": fpath,
            })

        album_name = tag_album or (track_data_list[0]["album"] if track_data_list else None) or album_dir.name

        # Detect cover — check files on disk first, then embedded in audio
        has_cover = int(any((album_dir / name).exists() for name in COVER_NAMES))
        if not has_cover and audio_files:
            try:
                first = mutagen.File(audio_files[0])
                if first:
                    if hasattr(first, "pictures") and first.pictures:
                        has_cover = 1
                    elif hasattr(first, "tags") and first.tags:
                        if any(isinstance(k, str) and k.startswith("APIC") for k in first.tags):
                            has_cover = 1
                        # MP4/M4A embedded covers use the "covr" atom
                        elif "covr" in first.tags:
                            has_cover = 1
            except Exception:
                pass

        formats_list = sorted(formats.keys())

        _, _, synced_paths = upsert_scanned_album(
            artist_payload={
                "name": artist_name,
                "entity_uid": canonical_entity_uid(artist_root.name),
                "folder_name": artist_root.name,
                "album_count": 0,
                "track_count": 0,
                "total_size": 0,
                "formats": [],
                "dir_mtime": artist_root.stat().st_mtime,
            },
            album_payload={
                "name": album_name,
                "entity_uid": album_entity_uid,
                "path": str(album_dir),
                "track_count": len(track_data_list),
                "total_size": total_size,
                "total_duration": total_duration,
                "formats": formats_list,
                "year": year,
                "genre": genre,
                "has_cover": has_cover,
                "musicbrainz_albumid": mb_albumid,
                "tag_album": tag_album,
                "dir_mtime": tree_mtime,
            },
            track_payloads=track_data_list,
        )

        # Remove deleted tracks
        for old_path in set(existing_tracks_by_path.keys()) - synced_paths:
            delete_track_by_path(old_path)

        return {
            "track_count": len(track_data_list),
            "total_size": total_size,
            "formats": formats_list,
        }

    def _canonical_artist_name(self, artist_dir: Path, fallback: str) -> str:
        """Return the canonical artist name from audio tags, falling back to folder name."""
        for sub in artist_dir.iterdir():
            if not sub.is_dir() or sub.name.startswith("."):
                continue
            # Handle year subdirectories (Artist/Year/Album)
            dirs_to_check = [sub]
            if sub.name.isdigit() and len(sub.name) == 4:
                dirs_to_check = [d for d in sub.iterdir() if d.is_dir()]
            for album_dir in dirs_to_check:
                for f in album_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in self.extensions:
                        try:
                            tags = read_tags(f)
                            name = tags.get("albumartist") or tags.get("artist")
                            if name and name.strip():
                                return name.strip()
                        except Exception:
                            pass
        return fallback

    def _merge_duplicate_artists(self) -> int:
        """Merge artists with same normalized name into one canonical entry."""
        merged = 0
        all_artists = get_all_artist_names_and_counts()

        # Group by normalized key
        groups: dict[str, list[dict]] = {}
        for row in all_artists:
            key = normalize_key(row["name"])
            groups.setdefault(key, []).append(dict(row))

        for key, artists in groups.items():
            if len(artists) < 2:
                continue
            # Sort: most albums first, then most tracks
            artists.sort(key=lambda a: (a["album_count"], a["track_count"]), reverse=True)
            keep = artists[0]["name"]
            for other in artists[1:]:
                discard = other["name"]
                merge_artist_into(discard, keep)
                merged += 1
                log.info("Merged duplicate artist '%s' into '%s'", discard, keep)

        return merged

    def remove_stale(self) -> int:
        removed = 0
        artists, _ = get_library_artists(per_page=100000)

        # Build set of canonical artist names (those with albums) and their claimed folders
        canonical_folders = set()
        for row in artists:
            if row.get("folder_name") and row["album_count"] > 0:
                canonical_folders.add(row["folder_name"])

        for row in artists:
            # Remove empty entries whose name is a folder name already owned by a canonical artist
            # e.g. "ModelActriz" (0 albums) when "Model/Actriz" (folder_name=ModelActriz) exists with albums
            if row["album_count"] == 0 and row["track_count"] == 0:
                # Check if this artist's name matches a folder that belongs to a canonical artist
                if row["name"] in canonical_folders:
                    delete_artist(row["name"])
                    removed += 1
                    log.info("Removed duplicate artist: %s (folder claimed by canonical entry)", row["name"])
                    continue
                # Also check if a folder with this name resolves to a canonical artist via tags
                folder_dir = self.library_path / row["name"]
                if folder_dir.is_dir():
                    canonical = self._canonical_artist_name(folder_dir, row["name"])
                    if canonical != row["name"] and get_library_artist(canonical):
                        delete_artist(row["name"])
                        removed += 1
                        log.info("Removed duplicate artist: %s (canonical name is %s)", row["name"], canonical)
                        continue

            # Use folder_name to locate the directory; fall back to name for legacy rows
            dir_name = row.get("folder_name") or row["name"]
            artist_dir = self.library_path / dir_name
            if not artist_dir.is_dir():
                # Also check if any album paths still exist
                album_paths = get_album_paths_for_artist(row["name"])
                if any(Path(p).is_dir() for p in album_paths):
                    continue
                delete_artist(row["name"])
                removed += 1
                log.info("Removed stale artist: %s", row["name"])

        albums = get_all_album_paths()

        for row in albums:
            if not Path(row["path"]).is_dir():
                delete_album(row["path"])
                log.info("Removed stale album: %s", row["path"])

        return removed


def _parse_int(val, default=None):
    if val is None:
        return default
    try:
        # Handle "1/12" format
        return int(str(val).split("/")[0])
    except (ValueError, TypeError):
        return default
