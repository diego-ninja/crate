import logging
from collections import Counter
from datetime import datetime
from pathlib import Path

import mutagen

from musicdock.audio import get_audio_files, read_tags
from musicdock.db import (
    delete_album,
    delete_artist,
    get_db_ctx,
    get_library_albums,
    get_library_artist,
    upsert_album,
    upsert_artist,
    upsert_track,
)

log = logging.getLogger(__name__)

COVER_NAMES = {"cover.jpg", "cover.png", "folder.jpg", "front.jpg"}
PHOTO_NAMES = {"artist.jpg", "artist.png", "photo.jpg"}


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

        for i, (artist_name, dirs) in enumerate(sorted(canonical_map.items())):
            try:
                # Use first folder as primary for mtime/photo checks
                primary_dir = dirs[0]
                folder_names = [d.name for d in dirs]
                existing = get_library_artist(artist_name) or get_library_artist(dirs[0].name)

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

    def sync_artist_dirs(self, artist_name: str, artist_dirs: list[Path]) -> int:
        """Sync one or more folders that all belong to the same canonical artist."""
        primary_dir = artist_dirs[0]
        primary_folder = primary_dir.name

        # Ensure artist exists in DB; use exact DB name for FK consistency
        existing = get_library_artist(artist_name)
        if existing:
            artist_name = existing["name"]
        else:
            upsert_artist({"name": artist_name, "folder_name": primary_folder,
                           "album_count": 0, "track_count": 0,
                           "total_size": 0, "formats": [], "dir_mtime": primary_dir.stat().st_mtime})

        # Collect album dirs from ALL folders for this artist
        album_dirs = []
        for artist_dir in artist_dirs:
            album_dirs.extend(sorted([
                d for d in artist_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ]))

        # Get existing albums for this artist to detect deletions
        existing_albums = get_library_albums(artist_name)
        existing_paths = {a["path"] for a in existing_albums}

        total_tracks = 0
        synced_paths = set()

        for album_dir in album_dirs:
            try:
                album_path = str(album_dir)
                synced_paths.add(album_path)

                existing_album = next((a for a in existing_albums if a["path"] == album_path), None)
                dir_mtime = album_dir.stat().st_mtime

                if existing_album and existing_album.get("dir_mtime") and existing_album["dir_mtime"] >= dir_mtime:
                    total_tracks += existing_album.get("track_count", 0)
                    continue

                result = self.sync_album(album_dir, artist_name)
                total_tracks += result["track_count"]

            except Exception:
                log.exception("Failed to sync album %s", album_dir.name)

        # Remove deleted albums
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

    def sync_album(self, album_dir: Path, artist_name: str) -> dict:
        # Ensure artist exists (FK constraint) and use exact DB name for FK references
        existing = get_library_artist(artist_name)
        if existing:
            artist_name = existing["name"]  # Use exact DB name (case may differ)
        else:
            upsert_artist({"name": artist_name, "album_count": 0, "track_count": 0,
                           "total_size": 0, "formats": [], "dir_mtime": album_dir.parent.stat().st_mtime})

        audio_files = get_audio_files(album_dir, list(self.extensions))

        # Get existing tracks for this album to reuse data for unchanged files
        existing_album_row = None
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT id FROM library_albums WHERE path = %s", (str(album_dir),)
            )
            existing_album_row = cur.fetchone()

        existing_tracks_by_path: dict[str, dict] = {}
        if existing_album_row:
            with get_db_ctx() as cur:
                cur.execute(
                    "SELECT * FROM library_tracks WHERE album_id = %s",
                    (existing_album_row["id"],),
                )
                rows = cur.fetchall()
                existing_tracks_by_path = {r["path"]: dict(r) for r in rows}

        total_size = 0
        total_duration = 0.0
        formats: Counter = Counter()
        year = None
        genre = None
        mb_albumid = None
        tag_album = None
        track_data_list = []

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
                    stored_ts = datetime.fromisoformat(existing["updated_at"]).timestamp()
                    if fstat.st_mtime <= stored_ts:
                        duration = existing.get("duration") or 0.0
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
                            "filename": existing["filename"],
                            "title": existing.get("title"),
                            "track_number": existing.get("track_number"),
                            "disc_number": existing.get("disc_number", 1),
                            "format": fmt,
                            "bitrate": existing.get("bitrate"),
                            "duration": duration,
                            "size": fstat.st_size,
                            "year": existing.get("year"),
                            "genre": existing.get("genre"),
                            "albumartist": existing.get("albumartist"),
                            "musicbrainz_albumid": existing.get("musicbrainz_albumid"),
                            "musicbrainz_trackid": existing.get("musicbrainz_trackid"),
                            "path": fpath,
                        })
                        continue
                except (ValueError, OSError):
                    pass

            # New or changed file — read tags + mutagen info
            try:
                mf = mutagen.File(f)
            except Exception:
                mf = None

            duration = mf.info.length if mf and mf.info else 0.0
            bitrate = getattr(mf.info, "bitrate", 0) if mf and mf.info else 0
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
                "filename": f.name,
                "title": tags.get("title"),
                "track_number": _parse_int(tags.get("tracknumber")),
                "disc_number": _parse_int(tags.get("discnumber"), 1),
                "format": fmt,
                "bitrate": bitrate,
                "duration": duration,
                "size": fstat.st_size,
                "year": tags.get("date", "")[:4] if tags.get("date") else None,
                "genre": tags.get("genre"),
                "albumartist": tags.get("albumartist"),
                "musicbrainz_albumid": tags.get("musicbrainz_albumid"),
                "musicbrainz_trackid": tags.get("musicbrainz_trackid"),
                "path": fpath,
            })

        # Detect cover — check files on disk first, then embedded in audio
        has_cover = int(any((album_dir / name).exists() for name in COVER_NAMES))
        if not has_cover and audio_files:
            try:
                first = mutagen.File(audio_files[0])
                if first:
                    if hasattr(first, "pictures") and first.pictures:
                        has_cover = 1
                    elif hasattr(first, "tags") and first.tags:
                        if any(k.startswith("APIC") for k in first.tags):
                            has_cover = 1
            except Exception:
                pass

        formats_list = sorted(formats.keys())

        # Upsert album
        album_id = upsert_album({
            "artist": artist_name,
            "name": album_dir.name,
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
            "dir_mtime": album_dir.stat().st_mtime,
        })

        # Upsert tracks
        synced_paths = set()
        for td in track_data_list:
            td["album_id"] = album_id
            upsert_track(td)
            synced_paths.add(td["path"])

        # Remove deleted tracks
        for old_path in set(existing_tracks_by_path.keys()) - synced_paths:
            with get_db_ctx() as cur:
                cur.execute("DELETE FROM library_tracks WHERE path = %s", (old_path,))

        return {
            "track_count": len(track_data_list),
            "total_size": total_size,
            "formats": formats_list,
        }

    def _canonical_artist_name(self, artist_dir: Path, fallback: str) -> str:
        """Return the canonical artist name from audio tags, falling back to folder name."""
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in self.extensions:
                    try:
                        tags = read_tags(f)
                        # Prefer albumartist, then artist tag
                        name = tags.get("albumartist") or tags.get("artist")
                        if name and name.strip():
                            return name.strip()
                    except Exception:
                        pass
                    return fallback
        return fallback

    @staticmethod
    def _normalize_key(name: str) -> str:
        """Normalize artist name for dedup: lowercase, normalize unicode hyphens/quotes/spaces."""
        import unicodedata
        # Normalize unicode (NFC)
        name = unicodedata.normalize("NFC", name.lower().strip())
        # Replace common unicode hyphens/dashes with ASCII hyphen
        for ch in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d":
            name = name.replace(ch, "-")
        # Collapse multiple spaces/hyphens
        import re
        name = re.sub(r"\s+", " ", name)
        name = re.sub(r"-+", "-", name)
        return name

    def _merge_duplicate_artists(self) -> int:
        """Merge artists with same normalized name into one canonical entry."""
        merged = 0
        with get_db_ctx() as cur:
            cur.execute("SELECT name, album_count, track_count FROM library_artists")
            all_artists = cur.fetchall()

        # Group by normalized key
        groups: dict[str, list[dict]] = {}
        for row in all_artists:
            key = self._normalize_key(row["name"])
            groups.setdefault(key, []).append(dict(row))

        for key, artists in groups.items():
            if len(artists) < 2:
                continue
            # Sort: most albums first, then most tracks
            artists.sort(key=lambda a: (a["album_count"], a["track_count"]), reverse=True)
            keep = artists[0]["name"]
            for other in artists[1:]:
                discard = other["name"]
                self._merge_artist_into(discard, keep)
                merged += 1
                log.info("Merged duplicate artist '%s' into '%s'", discard, keep)

        return merged

    def _merge_artist_into(self, source: str, target: str):
        """Move all albums and tracks from source artist to target, then delete source."""
        with get_db_ctx() as cur:
            # Get albums from source that would conflict with target (same album name)
            cur.execute("""
                SELECT s.id AS source_id, t.id AS target_id
                FROM library_albums s
                JOIN library_albums t ON LOWER(s.name) = LOWER(t.name) AND t.artist = %s
                WHERE s.artist = %s
            """, (target, source))
            conflicts = cur.fetchall()

            # For conflicting albums, move tracks to target album and delete source album
            for c in conflicts:
                cur.execute("UPDATE library_tracks SET album_id = %s, artist = %s WHERE album_id = %s",
                            (c["target_id"], target, c["source_id"]))
                cur.execute("DELETE FROM library_albums WHERE id = %s", (c["source_id"],))

            # Re-assign remaining non-conflicting albums
            cur.execute("UPDATE library_albums SET artist = %s WHERE artist = %s", (target, source))
            # Re-assign any remaining tracks
            cur.execute("UPDATE library_tracks SET artist = %s WHERE artist = %s", (target, source))
            # Delete source artist
            cur.execute("DELETE FROM library_artists WHERE name = %s", (source,))

    def remove_stale(self) -> int:
        removed = 0
        with get_db_ctx() as cur:
            cur.execute("SELECT name, folder_name, album_count, track_count FROM library_artists")
            artists = cur.fetchall()

        # Build set of canonical artist names (those with albums) and their claimed folders
        canonical_folders = set()
        for row in artists:
            if row["folder_name"] and row["album_count"] > 0:
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
            dir_name = row["folder_name"] or row["name"]
            artist_dir = self.library_path / dir_name
            if not artist_dir.is_dir():
                # Also check if any album paths still exist
                with get_db_ctx() as cur:
                    cur.execute("SELECT path FROM library_albums WHERE artist = %s", (row["name"],))
                    album_paths = [r["path"] for r in cur.fetchall()]
                if any(Path(p).is_dir() for p in album_paths):
                    continue
                delete_artist(row["name"])
                removed += 1
                log.info("Removed stale artist: %s", row["name"])

        with get_db_ctx() as cur:
            cur.execute("SELECT path, artist FROM library_albums")
            albums = cur.fetchall()

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
