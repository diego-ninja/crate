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

        artist_dirs = sorted([
            d for d in self.library_path.iterdir()
            if d.is_dir() and not d.name.startswith(".") and d.name not in self.exclude_dirs
        ])
        total_artists = len(artist_dirs)

        for i, artist_dir in enumerate(artist_dirs):
            try:
                existing = get_library_artist(artist_dir.name)
                dir_mtime = artist_dir.stat().st_mtime

                if existing and existing.get("dir_mtime") and existing["dir_mtime"] >= dir_mtime:
                    tracks_total += existing.get("track_count", 0)
                    if progress_callback and i % 50 == 0:
                        progress_callback({
                            "phase": "sync",
                            "artist": artist_dir.name,
                            "artists_done": i + 1,
                            "artists_total": total_artists,
                            "tracks_total": tracks_total,
                        })
                    continue

                count = self.sync_artist(artist_dir)
                tracks_total += count

                if existing:
                    artists_updated += 1
                else:
                    artists_added += 1

            except Exception:
                log.exception("Failed to sync artist %s", artist_dir.name)

            if progress_callback and i % 10 == 0:
                progress_callback({
                    "phase": "sync",
                    "artist": artist_dir.name,
                    "artists_done": i + 1,
                    "artists_total": total_artists,
                    "tracks_total": tracks_total,
                })

        artists_removed = self.remove_stale()

        return {
            "artists_added": artists_added,
            "artists_updated": artists_updated,
            "artists_removed": artists_removed,
            "tracks_total": tracks_total,
        }

    def sync_artist(self, artist_dir: Path) -> int:
        artist_name = artist_dir.name

        album_dirs = sorted([
            d for d in artist_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        ])

        # Get existing albums for this artist to detect deletions
        existing_albums = get_library_albums(artist_name)
        existing_paths = {a["path"] for a in existing_albums}

        total_tracks = 0
        total_size = 0
        all_formats: Counter = Counter()
        synced_paths = set()

        for album_dir in album_dirs:
            try:
                album_path = str(album_dir)
                synced_paths.add(album_path)

                # Find existing album to check mtime
                existing_album = next((a for a in existing_albums if a["path"] == album_path), None)
                dir_mtime = album_dir.stat().st_mtime

                if existing_album and existing_album.get("dir_mtime") and existing_album["dir_mtime"] >= dir_mtime:
                    total_tracks += existing_album.get("track_count", 0)
                    total_size += existing_album.get("total_size", 0)
                    for fmt in existing_album.get("formats", []):
                        all_formats[fmt] += 1
                    continue

                result = self.sync_album(album_dir, artist_name)
                total_tracks += result["track_count"]
                total_size += result["total_size"]
                for fmt in result["formats"]:
                    all_formats[fmt] += 1

            except Exception:
                log.exception("Failed to sync album %s", album_dir.name)

        # Remove deleted albums
        for path in existing_paths - synced_paths:
            delete_album(path)

        # Detect artist photo
        has_photo = int(any((artist_dir / name).exists() for name in PHOTO_NAMES))

        formats_list = sorted(all_formats.keys())
        primary_format = all_formats.most_common(1)[0][0] if all_formats else None

        upsert_artist({
            "name": artist_name,
            "album_count": len(album_dirs),
            "track_count": total_tracks,
            "total_size": total_size,
            "formats": formats_list,
            "primary_format": primary_format,
            "has_photo": has_photo,
            "dir_mtime": artist_dir.stat().st_mtime,
        })

        return total_tracks

    def sync_album(self, album_dir: Path, artist_name: str) -> dict:
        audio_files = get_audio_files(album_dir, list(self.extensions))

        # Get existing tracks for this album to reuse data for unchanged files
        existing_album_row = None
        with get_db_ctx() as conn:
            existing_album_row = conn.execute(
                "SELECT id FROM library_albums WHERE path = ?", (str(album_dir),)
            ).fetchone()

        existing_tracks_by_path: dict[str, dict] = {}
        if existing_album_row:
            with get_db_ctx() as conn:
                rows = conn.execute(
                    "SELECT * FROM library_tracks WHERE album_id = ?",
                    (existing_album_row["id"],),
                ).fetchall()
                existing_tracks_by_path = {r["path"]: dict(r) for r in rows}

        total_size = 0
        total_duration = 0.0
        formats: Counter = Counter()
        year = None
        genre = None
        mb_albumid = None
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

        # Detect cover
        has_cover = int(any((album_dir / name).exists() for name in COVER_NAMES))

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
            with get_db_ctx() as conn:
                conn.execute("DELETE FROM library_tracks WHERE path = ?", (old_path,))

        return {
            "track_count": len(track_data_list),
            "total_size": total_size,
            "formats": formats_list,
        }

    def remove_stale(self) -> int:
        removed = 0
        with get_db_ctx() as conn:
            artists = conn.execute("SELECT name FROM library_artists").fetchall()

        for row in artists:
            artist_dir = self.library_path / row["name"]
            if not artist_dir.is_dir():
                delete_artist(row["name"])
                removed += 1
                log.info("Removed stale artist: %s", row["name"])

        with get_db_ctx() as conn:
            albums = conn.execute("SELECT path, artist FROM library_albums").fetchall()

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
