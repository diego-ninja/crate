"""Library analytics: genre, decade, format, bitrate distribution."""

import logging
from collections import Counter, defaultdict
from pathlib import Path

import mutagen

from musicdock.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)


def compute_analytics(library_path: Path, extensions: set[str],
                      progress_callback=None) -> dict:
    """Compute full library analytics."""
    genres = Counter()
    decades = Counter()
    formats = Counter()
    bitrates = Counter()
    artists_by_albums = Counter()
    sizes_by_format = defaultdict(int)
    tracks_per_album = []
    total_duration = 0
    tracks_processed = 0

    artist_dirs = [d for d in sorted(library_path.iterdir())
                   if d.is_dir() and not d.name.startswith(".")]
    total_artists = len(artist_dirs)

    for idx, artist_dir in enumerate(artist_dirs):
        album_count = 0
        for album_dir in sorted(artist_dir.iterdir()):
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            album_count += 1
            tracks = get_audio_files(album_dir, extensions)
            tracks_per_album.append(len(tracks))

            for track in tracks:
                tags = read_tags(track)
                fmt = track.suffix.lower()
                formats[fmt] += 1
                sizes_by_format[fmt] += track.stat().st_size
                tracks_processed += 1

                genre = tags.get("genre", "").strip()
                if genre:
                    genres[genre] += 1

                year_str = tags.get("date", "")[:4]
                if year_str and year_str.isdigit():
                    decade = (int(year_str) // 10) * 10
                    decades[f"{decade}s"] += 1

                try:
                    info = mutagen.File(track)
                    if info and hasattr(info.info, "bitrate") and info.info.bitrate:
                        br = info.info.bitrate // 1000
                        bucket = _bitrate_bucket(br)
                        bitrates[bucket] += 1
                    if info and hasattr(info.info, "length"):
                        total_duration += info.info.length
                except Exception:
                    pass

        if album_count > 0:
            artists_by_albums[artist_dir.name] = album_count

        if progress_callback and idx % 5 == 0:
            progress_callback({
                "phase": "analytics",
                "artist": artist_dir.name,
                "artists_done": idx + 1,
                "artists_total": total_artists,
                "tracks_processed": tracks_processed,
            })

    # Top artists by album count
    top_artists = [{"name": name, "albums": count} for name, count in artists_by_albums.most_common(25)]

    # Average tracks per album
    avg_tracks = round(sum(tracks_per_album) / len(tracks_per_album), 1) if tracks_per_album else 0

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
