"""yt-dlp client for downloading music from YouTube, Bandcamp, SoundCloud, etc."""

import json
import logging
import re
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

YTDLP_BIN = "yt-dlp"


def is_available() -> bool:
    try:
        r = subprocess.run([YTDLP_BIN, "--version"], capture_output=True, timeout=5)
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def search(query: str, limit: int = 20) -> list[dict]:
    """Search across YouTube Music, SoundCloud, and Bandcamp in parallel."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from urllib.parse import quote_plus
    sources = [
        (f"https://music.youtube.com/search?q={quote_plus(query)}", "youtube_music"),
        (f"scsearch{min(limit, 10)}:{query}", "soundcloud"),
    ]

    all_results: list[dict] = []

    def _search_source(search_query: str, fallback_source: str) -> list[dict]:
        return _run_search(search_query, fallback_source)

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_search_source, sq, fs): fs for sq, fs in sources}
        for future in as_completed(futures, timeout=45):
            try:
                all_results.extend(future.result())
            except Exception:
                pass

    # Sort: albums first, then by view count
    type_order = {"album": 0, "mix": 1, "track": 2}
    all_results.sort(key=lambda r: (type_order.get(r.get("content_type", "track"), 2), -(r.get("view_count") or 0)))
    return all_results[:limit]


def _run_search(search_query: str, fallback_source: str) -> list[dict]:
    """Run a single yt-dlp search command and parse results."""
    try:
        is_url = search_query.startswith("http")
        cmd = [
            YTDLP_BIN,
            search_query,
            "--dump-json",
            *(["--flat-playlist"] if is_url else []),
            "--no-download",
            "--no-warnings",
            "--playlist-end", "25",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            log.debug("yt-dlp search failed: %s", r.stderr[:200])
            return []

        results = []
        for line in r.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                duration = data.get("duration")
                # Classify content type by duration
                content_type = "track"
                if duration and duration > 1200:  # > 20 min
                    content_type = "album"
                elif duration and duration > 600:  # > 10 min
                    content_type = "mix"

                # Extract best thumbnail
                thumbs = data.get("thumbnails") or []
                thumb = ""
                if thumbs:
                    # Prefer medium quality (not too large)
                    for t in thumbs:
                        if t.get("width", 0) >= 320:
                            thumb = t.get("url", "")
                            break
                    if not thumb:
                        thumb = thumbs[-1].get("url", "")

                results.append({
                    "id": data.get("id", ""),
                    "title": data.get("title", ""),
                    "url": data.get("webpage_url") or data.get("url") or f"https://www.youtube.com/watch?v={data.get('id', '')}",
                    "channel": data.get("channel") or data.get("uploader", ""),
                    "artist": data.get("artist") or data.get("creator", ""),
                    "album": data.get("album", ""),
                    "track": data.get("track", ""),
                    "duration": duration,
                    "thumbnail": thumb,
                    "view_count": data.get("view_count"),
                    "like_count": data.get("like_count"),
                    "source": _detect_source(data) or fallback_source,
                    "content_type": content_type,
                    "audio_ext": data.get("audio_ext") or data.get("ext", ""),
                })
            except json.JSONDecodeError:
                continue
        return results
    except subprocess.TimeoutExpired:
        log.warning("yt-dlp search timed out")
        return []
    except Exception:
        log.debug("yt-dlp search failed", exc_info=True)
        return []


def search_bandcamp(query: str, limit: int = 10) -> list[dict]:
    """Search Bandcamp specifically."""
    try:
        cmd = [
            YTDLP_BIN,
            f"bcsearch{limit}:{query}",
            "--dump-json",
            "--flat-playlist",
            "--no-download",
            "--no-warnings",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return []

        results = []
        for line in r.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                results.append({
                    "id": data.get("id", ""),
                    "title": data.get("title", ""),
                    "url": data.get("url") or data.get("webpage_url", ""),
                    "channel": data.get("uploader") or data.get("artist", ""),
                    "duration": data.get("duration"),
                    "thumbnail": data.get("thumbnail", ""),
                    "source": "bandcamp",
                })
            except json.JSONDecodeError:
                continue
        return results
    except Exception:
        log.debug("yt-dlp bandcamp search failed", exc_info=True)
        return []


def download(url: str, output_dir: str, quality: str = "best",
             progress_callback=None) -> dict:
    """Download audio from a URL using yt-dlp.

    Args:
        url: YouTube/Bandcamp/SoundCloud URL
        output_dir: Directory to save files
        quality: 'best', 'flac', 'mp3_320', 'mp3_192'
        progress_callback: Called with progress dict

    Returns dict with success, path, files, error.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    format_args = _quality_args(quality)

    cmd = [
        YTDLP_BIN,
        url,
        "-o", f"{output_dir}/%(artist,uploader,channel)s/%(album,playlist_title,title)s/%(track_number,playlist_index)02d. %(track,title)s.%(ext)s",
        "--extract-audio",
        "--embed-thumbnail",
        "--embed-metadata",
        "--no-playlist" if "watch?" in url else "--yes-playlist",
        "--no-warnings",
        "--progress",
        "--newline",
        *format_args,
    ]

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )

        files_done = 0
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            # Parse progress
            pct_match = re.search(r'(\d+\.?\d*)%', line)
            if pct_match and progress_callback:
                progress_callback({
                    "phase": "downloading",
                    "percent": float(pct_match.group(1)),
                    "files_done": files_done,
                })

            if "[ExtractAudio]" in line or "has already been downloaded" in line:
                files_done += 1
                if progress_callback:
                    progress_callback({"phase": "downloading", "files_done": files_done})

        proc.wait(timeout=3600)

        if proc.returncode != 0:
            return {"success": False, "error": f"yt-dlp exit code {proc.returncode}"}

        # Count downloaded files
        out_path = Path(output_dir)
        audio_exts = {".flac", ".mp3", ".m4a", ".opus", ".ogg", ".wav", ".webm"}
        downloaded = [f for f in out_path.rglob("*") if f.suffix.lower() in audio_exts]

        return {
            "success": True,
            "path": output_dir,
            "file_count": len(downloaded),
            "files": [str(f) for f in downloaded],
        }

    except subprocess.TimeoutExpired:
        proc.kill()
        return {"success": False, "error": "Download timed out (1h)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_info(url: str) -> dict | None:
    """Get metadata for a URL without downloading."""
    try:
        cmd = [YTDLP_BIN, url, "--dump-json", "--no-download", "--no-warnings"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout)
    except Exception:
        return None


def _quality_args(quality: str) -> list[str]:
    if quality == "flac":
        return ["--audio-format", "flac", "--audio-quality", "0"]
    elif quality == "mp3_320":
        return ["--audio-format", "mp3", "--audio-quality", "0"]
    elif quality == "mp3_192":
        return ["--audio-format", "mp3", "--audio-quality", "5"]
    else:  # best
        return ["--audio-format", "best", "--audio-quality", "0"]


def _detect_source(data: dict) -> str:
    url = data.get("webpage_url") or data.get("url") or ""
    if "bandcamp.com" in url:
        return "bandcamp"
    if "soundcloud.com" in url:
        return "soundcloud"
    if "music.youtube.com" in url:
        return "youtube_music"
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    extractor = data.get("extractor_key", "").lower()
    if "bandcamp" in extractor:
        return "bandcamp"
    if "soundcloud" in extractor:
        return "soundcloud"
    return ""
