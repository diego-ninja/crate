"""Quality report: detect low quality, lossy when lossless available, corrupt files."""

import logging
from pathlib import Path

import mutagen

from crate.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)

LOSSLESS = {".flac", ".wav", ".alac"}
LOSSY = {".mp3", ".m4a", ".ogg", ".opus", ".wma"}


def quality_report(library_path: Path, extensions: set[str]) -> dict:
    """Generate a quality report for the library."""
    low_bitrate = []
    lossy_with_lossless = []
    corrupt = []
    short_albums = []
    mixed_format_albums = []

    for artist_dir in sorted(library_path.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue

        # Collect all albums for this artist to cross-check formats
        artist_albums = {}

        for album_dir in sorted(artist_dir.iterdir()):
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue

            tracks = get_audio_files(album_dir, extensions)
            if not tracks:
                continue

            album_formats = set()
            album_issues = []

            for track in tracks:
                fmt = track.suffix.lower()
                album_formats.add(fmt)

                try:
                    info = mutagen.File(track)
                    if info is None:
                        corrupt.append({
                            "artist": artist_dir.name,
                            "album": album_dir.name,
                            "file": track.name,
                            "reason": "Cannot read file",
                        })
                        continue

                    # Check for corrupt: no length or zero length
                    length = getattr(info.info, "length", 0)
                    if not length or length < 1:
                        corrupt.append({
                            "artist": artist_dir.name,
                            "album": album_dir.name,
                            "file": track.name,
                            "reason": f"Zero/invalid duration ({length:.1f}s)",
                        })
                        continue

                    # Low bitrate check (only for lossy formats)
                    if fmt in LOSSY:
                        bitrate = getattr(info.info, "bitrate", 0)
                        if bitrate and bitrate < 192000:
                            low_bitrate.append({
                                "artist": artist_dir.name,
                                "album": album_dir.name,
                                "file": track.name,
                                "format": fmt,
                                "bitrate_kbps": bitrate // 1000,
                            })

                except Exception as e:
                    corrupt.append({
                        "artist": artist_dir.name,
                        "album": album_dir.name,
                        "file": track.name,
                        "reason": str(e),
                    })

            # Mixed format album
            if len(album_formats) > 1:
                mixed_format_albums.append({
                    "artist": artist_dir.name,
                    "album": album_dir.name,
                    "formats": sorted(album_formats),
                    "track_count": len(tracks),
                })

            # Short albums (potentially incomplete downloads)
            tags = read_tags(tracks[0]) if tracks else {}
            album_tag = tags.get("album", album_dir.name)
            artist_albums[album_tag] = {
                "dir": album_dir.name,
                "formats": album_formats,
                "track_count": len(tracks),
            }

        # Cross-check: lossy album when lossless exists for same album name
        album_by_name = {}
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            tracks = get_audio_files(album_dir, extensions)
            if not tracks:
                continue
            tags = read_tags(tracks[0])
            name = _normalize_album(tags.get("album", "") or album_dir.name)
            fmts = {t.suffix.lower() for t in tracks}
            if name not in album_by_name:
                album_by_name[name] = []
            album_by_name[name].append({
                "dir": album_dir.name,
                "formats": fmts,
                "track_count": len(tracks),
                "has_lossless": bool(fmts & LOSSLESS),
                "has_lossy": bool(fmts & LOSSY),
            })

        for name, versions in album_by_name.items():
            has_any_lossless = any(v["has_lossless"] for v in versions)
            for v in versions:
                if v["has_lossy"] and not v["has_lossless"] and has_any_lossless:
                    lossy_with_lossless.append({
                        "artist": artist_dir.name,
                        "lossy_album": v["dir"],
                        "lossy_formats": sorted(v["formats"] & LOSSY),
                        "lossless_album": next(
                            x["dir"] for x in versions if x["has_lossless"]
                        ),
                    })

    return {
        "low_bitrate": low_bitrate,
        "low_bitrate_count": len(low_bitrate),
        "lossy_with_lossless": lossy_with_lossless,
        "lossy_with_lossless_count": len(lossy_with_lossless),
        "corrupt": corrupt,
        "corrupt_count": len(corrupt),
        "mixed_format_albums": mixed_format_albums,
        "mixed_format_count": len(mixed_format_albums),
    }


def _normalize_album(name: str) -> str:
    import re
    name = name.lower().strip()
    name = re.sub(r"\s*\(.*?\)\s*", "", name)
    name = re.sub(r"\s*\[.*?\]\s*", "", name)
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name
