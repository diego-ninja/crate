"""Tidal integration — search, download, auth via tiddl binary."""

import json
import logging
import os
import re
import subprocess
import shutil
import uuid
from pathlib import Path

import requests

from crate.db import get_setting, set_setting
from crate.storage_import import infer_album_identity, move_album_tree, resolve_import_album_target

log = logging.getLogger(__name__)

TIDDL_CONFIG_DIR = os.environ.get("TIDDL_CONFIG_DIR", "/data/.tiddl")
# tiddl 3.x uses ~/.tiddl — we set HOME to parent of .tiddl
TIDDL_HOME = str(Path(TIDDL_CONFIG_DIR).parent)
PROCESSING_DIR = "/tmp/tidal-processing"


# ── Auth ─────────────────────────────────────────────────────────

def get_auth_token() -> str | None:
    """Read Tidal auth token from tiddl's auth.json."""
    auth_file = Path(TIDDL_CONFIG_DIR) / "auth.json"
    if not auth_file.exists():
        return None
    try:
        data = json.loads(auth_file.read_text())
        return data.get("token")
    except (json.JSONDecodeError, OSError) as e:
        log.debug("Failed to read tiddl auth: %s", e)
        return None


def is_authenticated() -> bool:
    return get_auth_token() is not None


def ensure_auth() -> bool:
    """Verify Tidal auth is valid, refreshing if needed. Returns True if authenticated."""
    token = get_auth_token()
    if not token:
        return False
    try:
        resp = requests.get(
            "https://api.tidal.com/v2/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"query": "test", "type": "ARTISTS", "limit": 1, "countryCode": "US"},
            timeout=5,
        )
        if resp.status_code == 401:
            return refresh_token()
        return resp.status_code == 200
    except Exception:
        return True  # network error, don't block — tiddl will handle it


def refresh_token() -> bool:
    """Refresh Tidal auth token."""
    try:
        result = subprocess.run(
            ["tiddl", "auth", "refresh"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "HOME": TIDDL_HOME},
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, OSError) as e:
        log.warning("Failed to refresh Tidal token: %s", e)
        return False


def login_flow():
    """Start tiddl auth login and yield stdout lines (for SSE streaming).
    The user needs to visit tidal.com/activate and enter the device code."""
    try:
        proc = subprocess.Popen(
            ["tiddl", "auth", "login"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "HOME": TIDDL_HOME},
        )
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                yield line
        proc.wait(timeout=300)
        if proc.returncode == 0:
            yield "AUTH_SUCCESS"
        else:
            yield "AUTH_FAILED"
    except subprocess.TimeoutExpired:
        proc.kill()
        yield "AUTH_TIMEOUT"
    except Exception as e:
        yield f"AUTH_ERROR: {e}"


def logout() -> bool:
    """Remove Tidal auth token."""
    try:
        result = subprocess.run(
            ["tiddl", "auth", "logout"],
            capture_output=True, text=True, timeout=10,
            env={**os.environ, "HOME": TIDDL_HOME},
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def get_album_track_count(album_id: str) -> int | None:
    """Get expected track count for a Tidal album."""
    token = get_auth_token()
    if not token:
        return None
    try:
        resp = requests.get(
            f"https://api.tidal.com/v2/albums/{album_id}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={"countryCode": get_setting("tidal_country", "US")},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("numberOfTracks")
    except Exception:
        pass
    return None


def get_artist_albums(artist_id: str, limit: int = 50, _retried: bool = False) -> list[dict]:
    """Get albums for a Tidal artist by ID (uses v1 API)."""
    token = get_auth_token()
    if not token:
        return []
    try:
        resp = requests.get(
            f"https://api.tidal.com/v1/artists/{artist_id}/albums",
            headers={"Authorization": f"Bearer {token}"},
            params={"countryCode": get_setting("tidal_country", "US"), "limit": limit, "offset": 0},
            timeout=10,
        )
        if resp.status_code == 401:
            if not _retried and refresh_token():
                return get_artist_albums(artist_id, limit, _retried=True)
            return []
        if resp.status_code != 200:
            return []
        data = resp.json()
        items = data.get("items", []) if isinstance(data, dict) else data if isinstance(data, list) else []

        def _artist_name(a: dict) -> str:
            artist = a.get("artist")
            if isinstance(artist, dict):
                return artist.get("name", "")
            artists = a.get("artists")
            if isinstance(artists, list) and artists:
                return artists[0].get("name", "")
            return ""

        return [
            {
                "id": str(a.get("id", "")),
                "title": a.get("title", ""),
                "artist": _artist_name(a),
                "year": (a.get("releaseDate") or "")[:4],
                "tracks": a.get("numberOfTracks", 0),
                "cover": _tidal_cover(a.get("cover")),
                "url": f"https://tidal.com/album/{a.get('id', '')}",
                "quality": a.get("mediaMetadata", {}).get("tags", []),
                "duration": a.get("duration", 0),
                "release_date": a.get("releaseDate", ""),
                "type": a.get("type", "ALBUM"),
            }
            for a in items
        ]
    except Exception as e:
        log.warning("Failed to fetch artist albums: %s", e)
        return []


def get_album_tracks(album_id: str, _retried: bool = False) -> list[dict]:
    """Get tracks for a Tidal album by ID (uses v1 API)."""
    token = get_auth_token()
    if not token:
        return []
    try:
        resp = requests.get(
            f"https://api.tidal.com/v1/albums/{album_id}/tracks",
            headers={"Authorization": f"Bearer {token}"},
            params={"countryCode": get_setting("tidal_country", "US"), "limit": 100, "offset": 0},
            timeout=10,
        )
        if resp.status_code == 401:
            if not _retried and refresh_token():
                return get_album_tracks(album_id, _retried=True)
            return []
        if resp.status_code != 200:
            return []
        data = resp.json()
        items = data.get("items", []) if isinstance(data, dict) else data if isinstance(data, list) else []

        def _artist_name(t: dict) -> str:
            artist = t.get("artist")
            if isinstance(artist, dict):
                return artist.get("name", "")
            artists = t.get("artists")
            if isinstance(artists, list) and artists:
                return artists[0].get("name", "")
            return ""

        return [
            {
                "id": str(t.get("id", "")),
                "title": t.get("title", ""),
                "artist": _artist_name(t),
                "track_number": t.get("trackNumber", 0),
                "duration": t.get("duration", 0),
                "url": f"https://tidal.com/track/{t.get('id', '')}",
                "quality": t.get("mediaMetadata", {}).get("tags", []),
            }
            for t in items
        ]
    except Exception as e:
        log.warning("Failed to fetch album tracks: %s", e)
        return []


# ── Search ───────────────────────────────────────────────────────

def search(query: str, content_type: str = "all", limit: int = 20, offset: int = 0, _retried: bool = False) -> dict:
    """Search Tidal API. Returns albums, artists, tracks."""
    token = get_auth_token()
    if not token:
        return {"error": "Not authenticated with Tidal"}

    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }

        types = {
            "all": "ALBUMS,ARTISTS,TRACKS",
            "albums": "ALBUMS",
            "artists": "ARTISTS",
            "tracks": "TRACKS",
        }

        resp = requests.get(
            "https://api.tidal.com/v2/search",
            headers=headers,
            params={
                "query": query,
                "type": types.get(content_type, "ALBUMS,ARTISTS,TRACKS"),
                "limit": limit,
                "offset": offset,
                "countryCode": get_setting("tidal_country", "US"),
            },
            timeout=10,
        )

        if resp.status_code == 401:
            if not _retried and refresh_token():
                return search(query, content_type, limit, offset, _retried=True)
            return {"error": "Tidal auth expired"}

        resp.raise_for_status()
        data = resp.json()

        result: dict = {}

        # v2 search returns {albums: {items: [...]}, artists: {items: [...]}, ...}
        def _items(key: str) -> list:
            val = data.get(key, {})
            if isinstance(val, dict):
                return val.get("items", [])
            if isinstance(val, list):
                return val
            return []

        # Parse albums
        albums_raw = _items("albums")
        if albums_raw:
            result["albums"] = [
                {
                    "id": str(a.get("id", "")),
                    "title": a.get("title", ""),
                    "artist": a.get("artists", [{}])[0].get("name", "") if a.get("artists") else "",
                    "year": (a.get("releaseDate") or "")[:4],
                    "tracks": a.get("numberOfTracks", 0),
                    "cover": _tidal_cover(a.get("cover")),
                    "url": a.get("url") or f"https://tidal.com/album/{a.get('id', '')}",
                    "quality": a.get("mediaMetadata", {}).get("tags", []),
                }
                for a in albums_raw
            ]

        # Parse artists
        artists_raw = _items("artists")
        if artists_raw:
            result["artists"] = [
                {
                    "id": str(a.get("id", "")),
                    "name": a.get("name", ""),
                    "picture": _tidal_cover(a.get("picture")),
                }
                for a in artists_raw
            ]

        # Parse tracks
        tracks_raw = _items("tracks")
        if tracks_raw:
            result["tracks"] = [
                {
                    "id": str(t.get("id", "")),
                    "title": t.get("title", ""),
                    "artist": t.get("artists", [{}])[0].get("name", "") if t.get("artists") else "",
                    "album": t.get("album", {}).get("title", "") if isinstance(t.get("album"), dict) else "",
                    "duration": t.get("duration", 0),
                    "url": t.get("url") or f"https://tidal.com/track/{t.get('id', '')}",
                    "quality": t.get("mediaMetadata", {}).get("tags", []),
                }
                for t in tracks_raw
            ]

        return result

    except requests.exceptions.HTTPError as e:
        log.warning("Tidal search failed: %s", e)
        return {"error": f"Tidal API error: {e.response.status_code if e.response else 'unknown'}"}
    except Exception as e:
        log.warning("Tidal search failed: %s", e)
        return {"error": str(e)}


def _tidal_cover(cover_id: str | None) -> str | None:
    """Convert Tidal cover UUID to image URL."""
    if not cover_id:
        return None
    # Tidal image URL format: replace - with / in UUID
    clean = cover_id.replace("-", "/")
    return f"https://resources.tidal.com/images/{clean}/750x750.jpg"


def _normalize_library_segment_key(name: str) -> str:
    return re.sub(r"^[.\s]+", "", (name or "").strip()).casefold()


def _safe_library_segment(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[.\s]+", "", cleaned)
    cleaned = cleaned.rstrip(" .")
    return cleaned or "Unknown"


def _resolve_child_dir_name(parent: Path, raw_name: str) -> str:
    safe_name = _safe_library_segment(raw_name)
    existing_dirs = [d.name for d in parent.iterdir() if d.is_dir()] if parent.exists() else []
    if existing_dirs:
        normalized_matches = [
            name for name in existing_dirs if _normalize_library_segment_key(name) == _normalize_library_segment_key(raw_name)
        ]
        visible_matches = [name for name in normalized_matches if not name.startswith(".")]
        if visible_matches:
            return visible_matches[0]
        if normalized_matches:
            return normalized_matches[0]
    return safe_name


# ── Download ─────────────────────────────────────────────────────

def download(url: str, quality: str = "max", task_id: str = "",
             progress_callback=None) -> dict:
    """Download a Tidal URL (album, track, playlist) via tiddl.

    Returns {success, path, files, error}
    """
    processing_dir = Path(PROCESSING_DIR) / task_id
    processing_dir.mkdir(parents=True, exist_ok=True)

    quality_map = {"low": "low", "normal": "normal", "high": "high", "max": "max", "lossless": "max"}
    q = quality_map.get(quality, "max")

    cmd = [
        "tiddl", "download",
        "--path", str(processing_dir),
        "-q", q,
        "url", url,
    ]

    log.info("Tidal download: %s (quality=%s)", url, q)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "HOME": TIDDL_HOME},
        )

        output_lines = []
        tracks_downloaded = 0
        total_tracks = 0
        for line in proc.stdout:
            line = line.rstrip()
            output_lines.append(line)
            if progress_callback:
                # tiddl outputs: "Downloaded <TrackName>  <quality> <path>"
                dl_match = re.match(r"Downloaded\s+(.+?)\s{2,}\d+", line)
                if dl_match:
                    tracks_downloaded += 1
                    track_name = dl_match.group(1).strip()
                    progress_callback({
                        "phase": "downloading",
                        "done": tracks_downloaded,
                        "total": total_tracks or None,
                        "track": track_name,
                        "line": line,
                    })
                # "Total downloads: N"
                elif line.startswith("Total downloads:"):
                    total_match = re.search(r"Total downloads:\s*(\d+)", line)
                    if total_match:
                        total_tracks = int(total_match.group(1))
                        progress_callback({
                            "phase": "downloading",
                            "done": tracks_downloaded,
                            "total": total_tracks,
                            "line": line,
                        })
                # N/M pattern (older tiddl versions)
                else:
                    nm_match = re.search(r"(\d+)/(\d+)", line)
                    if nm_match:
                        progress_callback({
                            "phase": "downloading",
                            "done": int(nm_match.group(1)),
                            "total": int(nm_match.group(2)),
                            "line": line,
                        })
                    elif line and not line.startswith("Auth token"):
                        progress_callback({"phase": "downloading", "line": line})

        proc.wait(timeout=3600)

        files = []
        for f in processing_dir.rglob("*"):
            if f.is_file():
                files.append(str(f.relative_to(processing_dir)))

        audio_exts = {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aac'}
        audio_files = [f for f in files if Path(f).suffix.lower() in audio_exts]

        if proc.returncode != 0:
            error_tail = "\n".join(output_lines[-10:])
            if files:
                log.warning(
                    "tiddl download returned non-zero for %s but produced %d files: %s",
                    url,
                    len(files),
                    error_tail,
                )
                return {
                    "success": True,
                    "path": str(processing_dir),
                    "files": files,
                    "file_count": len(files),
                    "audio_file_count": len(audio_files),
                    "partial": True,
                    "warning": error_tail,
                }
            log.warning("tiddl download failed for %s: %s", url, error_tail)
            return {
                "success": False,
                "error": error_tail,
                "path": str(processing_dir),
            }

        return {
            "success": True,
            "path": str(processing_dir),
            "files": files,
            "file_count": len(files),
            "audio_file_count": len(audio_files),
        }

    except subprocess.TimeoutExpired:
        proc.kill()
        return {"success": False, "error": "Download timed out (1h)", "path": str(processing_dir)}
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(processing_dir)}


def move_to_library(processing_path: str, library_path: str) -> list[str]:
    """Move downloaded files from processing dir to library.

    Returns list of artist directories that were modified.

    Implementation notes:

    - All three nested directory listings are materialized to lists before
      the inner loop runs. Previously we iterated Path.iterdir() directly
      and mutated the directory from inside the loop via shutil.move()
      which, on ext4, can cause readdir() to yield stale or duplicate
      entries, leading to a FileNotFoundError on either the source
      (already moved) or the destination (half-written).
    - Each file move is wrapped in its own try/except so a single bad
      file doesn't abort the whole batch. The caller gets the list of
      artists we touched even when some files failed.
    """
    src = Path(processing_path)
    dst = Path(library_path)
    modified_artists: set[str] = set()

    if not src.exists():
        return []

    for item in sorted(src.iterdir()):
        if not item.is_dir():
            continue
        # item is an "ArtistName" directory.
        album_items = [d for d in sorted(item.iterdir())]
        for album_item in album_items:
            if album_item.is_dir():
                artist_name, album_name = infer_album_identity(album_item, fallback_artist=item.name)
                _, target_album_dir, managed_track_names = resolve_import_album_target(dst, artist_name, album_name)
                try:
                    move_album_tree(album_item, target_album_dir, managed_track_names=managed_track_names)
                    modified_artists.add(artist_name)
                except Exception:
                    log.warning(
                        "move_to_library: failed to import %s for %s / %s",
                        album_item,
                        artist_name,
                        album_name,
                        exc_info=True,
                    )
            elif album_item.is_file():
                artist_name, album_name = infer_album_identity(item, fallback_artist=item.name)
                _, target_album_dir, managed_track_names = resolve_import_album_target(dst, artist_name, album_name)
                target_album_dir.mkdir(parents=True, exist_ok=True)
                dest_file = (
                    target_album_dir / f"{uuid.uuid4()}{album_item.suffix.lower()}"
                    if managed_track_names
                    else target_album_dir / album_item.name
                )
                try:
                    if dest_file.exists():
                        dest_file.unlink()
                    shutil.move(str(album_item), str(dest_file))
                    modified_artists.add(artist_name)
                except Exception:
                    log.warning(
                        "move_to_library: failed to move file %s -> %s",
                        album_item,
                        dest_file,
                        exc_info=True,
                    )
        try:
            item.rmdir()
        except OSError:
            pass

    # Clean up processing dir (best-effort — it may still contain files
    # we couldn't move, and those will be cleaned on retry / manually).
    shutil.rmtree(str(src), ignore_errors=True)

    return list(modified_artists)
