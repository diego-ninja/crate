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
    except Exception:
        return None


def is_authenticated() -> bool:
    return get_auth_token() is not None


def refresh_token() -> bool:
    """Refresh Tidal auth token."""
    try:
        result = subprocess.run(
            ["tiddl", "auth", "refresh"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "TIDDL_CONFIG_DIR": TIDDL_CONFIG_DIR},
        )
        return result.returncode == 0
    except Exception:
        log.warning("Failed to refresh Tidal token", exc_info=True)
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

        # Parse albums
        if "albums" in data:
            result["albums"] = [
                {
                    "id": a["resource"]["id"],
                    "title": a["resource"].get("title", ""),
                    "artist": a["resource"].get("artists", [{}])[0].get("name", "") if a["resource"].get("artists") else "",
                    "year": (a["resource"].get("releaseDate") or "")[:4],
                    "tracks": a["resource"].get("numberOfTracks", 0),
                    "cover": _cover_url(a["resource"].get("imageCover", [])),
                    "url": f"https://tidal.com/album/{a['resource']['id']}",
                    "quality": a["resource"].get("mediaMetadata", {}).get("tags", []),
                }
                for a in data["albums"]
            ]

        # Parse artists
        if "artists" in data:
            result["artists"] = [
                {
                    "id": a["resource"]["id"],
                    "name": a["resource"].get("name", ""),
                    "picture": _cover_url(a["resource"].get("picture", [])),
                }
                for a in data["artists"]
            ]

        # Parse tracks
        if "tracks" in data:
            result["tracks"] = [
                {
                    "id": t["resource"]["id"],
                    "title": t["resource"].get("title", ""),
                    "artist": t["resource"].get("artists", [{}])[0].get("name", "") if t["resource"].get("artists") else "",
                    "album": t["resource"].get("album", {}).get("title", ""),
                    "duration": t["resource"].get("duration", 0),
                    "url": f"https://tidal.com/track/{t['resource']['id']}",
                    "quality": t["resource"].get("mediaMetadata", {}).get("tags", []),
                }
                for t in data["tracks"]
            ]

        return result

    except requests.exceptions.HTTPError as e:
        log.warning("Tidal search failed: %s", e)
        return {"error": f"Tidal API error: {e.response.status_code if e.response else 'unknown'}"}
    except Exception as e:
        log.warning("Tidal search failed: %s", e)
        return {"error": str(e)}


def _cover_url(images: list) -> str | None:
    """Extract best cover URL from Tidal image array."""
    if not images:
        return None
    # Prefer larger images
    for img in sorted(images, key=lambda x: x.get("width", 0), reverse=True):
        if img.get("url"):
            return img["url"]
    return None


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
            env={**os.environ, "TIDDL_CONFIG_DIR": TIDDL_CONFIG_DIR},
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
