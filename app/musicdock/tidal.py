"""Tidal integration — search, download, auth via tiddl binary."""

import json
import logging
import os
import subprocess
import shutil
from pathlib import Path

import requests

from musicdock.db import get_setting, set_setting

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


# ── Search ───────────────────────────────────────────────────────

def search(query: str, content_type: str = "all", limit: int = 20, offset: int = 0) -> dict:
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
            # Try refresh
            if refresh_token():
                return search(query, content_type, limit, offset)
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
        "--skip-errors",
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
        for line in proc.stdout:
            line = line.rstrip()
            output_lines.append(line)
            if progress_callback:
                # Parse progress: "X/Y" pattern
                import re
                match = re.search(r"(\d+)/(\d+)", line)
                if match:
                    progress_callback({
                        "phase": "downloading",
                        "done": int(match.group(1)),
                        "total": int(match.group(2)),
                        "line": line,
                    })
                else:
                    progress_callback({"phase": "downloading", "line": line})

        proc.wait(timeout=3600)

        if proc.returncode != 0:
            return {
                "success": False,
                "error": "\n".join(output_lines[-10:]),
                "path": str(processing_dir),
            }

        # Collect downloaded files
        files = []
        for f in processing_dir.rglob("*"):
            if f.is_file():
                files.append(str(f.relative_to(processing_dir)))

        return {
            "success": True,
            "path": str(processing_dir),
            "files": files,
            "file_count": len(files),
        }

    except subprocess.TimeoutExpired:
        proc.kill()
        return {"success": False, "error": "Download timed out (1h)", "path": str(processing_dir)}
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(processing_dir)}


def move_to_library(processing_path: str, library_path: str) -> list[str]:
    """Move downloaded files from processing dir to library.
    Returns list of artist directories that were modified."""
    src = Path(processing_path)
    dst = Path(library_path)
    modified_artists = set()

    if not src.exists():
        return []

    for item in src.iterdir():
        if item.is_dir():
            # item is likely "ArtistName" directory
            dest_dir = dst / item.name
            if dest_dir.exists():
                # Merge: move album subdirs
                for album_dir in item.iterdir():
                    if album_dir.is_dir():
                        final = dest_dir / album_dir.name
                        if final.exists():
                            shutil.rmtree(str(final))
                        shutil.move(str(album_dir), str(final))
            else:
                shutil.move(str(item), str(dest_dir))
            modified_artists.add(item.name)

    # Clean up processing dir
    shutil.rmtree(str(src), ignore_errors=True)

    return list(modified_artists)
