import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import mutagen
from flask import Flask, render_template, jsonify, request, send_file

from musicdock.analytics import compute_analytics
from musicdock.audio import read_tags, get_audio_files
from musicdock.artwork import scan_missing_covers, fetch_cover_from_caa, extract_embedded_cover, save_cover
from musicdock.config import load_config
from musicdock.enricher import enrich_album
from musicdock.importer import ImportQueue
from musicdock.matcher import match_album, apply_match
from musicdock.missing import find_missing_albums
from musicdock.models import Album
from musicdock.organizer import preview_organize, organize_album, suggest_folder_name, PRESETS
from musicdock.quality import quality_report
from musicdock.scanner import LibraryScanner
from musicdock.fixer import LibraryFixer
from musicdock.report import save_report

log = logging.getLogger(__name__)

app = Flask(__name__, template_folder="templates", static_folder="static")

# Scan state
_state = {
    "scanning": False,
    "last_scan": None,
    "issues": [],
    "scan_progress": "",
}
_lock = threading.Lock()

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png", "album.jpg", "album.png"]


def get_config():
    return load_config()


def _library_path():
    return Path(get_config()["library_path"])


def _extensions():
    return set(get_config().get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))


def _safe_path(base: Path, user_path: str) -> Path | None:
    """Resolve user path safely within base to prevent traversal."""
    resolved = (base / user_path).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        return None
    return resolved


# ═══════════════════════════════════════════════════════════════════
# PAGES
# ═══════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("app.html", page="dashboard")


@app.route("/browse")
def browse():
    return render_template("app.html", page="browse")


@app.route("/artist/<path:name>")
def artist_page(name):
    return render_template("app.html", page="artist", artist_name=name)


@app.route("/album/<path:artist>/<path:album>")
def album_page(artist, album):
    return render_template("app.html", page="album", artist_name=artist, album_name=album)


@app.route("/health")
def health_page():
    return render_template("app.html", page="health")


@app.route("/duplicates")
def duplicates_page():
    return render_template("app.html", page="duplicates")


@app.route("/artwork")
def artwork_page():
    return render_template("app.html", page="artwork")


@app.route("/organizer")
def organizer_page():
    return render_template("app.html", page="organizer")


@app.route("/imports")
def imports_page():
    return render_template("app.html", page="imports")


@app.route("/analytics")
def analytics_page():
    return render_template("app.html", page="analytics")


@app.route("/missing-albums")
def missing_albums_page():
    return render_template("app.html", page="missing-albums")


@app.route("/quality")
def quality_page():
    return render_template("app.html", page="quality")


# ═══════════════════════════════════════════════════════════════════
# API — BROWSE & SEARCH
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/artists")
def api_artists():
    lib = _library_path()
    q = request.args.get("q", "").lower()
    artists = []

    for d in sorted(lib.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        if q and q not in d.name.lower():
            continue

        album_count = sum(1 for a in d.iterdir() if a.is_dir() and not a.name.startswith("."))
        artists.append({"name": d.name, "albums": album_count})

    return jsonify(artists)


@app.route("/api/artist/<path:name>")
def api_artist(name):
    lib = _library_path()
    artist_dir = _safe_path(lib, name)
    if not artist_dir or not artist_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    exts = _extensions()
    albums = []

    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue

        tracks = get_audio_files(album_dir, exts)
        formats = list({t.suffix.lower() for t in tracks})
        total_size = sum(t.stat().st_size for t in tracks)
        has_cover = any((album_dir / c).exists() for c in COVER_NAMES)

        # Read year from first track
        year = ""
        if tracks:
            tags = read_tags(tracks[0])
            year = tags.get("date", "")[:4]

        albums.append({
            "name": album_dir.name,
            "tracks": len(tracks),
            "formats": formats,
            "size_mb": round(total_size / (1024**2)),
            "year": year,
            "has_cover": has_cover,
        })

    return jsonify({"name": name, "albums": albums})


@app.route("/api/album/<path:artist>/<path:album>")
def api_album(artist, album):
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    exts = _extensions()
    tracks = get_audio_files(album_dir, exts)
    has_cover = any((album_dir / c).exists() for c in COVER_NAMES)
    cover_file = None
    for c in COVER_NAMES:
        if (album_dir / c).exists():
            cover_file = c
            break

    track_list = []
    album_tags = {}

    for t in tracks:
        tags = read_tags(t)
        info = mutagen.File(t)
        bitrate = getattr(info.info, "bitrate", 0)
        length = getattr(info.info, "length", 0)

        track_list.append({
            "filename": t.name,
            "format": t.suffix.lower(),
            "size_mb": round(t.stat().st_size / (1024**2), 1),
            "bitrate": bitrate // 1000 if bitrate else None,
            "length_sec": round(length) if length else 0,
            "tags": tags,
        })

        if not album_tags and tags.get("album"):
            album_tags = {
                "artist": tags.get("albumartist") or tags.get("artist", ""),
                "album": tags.get("album", ""),
                "year": tags.get("date", "")[:4],
                "genre": tags.get("genre", "") if "genre" in tags else "",
                "musicbrainz_albumid": tags.get("musicbrainz_albumid"),
            }

    total_size = sum(t.stat().st_size for t in tracks)
    total_length = sum(tr["length_sec"] for tr in track_list)

    return jsonify({
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
    })


@app.route("/api/cover/<path:artist>/<path:album>")
def api_cover(artist, album):
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return "", 404

    for c in COVER_NAMES:
        cover = album_dir / c
        if cover.exists():
            return send_file(cover)

    # Try embedded cover from first audio file
    exts = _extensions()
    tracks = get_audio_files(album_dir, exts)
    if tracks:
        audio = mutagen.File(tracks[0])
        if audio and hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            from io import BytesIO
            return send_file(BytesIO(pic.data), mimetype=pic.mime)
        # MP3 APIC
        if audio and hasattr(audio, "tags") and audio.tags:
            for key in audio.tags:
                if key.startswith("APIC"):
                    pic = audio.tags[key]
                    from io import BytesIO
                    return send_file(BytesIO(pic.data), mimetype=pic.mime)

    return "", 404


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").lower().strip()
    if len(q) < 2:
        return jsonify({"artists": [], "albums": []})

    lib = _library_path()
    artists = []
    albums = []

    for artist_dir in sorted(lib.iterdir()):
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue

        if q in artist_dir.name.lower():
            artists.append({"name": artist_dir.name})

        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            if q in album_dir.name.lower() or q in artist_dir.name.lower():
                albums.append({
                    "artist": artist_dir.name,
                    "name": album_dir.name,
                })

        if len(artists) > 20 and len(albums) > 50:
            break

    return jsonify({
        "artists": artists[:20],
        "albums": albums[:50],
    })


# ═══════════════════════════════════════════════════════════════════
# API — TAG EDITOR
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/tags/<path:artist>/<path:album>", methods=["PUT"])
def api_update_tags(artist, album):
    """Update tags for all tracks in an album."""
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    exts = _extensions()
    tracks = get_audio_files(album_dir, exts)
    updated = 0
    errors = []

    # Album-level tags (applied to all tracks)
    album_fields = {}
    for field in ["artist", "albumartist", "album", "date", "genre"]:
        if field in data:
            album_fields[field] = data[field]

    # Per-track tags
    track_tags = data.get("tracks", {})

    for track in tracks:
        try:
            audio = mutagen.File(track, easy=True)
            if audio is None:
                continue

            # Apply album-level tags
            for key, val in album_fields.items():
                audio[key] = val

            # Apply per-track tags (keyed by filename)
            if track.name in track_tags:
                for key, val in track_tags[track.name].items():
                    audio[key] = val

            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": track.name, "error": str(e)})

    return jsonify({"updated": updated, "errors": errors})


@app.route("/api/tags/track/<path:filepath>", methods=["PUT"])
def api_update_track_tags(filepath):
    """Update tags for a single track."""
    lib = _library_path()
    track_path = _safe_path(lib, filepath)
    if not track_path or not track_path.is_file():
        return jsonify({"error": "Not found"}), 404

    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    try:
        audio = mutagen.File(track_path, easy=True)
        if audio is None:
            return jsonify({"error": "Cannot read file"}), 400

        for key, val in data.items():
            audio[key] = val

        audio.save()
        return jsonify({"status": "ok", "file": track_path.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════════════
# API — MUSICBRAINZ MATCHER
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/match/<path:artist>/<path:album>")
def api_match_album(artist, album):
    """Find MusicBrainz matches for a local album using smart matching."""
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    exts = _extensions()
    candidates = match_album(album_dir, exts)
    return jsonify(candidates)


@app.route("/api/match/apply", methods=["POST"])
def api_match_apply():
    """Apply a MusicBrainz match to a local album."""
    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    lib = _library_path()
    artist = data.get("artist_folder")
    album_name = data.get("album_folder")
    release = data.get("release")

    album_dir = _safe_path(lib, f"{artist}/{album_name}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Album not found"}), 404

    exts = _extensions()
    result = apply_match(album_dir, exts, release)
    return jsonify(result)


# ═══════════════════════════════════════════════════════════════════
# API — DUPLICATE RESOLVER
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/duplicates/compare")
def api_duplicates_compare():
    """Compare two album paths for duplicate resolution."""
    lib = _library_path()
    paths = request.args.getlist("path")
    if len(paths) < 2:
        return jsonify({"error": "Need at least 2 paths"}), 400

    exts = _extensions()
    albums = []

    for p in paths:
        album_dir = _safe_path(lib, p)
        if not album_dir or not album_dir.is_dir():
            continue

        tracks = get_audio_files(album_dir, exts)
        track_list = []
        for t in tracks:
            tags = read_tags(t)
            info = mutagen.File(t)
            bitrate = getattr(info.info, "bitrate", 0) if info else 0
            length = getattr(info.info, "length", 0) if info else 0
            track_list.append({
                "filename": t.name,
                "format": t.suffix.lower(),
                "size_mb": round(t.stat().st_size / (1024**2), 1),
                "bitrate": bitrate // 1000 if bitrate else None,
                "length_sec": round(length) if length else 0,
                "title": tags.get("title", t.stem),
                "tracknumber": tags.get("tracknumber", ""),
            })

        has_cover = any((album_dir / c).exists() for c in COVER_NAMES)
        total_size = sum(t.stat().st_size for t in tracks)
        formats = list({t.suffix.lower() for t in tracks})

        albums.append({
            "path": p,
            "name": album_dir.name,
            "artist": album_dir.parent.name,
            "track_count": len(tracks),
            "total_size_mb": round(total_size / (1024**2)),
            "formats": formats,
            "has_cover": has_cover,
            "tracks": track_list,
        })

    return jsonify(albums)


@app.route("/api/duplicates/resolve", methods=["POST"])
def api_duplicates_resolve():
    """Keep one album, trash the rest."""
    import shutil
    data = request.json
    keep = data.get("keep")
    remove = data.get("remove", [])

    if not keep or not remove:
        return jsonify({"error": "Need 'keep' and 'remove' paths"}), 400

    lib = _library_path()
    trash = lib / ".librarian-trash"
    removed = []

    for path_str in remove:
        album_dir = _safe_path(lib, path_str)
        if not album_dir or not album_dir.is_dir():
            continue

        dest = trash / album_dir.relative_to(lib)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(album_dir), str(dest))
        removed.append(path_str)

    return jsonify({"kept": keep, "removed": removed})


# ═══════════════════════════════════════════════════════════════════
# API — SCANNER (existing)
# ═══════════════════════════════════════════════════════════════════

def _run_scan_async(only=None):
    config = get_config()
    with _lock:
        _state["scanning"] = True
        _state["scan_progress"] = f"Scanning {only or 'all'}..."
    try:
        scanner = LibraryScanner(config)
        issues = scanner.scan(only=only)
        save_report(issues, config)
        with _lock:
            _state["issues"] = issues
            _state["last_scan"] = datetime.now(timezone.utc).isoformat()
            _state["scanning"] = False
            _state["scan_progress"] = ""
    except Exception as e:
        log.exception("Scan failed")
        with _lock:
            _state["scanning"] = False
            _state["scan_progress"] = f"Error: {e}"


@app.route("/api/scan", methods=["POST"])
def start_scan():
    with _lock:
        if _state["scanning"]:
            return jsonify({"error": "Scan already in progress"}), 409
    only = request.json.get("only") if request.is_json else None
    thread = threading.Thread(target=_run_scan_async, args=(only,), daemon=True)
    thread.start()
    return jsonify({"status": "started", "only": only})


@app.route("/api/status")
def api_status():
    with _lock:
        return jsonify({
            "scanning": _state["scanning"],
            "last_scan": _state["last_scan"],
            "issue_count": len(_state["issues"]),
            "progress": _state["scan_progress"],
        })


@app.route("/api/issues")
def api_issues():
    with _lock:
        issue_list = _state["issues"]
    type_filter = request.args.get("type")
    if type_filter:
        issue_list = [i for i in issue_list if i.type.value == type_filter]
    return jsonify([
        {
            "type": i.type.value, "severity": i.severity.value,
            "confidence": i.confidence, "description": i.description,
            "suggestion": i.suggestion,
            "paths": [str(p) for p in i.paths], "details": i.details,
        }
        for i in issue_list
    ])


@app.route("/api/fix", methods=["POST"])
def fix_issues():
    config = get_config()
    dry_run = request.json.get("dry_run", True) if request.is_json else True
    with _lock:
        if _state["scanning"]:
            return jsonify({"error": "Scan in progress"}), 409
        current_issues = _state["issues"]
    if not current_issues:
        return jsonify({"error": "No issues to fix. Run a scan first."}), 400
    fixer = LibraryFixer(config)
    threshold = config.get("confidence_threshold", 90)
    auto = [i for i in current_issues if i.confidence >= threshold]
    manual = [i for i in current_issues if i.confidence < threshold]
    if not dry_run:
        fixer.fix(current_issues, dry_run=False)
    return jsonify({
        "dry_run": dry_run, "threshold": threshold,
        "auto_fixable": len(auto), "needs_review": len(manual),
    })


# ═══════════════════════════════════════════════════════════════════
# API — ALBUM ART MANAGER
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/artwork/missing")
def api_artwork_missing():
    """List albums missing cover art."""
    lib = _library_path()
    exts = _extensions()
    missing = scan_missing_covers(lib, exts)
    return jsonify(missing)


@app.route("/api/artwork/fetch", methods=["POST"])
def api_artwork_fetch():
    """Fetch cover art from Cover Art Archive for a specific album."""
    data = request.json
    mbid = data.get("mbid")
    album_path = data.get("path")

    if not mbid:
        return jsonify({"error": "No MBID provided"}), 400

    lib = _library_path()
    album_dir = _safe_path(lib, album_path) if album_path else None

    image = fetch_cover_from_caa(mbid)
    if not image:
        return jsonify({"error": "No cover found on CAA"}), 404

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        return jsonify({"status": "saved", "path": str(album_dir / "cover.jpg")})

    return jsonify({"error": "Album directory not found"}), 404


@app.route("/api/artwork/extract", methods=["POST"])
def api_artwork_extract():
    """Extract embedded cover from first track and save as file."""
    data = request.json
    album_path = data.get("path")

    lib = _library_path()
    album_dir = _safe_path(lib, album_path)
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Album not found"}), 404

    exts = _extensions()
    tracks = get_audio_files(album_dir, exts)
    if not tracks:
        return jsonify({"error": "No tracks found"}), 404

    image = extract_embedded_cover(tracks[0])
    if not image:
        return jsonify({"error": "No embedded cover found"}), 404

    save_cover(album_dir, image)
    return jsonify({"status": "saved", "path": str(album_dir / "cover.jpg")})


@app.route("/api/artwork/fetch-all", methods=["POST"])
def api_artwork_fetch_all():
    """Fetch covers for all albums that have MBIDs."""
    lib = _library_path()
    exts = _extensions()
    missing = scan_missing_covers(lib, exts)

    fetched = 0
    failed = 0
    for album in missing:
        mbid = album.get("mbid")
        if not mbid:
            continue
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    return jsonify({"fetched": fetched, "failed": failed, "total": len(missing)})


# ═══════════════════════════════════════════════════════════════════
# API — FILE ORGANIZER
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/organize/presets")
def api_organize_presets():
    """List available naming presets."""
    return jsonify(PRESETS)


@app.route("/api/organize/preview/<path:artist>/<path:album>")
def api_organize_preview(artist, album):
    """Preview renaming for an album."""
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    pattern = request.args.get("pattern", None)
    exts = _extensions()
    preview = preview_organize(album_dir, exts, pattern)
    folder_suggestion = suggest_folder_name(album_dir, exts, include_year="year" in (pattern or ""))

    return jsonify({
        "tracks": preview,
        "folder_current": album_dir.name,
        "folder_suggested": folder_suggestion,
        "changes": sum(1 for p in preview if p["changed"]),
    })


@app.route("/api/organize/apply/<path:artist>/<path:album>", methods=["POST"])
def api_organize_apply(artist, album):
    """Apply file renaming to an album."""
    lib = _library_path()
    album_dir = _safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return jsonify({"error": "Not found"}), 404

    data = request.json or {}
    pattern = data.get("pattern")
    rename_folder = data.get("rename_folder")
    exts = _extensions()

    result = organize_album(album_dir, exts, pattern, rename_folder)
    return jsonify(result)


# ═══════════════════════════════════════════════════════════════════
# API — IMPORT QUEUE
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/imports/pending")
def api_imports_pending():
    """List pending imports from download directories."""
    config = get_config()
    queue = ImportQueue(config)
    pending = queue.scan_pending()
    return jsonify(pending)


@app.route("/api/imports/import", methods=["POST"])
def api_imports_import():
    """Import a single album."""
    config = get_config()
    queue = ImportQueue(config)
    data = request.json
    result = queue.import_item(
        data["source_path"],
        data.get("artist"),
        data.get("album"),
    )
    return jsonify(result)


@app.route("/api/imports/import-all", methods=["POST"])
def api_imports_import_all():
    """Import all pending items."""
    config = get_config()
    queue = ImportQueue(config)
    results = queue.import_all()
    return jsonify(results)


@app.route("/api/imports/remove", methods=["POST"])
def api_imports_remove():
    """Remove source directory after import."""
    config = get_config()
    queue = ImportQueue(config)
    data = request.json
    ok = queue.remove_source(data["source_path"])
    return jsonify({"removed": ok})


# ═══════════════════════════════════════════════════════════════════
# API — BATCH OPERATIONS
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/batch/retag", methods=["POST"])
def api_batch_retag():
    """Batch re-tag multiple albums from MusicBrainz."""
    data = request.json
    albums = data.get("albums", [])
    lib = _library_path()
    exts = _extensions()
    results = []

    for item in albums:
        artist = item.get("artist")
        album_name = item.get("album")
        album_dir = _safe_path(lib, f"{artist}/{album_name}")
        if not album_dir or not album_dir.is_dir():
            results.append({"artist": artist, "album": album_name, "error": "Not found"})
            continue

        candidates = match_album(album_dir, exts)
        if not candidates:
            results.append({"artist": artist, "album": album_name, "error": "No MB match"})
            continue

        best = candidates[0]
        if best["match_score"] < 60:
            results.append({"artist": artist, "album": album_name, "error": f"Low score: {best['match_score']}"})
            continue

        result = apply_match(album_dir, exts, best)
        result["artist"] = artist
        result["album"] = album_name
        result["match_score"] = best["match_score"]
        results.append(result)

    return jsonify(results)


@app.route("/api/batch/fetch-covers", methods=["POST"])
def api_batch_fetch_covers():
    """Batch fetch covers for multiple albums."""
    data = request.json
    albums = data.get("albums", [])
    lib = _library_path()
    results = []

    for item in albums:
        mbid = item.get("mbid")
        path = item.get("path")
        if not mbid:
            results.append({"path": path, "error": "No MBID"})
            continue

        album_dir = _safe_path(lib, path)
        if not album_dir or not album_dir.is_dir():
            results.append({"path": path, "error": "Not found"})
            continue

        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            results.append({"path": path, "status": "fetched"})
        else:
            results.append({"path": path, "error": "Not found on CAA"})

    return jsonify(results)


# ═══════════════════════════════════════════════════════════════════
# API — ANALYTICS
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/analytics")
def api_analytics():
    """Compute library analytics (genres, decades, formats, bitrates)."""
    lib = _library_path()
    exts = _extensions()
    data = compute_analytics(lib, exts)
    return jsonify(data)


# ═══════════════════════════════════════════════════════════════════
# API — MISSING ALBUMS
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/missing/<path:artist>")
def api_missing_albums(artist):
    """Find missing albums for an artist by comparing with MusicBrainz."""
    lib = _library_path()
    artist_dir = _safe_path(lib, artist)
    if not artist_dir or not artist_dir.is_dir():
        return jsonify({"error": "Artist not found"}), 404

    exts = _extensions()
    result = find_missing_albums(artist_dir, exts)
    return jsonify(result)


# ═══════════════════════════════════════════════════════════════════
# API — QUALITY REPORT
# ═══════════════════════════════════════════════════════════════════

@app.route("/api/quality")
def api_quality():
    """Generate quality report for the library."""
    lib = _library_path()
    exts = _extensions()
    report = quality_report(lib, exts)
    return jsonify(report)


@app.route("/api/stats")
def api_stats():
    lib = _library_path()
    exts = _extensions()
    artists = albums = tracks = total_size = 0
    formats = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        artists += 1
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            albums += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    tracks += 1
                    ext = f.suffix.lower()
                    formats[ext] = formats.get(ext, 0) + 1
                    total_size += f.stat().st_size
    return jsonify({
        "artists": artists, "albums": albums, "tracks": tracks,
        "formats": formats, "total_size_gb": round(total_size / (1024**3), 2),
    })


def run_web(config: dict, host="0.0.0.0", port=8585):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    app.run(host=host, port=port, debug=False)
