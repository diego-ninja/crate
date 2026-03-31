import base64
import io as _io
import json
import logging
import time
from pathlib import Path
from typing import Callable

from crate.db import emit_task_event, get_db_ctx, get_task, set_cache, update_task

log = logging.getLogger(__name__)

TaskHandler = Callable[[str, dict, dict], dict]
DEFAULT_AUDIO_EXTENSIONS = [".flac", ".mp3", ".m4a", ".ogg", ".opus"]


def _is_cancelled(task_id: str) -> bool:
    """Check if a task has been cancelled (reads from DB)."""
    try:
        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


def _audio_extensions(config: dict) -> set[str]:
    return set(config.get("audio_extensions", DEFAULT_AUDIO_EXTENSIONS))


def _handle_fetch_artwork_all(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover, scan_missing_covers

    lib = Path(config["library_path"])
    missing = scan_missing_covers(lib, _audio_extensions(config))

    fetched = 0
    failed = 0
    total = len(missing)

    for i, album in enumerate(missing):
        if _is_cancelled(task_id):
            break
        mbid = album.get("mbid")
        if not mbid:
            continue
        update_task(task_id, progress=f"Fetching {i + 1}/{total}...")
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    return {"fetched": fetched, "failed": failed, "total": total}


def _handle_batch_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    lib = Path(config["library_path"])
    albums = params.get("albums", [])
    results = []

    for i, item in enumerate(albums):
        if _is_cancelled(task_id):
            break
        mbid = item.get("mbid")
        path = item.get("path")
        update_task(task_id, progress=f"Fetching cover {i + 1}/{len(albums)}")

        if not mbid:
            results.append({"path": path, "error": "No MBID"})
            continue

        album_dir = lib / path
        if not album_dir.is_dir():
            results.append({"path": path, "error": "Not found"})
            continue

        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            results.append({"path": path, "status": "fetched"})
        else:
            results.append({"path": path, "error": "Not found on CAA"})

    return {"results": results}


def _handle_fetch_cover(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    mbid = params.get("mbid")
    path = params.get("path")
    if not mbid:
        return {"error": "No MBID"}

    lib = Path(config["library_path"])
    album_dir = lib / path if path else None

    image = fetch_cover_from_caa(mbid)
    if not image:
        return {"error": "No cover found on CAA"}

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        return {"status": "saved", "path": str(album_dir / "cover.jpg")}

    return {"error": "Album directory not found"}


def _handle_fetch_artist_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.audio import read_tags as _read_tags
    from crate.audio import get_audio_files
    from crate.artwork import fetch_cover_from_caa, save_cover

    artist_name = params.get("artist", "")
    lib = Path(config["library_path"])
    artist_dir = lib / artist_name
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    if not artist_dir.is_dir():
        return {"error": "Artist not found"}

    fetched = failed = skipped = total = 0
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        total += 1
        if (album_dir / "cover.jpg").exists():
            skipped += 1
            continue
        tracks = get_audio_files(album_dir, exts)
        if not tracks:
            skipped += 1
            continue
        tags = _read_tags(tracks[0])
        mbid = tags.get("musicbrainz_albumid")
        if not mbid:
            skipped += 1
            continue
        update_task(task_id, progress=json.dumps({"album": album_dir.name, "done": total}))
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            fetched += 1
        else:
            failed += 1

    return {"fetched": fetched, "failed": failed, "skipped": skipped, "total": total}


def _fetch_deezer_cover(artist: str, album: str) -> bytes | None:
    try:
        import requests as _requests

        resp = _requests.get(
            "https://api.deezer.com/search/album",
            params={"q": f"{artist} {album}", "limit": 5},
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        for item in resp.json().get("data", []):
            if item.get("cover_xl"):
                img_resp = _requests.get(item["cover_xl"], timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _fetch_itunes_cover(artist: str, album: str) -> bytes | None:
    try:
        import requests as _requests

        resp = _requests.get(
            "https://itunes.apple.com/search",
            params={
                "term": f"{artist} {album}",
                "media": "music",
                "entity": "album",
                "limit": 5,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        for item in resp.json().get("results", []):
            art_url = item.get("artworkUrl100", "").replace("100x100", "600x600")
            if art_url:
                img_resp = _requests.get(art_url, timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _fetch_lastfm_cover(artist: str, album: str) -> bytes | None:
    try:
        from crate.popularity import _lastfm_get
        import requests as _requests

        data = _lastfm_get("album.getinfo", artist=artist, album=album, autocorrect="1")
        if not data or "album" not in data:
            return None
        images = data["album"].get("image", [])
        for img in reversed(images):
            url = img.get("#text", "")
            if url and "noimage" not in url:
                img_resp = _requests.get(url, timeout=10)
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    return img_resp.content
    except Exception:
        return None
    return None


def _search_musicbrainz_cover(artist: str, album: str) -> bytes | None:
    try:
        import musicbrainzngs
        from crate.artwork import fetch_cover_from_caa

        results = musicbrainzngs.search_releases(artist=artist, release=album, limit=3)
        for release in results.get("release-list", []):
            found_mbid = release.get("id")
            if found_mbid:
                caa_data = fetch_cover_from_caa(found_mbid)
                if caa_data:
                    return caa_data
            time.sleep(0.5)
    except Exception:
        return None
    return None


def _handle_scan_missing_covers(task_id: str, params: dict, config: dict) -> dict:
    """Scan for missing covers, search sources, emit events for each find."""
    from crate.artwork import extract_embedded_cover, fetch_cover_from_caa, save_cover, scan_missing_covers

    lib = Path(config["library_path"])

    update_task(task_id, progress=json.dumps({"phase": "scanning"}))
    emit_task_event(task_id, "info", {"message": "Scanning library for missing covers..."})
    missing = scan_missing_covers(lib, _audio_extensions(config))

    emit_task_event(
        task_id,
        "info",
        {"message": f"Found {len(missing)} albums without covers", "total": len(missing)},
    )

    found = 0
    not_found = 0

    for i, album in enumerate(missing):
        if _is_cancelled(task_id):
            break

        artist = album["artist"]
        album_name = album["album"]
        mbid = album.get("mbid")
        album_path = album["path"]

        update_task(
            task_id,
            progress=json.dumps(
                {
                    "phase": "searching",
                    "artist": artist,
                    "album": album_name,
                    "done": i,
                    "total": len(missing),
                    "found": found,
                }
            ),
        )

        cover_data = None
        source = None

        if mbid and mbid.strip():
            cover_data = fetch_cover_from_caa(mbid)
            if cover_data:
                source = "coverartarchive"

        if not cover_data:
            audio_files = list(Path(album_path).glob("*.flac")) + list(Path(album_path).glob("*.mp3"))
            for audio_file in audio_files[:1]:
                embedded = extract_embedded_cover(audio_file)
                if embedded:
                    cover_data = embedded
                    source = "embedded"
                    break

        if not cover_data:
            cover_data = _fetch_deezer_cover(artist, album_name)
            if cover_data:
                source = "deezer"

        if not cover_data:
            cover_data = _fetch_itunes_cover(artist, album_name)
            if cover_data:
                source = "itunes"

        if not cover_data:
            cover_data = _fetch_lastfm_cover(artist, album_name)
            if cover_data:
                source = "lastfm"

        if not cover_data and not (mbid and mbid.strip()):
            cover_data = _search_musicbrainz_cover(artist, album_name)
            if cover_data:
                source = "coverartarchive"

        if cover_data:
            found += 1
            emit_task_event(
                task_id,
                "cover_found",
                {
                    "message": f"Cover found: {artist} / {album_name} ({source})",
                    "artist": artist,
                    "album": album_name,
                    "path": album_path,
                    "source": source,
                    "size": len(cover_data),
                    "index": i,
                },
            )
            set_cache(
                f"pending_cover:{task_id}:{i}",
                {
                    "artist": artist,
                    "album": album_name,
                    "path": album_path,
                    "source": source,
                    "applied": False,
                },
            )
            if params.get("auto_apply"):
                save_cover(Path(album_path), cover_data)
                emit_task_event(
                    task_id,
                    "cover_applied",
                    {
                        "message": f"Cover applied: {artist} / {album_name}",
                        "artist": artist,
                        "album": album_name,
                        "source": source,
                    },
                )
        else:
            not_found += 1
            emit_task_event(
                task_id,
                "info",
                {
                    "message": f"No cover found for {artist} / {album_name}",
                    "artist": artist,
                    "album": album_name,
                },
            )

        time.sleep(0.3)

    return {"total_missing": len(missing), "found": found, "not_found": not_found}


def _handle_apply_cover(task_id: str, params: dict, config: dict) -> dict:
    """Apply a found cover to an album."""
    from crate.artwork import fetch_cover_from_caa, save_cover

    album_path = params.get("path", "")
    source = params.get("source", "")
    mbid = params.get("mbid", "")

    if not album_path:
        return {"error": "No album path"}

    album_dir = Path(album_path)
    if not album_dir.is_dir():
        return {"error": "Album directory not found"}

    cover_data = None

    if source == "coverartarchive" and mbid:
        cover_data = fetch_cover_from_caa(mbid)
    elif source == "deezer":
        artist = params.get("artist", "")
        album = params.get("album", "")
        try:
            import requests as _requests

            resp = _requests.get(
                "https://api.deezer.com/search/album",
                params={"q": f"{artist} {album}", "limit": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                if data and data[0].get("cover_xl"):
                    img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                    if img_resp.status_code == 200:
                        cover_data = img_resp.content
        except Exception:
            pass

    if not cover_data:
        return {"error": "Failed to fetch cover"}

    save_cover(album_dir, cover_data)
    emit_task_event(
        task_id,
        "cover_applied",
        {
            "message": f"Cover applied: {params.get('artist')} / {params.get('album')}",
            "artist": params.get("artist"),
            "album": params.get("album"),
        },
    )

    return {"applied": True, "path": album_path}


def _handle_upload_image(task_id: str, params: dict, config: dict) -> dict:
    """Save uploaded image to the correct location in the library."""
    from PIL import Image

    img_type = params.get("type")
    artist = params.get("artist", "")
    album = params.get("album", "")
    data_b64 = params.get("data_b64", "")

    if not data_b64:
        return {"error": "No image data"}

    raw = base64.b64decode(data_b64)
    img = Image.open(_io.BytesIO(raw)).convert("RGB")
    lib = Path(config["library_path"])

    if img_type == "cover":
        from crate.db import get_library_album

        album_data = get_library_album(artist, album)
        if not album_data:
            return {"error": "Album not found"}
        dest = Path(album_data["path"]) / "cover.jpg"
        img.save(str(dest), "JPEG", quality=92)
    elif img_type == "artist_photo":
        dest = lib / artist / "artist.jpg"
        img.save(str(dest), "JPEG", quality=92)
        with get_db_ctx() as cur:
            cur.execute("UPDATE library_artists SET has_photo = 1 WHERE name = %s", (artist,))
    elif img_type == "background":
        dest = lib / artist / "background.jpg"
        img.save(str(dest), "JPEG", quality=90)
    else:
        return {"error": f"Unknown image type: {img_type}"}

    log.info("Image uploaded: %s for %s (%dx%d)", img_type, artist, img.width, img.height)

    if img_type == "cover":
        try:
            from crate.navidrome import start_scan

            start_scan()
        except Exception:
            pass

    return {"type": img_type, "path": str(dest), "width": img.width, "height": img.height}


ARTWORK_TASK_HANDLERS: dict[str, TaskHandler] = {
    "fetch_cover": _handle_fetch_cover,
    "fetch_artist_covers": _handle_fetch_artist_covers,
    "fetch_artwork_all": _handle_fetch_artwork_all,
    "batch_covers": _handle_batch_covers,
    "scan_missing_covers": _handle_scan_missing_covers,
    "apply_cover": _handle_apply_cover,
    "upload_image": _handle_upload_image,
}
