from pathlib import Path

import mutagen

from crate.api._deps import COVER_NAMES, exclude_dirs, extensions, library_path, safe_path
from crate.audio import get_audio_files, read_tags
from crate.db import get_db_ctx, get_library_album, get_library_track_count

import re as _re

ARTIST_PHOTO_NAMES = ["artist.jpg", "artist.png", "photo.jpg"]
_YEAR_PREFIX_RE = _re.compile(r"^\d{4}\s*[-–]\s*")


def display_name(folder_name: str) -> str:
    """Strip year prefix from album folder name for display."""
    return _YEAR_PREFIX_RE.sub("", folder_name)


def has_library_data() -> bool:
    return get_library_track_count() > 0


def fs_build_artists_list() -> list[dict]:
    lib = library_path()
    exts = extensions()
    excluded = exclude_dirs()
    artists = []

    for artist_dir in sorted(lib.iterdir()):
        if (
            not artist_dir.is_dir()
            or artist_dir.name.startswith(".")
            or artist_dir.name.startswith("_")
            or artist_dir.name in excluded
        ):
            continue
        album_count = 0
        track_count = 0
        total_size = 0
        fmt_counts: dict[str, int] = {}
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            album_count += 1
            for file_path in album_dir.iterdir():
                if file_path.is_file() and file_path.suffix.lower() in exts:
                    track_count += 1
                    ext = file_path.suffix.lower()
                    fmt_counts[ext] = fmt_counts.get(ext, 0) + 1
                    total_size += file_path.stat().st_size
        primary_format = max(fmt_counts, key=fmt_counts.get) if fmt_counts else None
        has_photo = any((artist_dir / photo_name).exists() for photo_name in ARTIST_PHOTO_NAMES)
        artists.append(
            {
                "name": artist_dir.name,
                "albums": album_count,
                "tracks": track_count,
                "total_size_mb": round(total_size / (1024**2)),
                "formats": list(fmt_counts.keys()),
                "primary_format": primary_format,
                "has_photo": has_photo,
            }
        )
    return artists


def fs_artist_detail(name: str) -> dict | None:
    lib = library_path()
    artist_dir = safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return None

    exts = extensions()
    albums = []
    total_tracks = 0
    total_size = 0
    all_fmt_counts: dict[str, int] = {}
    genre_counts: dict[str, int] = {}

    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        tracks = get_audio_files(album_dir, exts)
        formats = list({track.suffix.lower() for track in tracks})
        album_size = sum(track.stat().st_size for track in tracks)
        has_cover = any((album_dir / cover_name).exists() for cover_name in COVER_NAMES)
        total_tracks += len(tracks)
        total_size += album_size
        for track in tracks:
            ext = track.suffix.lower()
            all_fmt_counts[ext] = all_fmt_counts.get(ext, 0) + 1
        year = ""
        if tracks:
            tags = read_tags(tracks[0])
            year = tags.get("date", "")[:4]
            genre = tags.get("genre", "")
            if genre:
                genre_counts[genre] = genre_counts.get(genre, 0) + 1
        albums.append(
            {
                "name": album_dir.name,
                "tracks": len(tracks),
                "formats": formats,
                "size_mb": round(album_size / (1024**2)),
                "year": year,
                "has_cover": has_cover,
            }
        )

    primary_format = max(all_fmt_counts, key=all_fmt_counts.get) if all_fmt_counts else None
    top_genres = [genre for genre, _count in sorted(genre_counts.items(), key=lambda item: item[1], reverse=True)[:5]]

    return {
        "name": name,
        "albums": albums,
        "total_tracks": total_tracks,
        "total_size_mb": round(total_size / (1024**2)),
        "primary_format": primary_format,
        "genres": top_genres,
    }


def fs_album_detail(artist: str, album: str) -> dict | None:
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return None

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    has_cover = any((album_dir / cover_name).exists() for cover_name in COVER_NAMES)
    cover_file = None
    for cover_name in COVER_NAMES:
        if (album_dir / cover_name).exists():
            cover_file = cover_name
            break

    track_list = []
    album_tags = {}
    for track in tracks:
        tags = read_tags(track)
        info = mutagen.File(track)
        bitrate = getattr(info.info, "bitrate", 0)
        length = getattr(info.info, "length", 0)
        track_list.append(
            {
                "filename": track.name,
                "format": track.suffix.lower(),
                "size_mb": round(track.stat().st_size / (1024**2), 1),
                "bitrate": bitrate // 1000 if bitrate else None,
                "length_sec": round(length) if length else 0,
                "tags": tags,
                "path": str(track.relative_to(lib)),
            }
        )
        if not album_tags and tags.get("album"):
            album_tags = {
                "artist": tags.get("albumartist") or tags.get("artist", ""),
                "album": tags.get("album", ""),
                "year": tags.get("date", "")[:4],
                "genre": tags.get("genre", "") if "genre" in tags else "",
                "musicbrainz_albumid": tags.get("musicbrainz_albumid"),
            }

    total_size = sum(track.stat().st_size for track in tracks)
    total_length = sum(track["length_sec"] for track in track_list)

    return {
        "artist": artist,
        "name": album,
        "path": str(album_dir),
        "track_count": len(tracks),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": has_cover,
        "cover_file": cover_file,
        "tracks": track_list,
        "album_tags": album_tags,
    }


def fs_search(q: str) -> dict:
    lib = library_path()
    excluded = exclude_dirs()
    artists = []
    albums = []
    q_lower = q.lower().strip()

    for artist_dir in sorted(lib.iterdir()):
        if (
            not artist_dir.is_dir()
            or artist_dir.name.startswith(".")
            or artist_dir.name.startswith("_")
            or artist_dir.name in excluded
        ):
            continue
        if q_lower in artist_dir.name.lower():
            artists.append({"name": artist_dir.name})
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            if q_lower in album_dir.name.lower() or q_lower in artist_dir.name.lower():
                albums.append({"artist": artist_dir.name, "name": album_dir.name})
        if len(artists) > 20 and len(albums) > 50:
            break

    return {"artists": artists[:20], "albums": albums[:50]}


def find_album_row(artist: str, album: str) -> dict | None:
    """Find album in DB, handling year-prefixed names, clean names, and case differences."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND LOWER(name) = LOWER(%s) LIMIT 1",
            (artist, album),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND name ILIKE %s LIMIT 1",
            (artist, f"% - {album}"),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        cur.execute("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s)", (artist,))
        for row in cur.fetchall():
            if display_name(row["name"]) == album:
                return dict(row)
    return None


def find_album_dir(lib: Path, artist: str, album: str) -> Path | None:
    """Find album directory, supporting both 2-level and 3-level structures."""
    direct = safe_path(lib, f"{artist}/{album}")
    if direct and direct.is_dir():
        return direct

    artist_dir = safe_path(lib, artist)
    if artist_dir and artist_dir.is_dir():
        for subdir in artist_dir.iterdir():
            if subdir.is_dir() and subdir.name.isdigit() and len(subdir.name) == 4:
                candidate = subdir / album
                if candidate.is_dir():
                    return candidate

    album_data = get_library_album(artist, album)
    if album_data and album_data.get("path"):
        path = Path(album_data["path"])
        if path.is_dir():
            return path
    return None
