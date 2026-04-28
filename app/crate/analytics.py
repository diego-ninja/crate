"""Library analytics: genre, decade, format, bitrate distribution."""

import logging
from collections import Counter, defaultdict
from pathlib import Path

import mutagen

from crate.audio import get_audio_files, read_tags
from crate.db.cache_dir_mtimes import delete_dir_mtime, get_all_dir_mtimes, set_dir_mtime

log = logging.getLogger(__name__)


def _compute_artist_data(artist_dir: Path, extensions: set[str]) -> dict:
    """Compute analytics data for a single artist directory."""
    genres: dict[str, int] = {}
    decades: dict[str, int] = {}
    formats: dict[str, int] = {}
    bitrates: dict[str, int] = {}
    sizes: dict[str, int] = {}
    album_count = 0
    track_count = 0
    tracks_per_album: list[int] = []
    duration = 0.0

    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue

        album_count += 1
        tracks = get_audio_files(album_dir, extensions)
        tracks_per_album.append(len(tracks))

        for track in tracks:
            tags = read_tags(track)
            fmt = track.suffix.lower()
            formats[fmt] = formats.get(fmt, 0) + 1
            sizes[fmt] = sizes.get(fmt, 0) + track.stat().st_size
            track_count += 1

            genre = tags.get("genre", "").strip()
            if genre:
                genres[genre] = genres.get(genre, 0) + 1

            year_str = tags.get("date", "")[:4]
            if year_str and year_str.isdigit():
                decade = (int(year_str) // 10) * 10
                key = f"{decade}s"
                decades[key] = decades.get(key, 0) + 1

            try:
                info = mutagen.File(track)
                if info and hasattr(info.info, "bitrate") and info.info.bitrate:
                    br = info.info.bitrate // 1000
                    bucket = _bitrate_bucket(br)
                    bitrates[bucket] = bitrates.get(bucket, 0) + 1
                if info and hasattr(info.info, "length"):
                    duration += info.info.length
            except Exception:
                pass

    return {
        "genres": genres,
        "decades": decades,
        "formats": formats,
        "bitrates": bitrates,
        "sizes": sizes,
        "album_count": album_count,
        "track_count": track_count,
        "tracks_per_album": tracks_per_album,
        "duration": duration,
    }


def _merge_artist_data(all_data: list[tuple[str, dict]]) -> dict:
    """Merge per-artist data into final analytics result."""
    genres = Counter()
    decades = Counter()
    formats = Counter()
    bitrates = Counter()
    sizes_by_format = defaultdict(int)
    artists_by_albums = Counter()
    all_tracks_per_album: list[int] = []
    total_duration = 0.0

    for artist_name, data in all_data:
        for g, c in data.get("genres", {}).items():
            genres[g] += c
        for d, c in data.get("decades", {}).items():
            decades[d] += c
        for f, c in data.get("formats", {}).items():
            formats[f] += c
        for b, c in data.get("bitrates", {}).items():
            bitrates[b] += c
        for f, s in data.get("sizes", {}).items():
            sizes_by_format[f] += s
        ac = data.get("album_count", 0)
        if ac > 0:
            artists_by_albums[artist_name] = ac
        all_tracks_per_album.extend(data.get("tracks_per_album", []))
        total_duration += data.get("duration", 0.0)

    top_artists = [{"name": name, "albums": count} for name, count in artists_by_albums.most_common(25)]
    avg_tracks = round(sum(all_tracks_per_album) / len(all_tracks_per_album), 1) if all_tracks_per_album else 0

    return {
        "genres": dict(genres.most_common(30)),
        "decades": dict(sorted(decades.items())),
        "formats": dict(formats.most_common()),
        "bitrates": dict(sorted(bitrates.items(), key=lambda x: _bitrate_sort(x[0]))),
        "sizes_by_format_gb": {k: round(v / (1024**3), 2) for k, v in sizes_by_format.items()},
        "top_artists": top_artists,
        "avg_tracks_per_album": avg_tracks,
        "total_duration_hours": round(total_duration / 3600, 1),
    }


def compute_analytics(library_path: Path, extensions: set[str],
                      progress_callback=None, incremental: bool = True) -> dict:
    """Compute library analytics, incrementally if possible."""
    artist_dirs = [d for d in sorted(library_path.iterdir())
                   if d.is_dir() and not d.name.startswith(".")]
    total_artists = len(artist_dirs)

    stored = get_all_dir_mtimes("analytics:") if incremental else {}

    all_data: list[tuple[str, dict]] = []
    cached_count = 0
    recomputed_count = 0

    for idx, artist_dir in enumerate(artist_dirs):
        key = f"analytics:{artist_dir}"
        current_mtime = artist_dir.stat().st_mtime

        entry = stored.get(key)
        if entry and entry[0] == current_mtime and entry[1] is not None:
            all_data.append((artist_dir.name, entry[1]))
            cached_count += 1
        else:
            data = _compute_artist_data(artist_dir, extensions)
            set_dir_mtime(key, current_mtime, data)
            all_data.append((artist_dir.name, data))
            recomputed_count += 1

        if progress_callback and idx % 5 == 0:
            progress_callback({
                "phase": "analytics",
                "artist": artist_dir.name,
                "artists_done": idx + 1,
                "artists_total": total_artists,
                "tracks_processed": sum(d.get("track_count", 0) for _, d in all_data),
                "cached": cached_count,
                "recomputed": recomputed_count,
            })

    # Clean up entries for artist dirs that no longer exist
    current_keys = {f"analytics:{d}" for d in artist_dirs}
    for old_key in stored:
        if old_key not in current_keys:
            delete_dir_mtime(old_key)

    return _merge_artist_data(all_data)


def _bitrate_bucket(br: int) -> str:
    if br <= 128:
        return "≤128k"
    elif br <= 192:
        return "129-192k"
    elif br <= 256:
        return "193-256k"
    elif br <= 320:
        return "257-320k"
    elif br <= 500:
        return "321-500k"
    else:
        return "500k+ (lossless)"


def _bitrate_sort(bucket: str) -> int:
    order = {"≤128k": 0, "129-192k": 1, "193-256k": 2, "257-320k": 3, "321-500k": 4, "500k+ (lossless)": 5}
    return order.get(bucket, 99)
