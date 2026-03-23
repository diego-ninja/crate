"""Soulseek client via slskd REST API."""

import os
import re
import time
import logging
import requests

from musicdock.db import get_setting

log = logging.getLogger(__name__)


def _base_url() -> str:
    return get_setting("slskd_url", os.environ.get("SLSKD_URL", "http://slskd:5030"))


def _api_key() -> str | None:
    return get_setting("slskd_api_key", os.environ.get("SLSKD_API_KEY", ""))


def _get(endpoint: str, params: dict | None = None) -> dict | list | None:
    url = f"{_base_url()}/api/v0/{endpoint}"
    headers = {}
    key = _api_key()
    if key:
        headers["X-API-Key"] = key
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.debug("slskd GET %s failed: %s", endpoint, e)
        return None


def _post(endpoint: str, body=None) -> dict | list | None:
    url = f"{_base_url()}/api/v0/{endpoint}"
    headers = {"Content-Type": "application/json"}
    key = _api_key()
    if key:
        headers["X-API-Key"] = key
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.debug("slskd POST %s failed: %s", endpoint, e)
        return None


def get_status() -> dict:
    """Get slskd connection status."""
    data = _get("application")
    if not data:
        return {"connected": False, "loggedIn": False}
    server = data.get("server", {})
    return {
        "connected": server.get("isConnected", False),
        "loggedIn": server.get("isLoggedIn", False),
        "state": server.get("state", "Unknown"),
        "version": data.get("version", {}).get("current", "?"),
    }


def search(query: str, timeout_sec: int = 15) -> dict:
    """Search Soulseek. Returns search ID + results after waiting."""
    result = _post("searches", {"searchText": query})
    if not result or "id" not in result:
        return {"id": None, "responses": [], "fileCount": 0}

    search_id = result["id"]

    # Poll for completion
    elapsed = 0
    while elapsed < timeout_sec:
        time.sleep(2)
        elapsed += 2
        status = _get(f"searches/{search_id}")
        if status and "Completed" in status.get("state", ""):
            break

    # Get responses
    responses = _get(f"searches/{search_id}/responses") or []
    return {
        "id": search_id,
        "responses": responses,
        "responseCount": len(responses),
        "fileCount": sum(len(r.get("files", [])) for r in responses),
    }


def search_album(artist: str, album: str, quality_filter: str = "flac") -> list[dict]:
    """Search for a specific album. Returns grouped results by user, filtered by quality.

    quality_filter: "flac", "flac_320", "any"
    """
    query = f"{artist} {album}"

    # Add quality to query if filtering
    if quality_filter == "flac":
        query += " FLAC"

    raw = search(query)
    responses = raw.get("responses", [])

    min_bitrate = int(get_setting("soulseek_min_bitrate", "320"))

    results = []
    for resp in responses:
        username = resp.get("username", "")
        speed = resp.get("uploadSpeed", 0)
        free_slot = resp.get("hasFreeUploadSlot", False)
        files = resp.get("files", [])

        # Filter by quality
        filtered_files = []
        for f in files:
            ext = f.get("extension", "").lower()
            filename = f.get("filename", "")

            if quality_filter == "flac" and ext != "flac":
                continue
            elif quality_filter == "flac_320":
                if ext == "flac":
                    pass  # OK
                elif ext == "mp3" and (f.get("bitRate", 0) or 0) >= min_bitrate:
                    pass  # OK
                else:
                    continue
            # "any" accepts everything

            filtered_files.append({
                "filename": filename,
                "size": f.get("size", 0),
                "length": f.get("length", 0),
                "extension": ext,
                "bitDepth": f.get("bitDepth"),
                "sampleRate": f.get("sampleRate"),
                "bitRate": f.get("bitRate"),
            })

        if not filtered_files:
            continue

        # Try to detect album grouping from file paths
        albums_in_response = _group_files_by_album(filtered_files)

        for album_group in albums_in_response:
            results.append({
                "username": username,
                "speed": speed,
                "freeSlot": free_slot,
                "album": album_group["album"],
                "artist": album_group["artist"],
                "files": album_group["files"],
                "quality": _detect_quality(album_group["files"]),
                "totalSize": sum(f["size"] for f in album_group["files"]),
            })

    # Sort by quality score desc, then speed desc
    results.sort(key=lambda r: (_quality_score(r["quality"]), r["speed"]), reverse=True)
    return results


def _group_files_by_album(files: list[dict]) -> list[dict]:
    """Group files by their parent directory (album folder)."""
    groups: dict[str, list[dict]] = {}
    for f in files:
        path = f["filename"].replace("\\", "/")
        parts = path.rsplit("/", 1)
        folder = parts[0] if len(parts) > 1 else "Unknown"
        groups.setdefault(folder, []).append(f)

    result = []
    for folder, group_files in groups.items():
        # Parse artist/album from folder path
        parts = folder.replace("\\", "/").split("/")
        album_name = parts[-1] if parts else "Unknown"
        artist_name = parts[-2] if len(parts) >= 2 else "Unknown"
        # Strip year prefix from album
        album_name = re.sub(r"^\d{4}\s*[-–]\s*", "", album_name)
        # Strip common suffixes like [FLAC], (FLAC), etc.
        album_name = re.sub(r"\s*[\[\(](?:FLAC|flac|MP3|320|V0|16bit|24bit|44\.1|96).*?[\]\)]", "", album_name).strip()

        result.append({
            "album": album_name,
            "artist": artist_name,
            "folder": folder,
            "files": sorted(group_files, key=lambda f: f["filename"]),
        })
    return result


def _detect_quality(files: list[dict]) -> str:
    """Detect quality label from files."""
    exts = set(f.get("extension", "").lower() for f in files)
    if "flac" in exts:
        depths = [f.get("bitDepth") for f in files if f.get("bitDepth")]
        rates = [f.get("sampleRate") for f in files if f.get("sampleRate")]
        depth = max(depths) if depths else 16
        rate = max(rates) if rates else 44100
        return f"FLAC {depth}/{rate // 1000}kHz"
    elif "mp3" in exts:
        bitrates = [f.get("bitRate", 0) for f in files if f.get("bitRate")]
        avg_br = sum(bitrates) // len(bitrates) if bitrates else 0
        return f"MP3 {avg_br}kbps"
    return "Unknown"


def _quality_score(quality: str) -> int:
    """Score quality for sorting. Higher = better."""
    q = quality.lower()
    if "flac 24" in q: return 100
    if "flac" in q: return 80
    if "320" in q: return 60
    if "256" in q: return 40
    if "mp3" in q: return 20
    return 10


def download_files(username: str, files: list[dict]) -> dict:
    """Queue files for download from a user.
    files: [{"filename": "...", "size": ...}, ...]
    """
    payload = [{"filename": f["filename"], "size": f.get("size", 0)} for f in files]
    result = _post(f"transfers/downloads/{username}", payload)
    if not result:
        return {"enqueued": [], "failed": []}
    return result


def get_downloads() -> list[dict]:
    """Get all current downloads."""
    data = _get("transfers/downloads") or []
    result = []
    for user_group in data:
        username = user_group.get("username", "")
        for directory in user_group.get("directories", []):
            dir_name = directory.get("directory", "")
            for f in directory.get("files", []):
                result.append({
                    "username": username,
                    "directory": dir_name,
                    "filename": f.get("filename", "").replace("\\", "/").split("/")[-1],
                    "fullPath": f.get("filename", ""),
                    "size": f.get("size", 0),
                    "bytesTransferred": f.get("bytesTransferred", 0),
                    "percentComplete": f.get("percentComplete", 0),
                    "state": f.get("state", ""),
                    "averageSpeed": f.get("averageSpeed", 0),
                    "source": "soulseek",
                })
    return result
