import json
import logging
import shutil
import time
from pathlib import Path
from typing import Callable

from crate.db import delete_cache, emit_task_event, get_db_ctx, get_setting, get_task, set_cache, update_task

log = logging.getLogger(__name__)

TaskHandler = Callable[[str, dict, dict], dict]
DEFAULT_AUDIO_EXTENSIONS = [".flac", ".mp3", ".m4a", ".ogg", ".opus"]
ENRICHMENT_CACHE_PREFIXES = (
    "enrichment:",
    "lastfm:artist:",
    "fanart:artist:",
    "fanart:bg:",
    "fanart:all:",
    "nd:artist:",
    "spotify:artist:",
)


def _is_cancelled(task_id: str) -> bool:
    try:
        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


def _mark_processing(artist_name: str):
    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)


def _unmark_processing(artist_name: str):
    delete_cache(f"processing:{artist_name.lower()}")


def _compute_dir_hash(directory: Path) -> str:
    try:
        from crate.crate_cli import has_subcommands, is_available, run_scan

        if is_available() and has_subcommands():
            data = run_scan(str(directory), hash=True, covers=False)
            if data and data.get("artists"):
                content_hash = data["artists"][0].get("content_hash")
                if content_hash:
                    return content_hash
    except Exception:
        pass

    import hashlib

    digest = hashlib.md5(usedforsecurity=False)
    for file_path in sorted(directory.rglob("*")):
        if file_path.is_file():
            digest.update(f"{file_path.relative_to(directory)}:{file_path.stat().st_size}\n".encode())
    return digest.hexdigest()


def _audio_extensions(config: dict) -> set[str]:
    return set(config.get("audio_extensions", DEFAULT_AUDIO_EXTENSIONS))


def _handle_enrich_artists(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import get_library_artists
    from crate.enrichment import enrich_artist

    all_artists, total = get_library_artists(per_page=10000)
    enriched = 0
    skipped = 0

    for index, artist in enumerate(all_artists):
        if _is_cancelled(task_id):
            break

        name = artist["name"]
        if index % 5 == 0:
            update_task(
                task_id,
                progress=json.dumps(
                    {
                        "artist": name,
                        "done": index + 1,
                        "total": total,
                        "enriched": enriched,
                        "skipped": skipped,
                    }
                ),
            )

        result = enrich_artist(name, config)
        if result.get("skipped"):
            skipped += 1
            emit_task_event(task_id, "artist_skipped", {"message": f"Skipped: {name}", "artist": name})
        else:
            enriched += 1
            emit_task_event(
                task_id,
                "artist_enriched",
                {"message": f"Enriched: {name}", "artist": name, "sources": result},
            )

    return {"enriched": enriched, "skipped": skipped, "total": total}


def _handle_enrich_single(task_id: str, params: dict, config: dict) -> dict:
    """Enrich a single artist: all sources + photo + persist to DB."""
    from crate.enrichment import enrich_artist

    name = params.get("artist", "")
    if not name:
        return {"error": "No artist specified"}

    update_task(task_id, progress=json.dumps({"artist": name, "phase": "enriching"}))
    result = enrich_artist(name, config, force=True)
    emit_task_event(task_id, "info", {"message": f"Enriched: {name}", "sources": result})
    return result


def _handle_reset_enrichment(task_id: str, params: dict, config: dict) -> dict:
    from crate.db import get_library_artist, log_audit

    name = params.get("artist", "")
    lib = Path(config["library_path"])

    for prefix in ENRICHMENT_CACHE_PREFIXES:
        delete_cache(f"{prefix}{name.lower()}")

    artist = get_library_artist(name)
    folder = (artist.get("folder_name") if artist else None) or name
    artist_dir = lib / folder
    for photo in ("artist.jpg", "artist.png", "photo.jpg"):
        photo_path = artist_dir / photo
        if photo_path.exists():
            try:
                photo_path.unlink()
            except OSError:
                pass

    emit_task_event(task_id, "info", {"message": f"Reset enrichment for: {name}"})
    log_audit("reset_enrichment", "artist", name, task_id=task_id)

    result = _handle_enrich_single(task_id, {"artist": name}, config)
    return {"reset": name, "enrichment": result}


def _handle_enrich_mbids(task_id: str, params: dict, config: dict) -> dict:
    """Enrich albums and tracks with MusicBrainz IDs."""
    import re

    import mutagen
    import musicbrainzngs
    from crate.audio import get_audio_files
    from crate.db import get_library_albums, get_library_tracks
    from crate.matcher import _gather_local_info, _get_release_detail, _score_match, _search_musicbrainz

    lib = Path(config["library_path"])
    exts = _audio_extensions(config)
    artist_filter = params.get("artist")
    min_score = params.get("min_score", 70)

    if artist_filter:
        albums = get_library_albums(artist_filter)
    else:
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''"
            )
            albums = [dict(row) for row in cur.fetchall()]

    total = len(albums)
    enriched = 0
    skipped = 0
    failed = 0

    for index, album in enumerate(albums):
        if _is_cancelled(task_id):
            break

        album_name = album.get("tag_album") or album.get("name", "")
        artist_name = album.get("artist", "")
        album_path = album.get("path", "")

        existing_mbid = album.get("musicbrainz_albumid")
        if existing_mbid and existing_mbid.strip():
            skipped += 1
            continue

        if index % 5 == 0:
            update_task(
                task_id,
                progress=json.dumps(
                    {
                        "artist": artist_name,
                        "album": album_name,
                        "done": index,
                        "total": total,
                        "enriched": enriched,
                        "skipped": skipped,
                    }
                ),
            )

        clean_album = re.sub(r"^\d{4}\s*-\s*", "", album_name)
        tracks_db = get_library_tracks(album["id"]) if "id" in album else []
        track_count = len(tracks_db) or album.get("track_count", 0)

        candidates = _search_musicbrainz(artist_name, clean_album, track_count)
        if not candidates:
            failed += 1
            time.sleep(1)
            continue

        best_release = None
        best_score = 0

        album_dir = Path(album_path) if album_path else None
        if album_dir and album_dir.is_dir():
            local_info = _gather_local_info(get_audio_files(album_dir, list(exts)))
        else:
            local_info = {
                "artist": artist_name,
                "album": clean_album,
                "track_count": track_count,
                "tracks": [
                    {
                        "title": track.get("title", ""),
                        "length_sec": int(track.get("duration", 0)),
                        "tracknumber": str(track.get("track_number", "")),
                        "filename": track.get("filename", ""),
                    }
                    for track in tracks_db
                ],
                "total_length": sum(int(track.get("duration", 0)) for track in tracks_db),
            }

        for candidate in candidates[:3]:
            release = _get_release_detail(candidate["mbid"])
            if not release:
                continue
            score = _score_match(local_info, release)
            if score > best_score:
                best_score = score
                best_release = release
            time.sleep(0.5)

        if not best_release or best_score < min_score:
            failed += 1
            time.sleep(0.5)
            continue

        auto_apply_threshold = int(get_setting("mb_auto_apply_threshold", "95"))
        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            try:
                from crate.matcher import apply_match

                apply_result = apply_match(album_dir, exts, best_release)
                log.info(
                    "Auto-applied MB tags for %s/%s (score=%d, updated=%d)",
                    artist_name,
                    clean_album,
                    best_score,
                    apply_result.get("updated", 0),
                )
                emit_task_event(
                    task_id,
                    "info",
                    {"message": f"Auto-applied tags: {artist_name}/{clean_album} (score {best_score}%)"},
                )
            except Exception:
                log.warning("Auto-apply failed for %s/%s", artist_name, clean_album, exc_info=True)

        release_mbid = best_release["mbid"]
        release_group_id = best_release.get("release_group_id", "")
        mb_tracks = best_release.get("tracks", [])

        with get_db_ctx() as cur:
            cur.execute(
                "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
                (release_mbid, album["id"]),
            )
            if release_group_id:
                cur.execute(
                    "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE id = %s",
                    (release_group_id, album["id"]),
                )
            for index, db_track in enumerate(tracks_db):
                if index >= len(mb_tracks):
                    break
                track_mbid = mb_tracks[index].get("mbid", "")
                if track_mbid:
                    cur.execute(
                        "UPDATE library_tracks SET musicbrainz_albumid = %s, musicbrainz_trackid = %s "
                        "WHERE id = %s",
                        (release_mbid, track_mbid, db_track["id"]),
                    )

        if best_score < auto_apply_threshold:
            for index, db_track in enumerate(tracks_db):
                if index >= len(mb_tracks):
                    break
                mb_track = mb_tracks[index]
                track_mbid = mb_track.get("mbid", "")
                track_path = db_track.get("path", "")
                if track_path and Path(track_path).is_file():
                    try:
                        audio = mutagen.File(track_path, easy=True)
                        if audio is not None:
                            changed = False
                            if release_mbid:
                                audio["musicbrainz_albumid"] = release_mbid
                                changed = True
                            if track_mbid:
                                audio["musicbrainz_trackid"] = track_mbid
                                changed = True
                            if release_group_id:
                                audio["musicbrainz_releasegroupid"] = release_group_id
                                changed = True
                            if changed:
                                audio.save()
                    except Exception:
                        log.warning("Failed to write MBID tags to %s", track_path)

        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            try:
                from crate.library_sync import LibrarySync

                syncer = LibrarySync(config)
                syncer.sync_album(album_dir, artist_name)
            except Exception:
                log.warning("Re-sync after auto-apply failed for %s", album_name, exc_info=True)

        enriched += 1
        emit_task_event(
            task_id,
            "album_matched",
            {
                "message": f"Matched: {artist_name} / {clean_album} (score {best_score}%)",
                "artist": artist_name,
                "album": clean_album,
                "mbid": release_mbid,
                "score": best_score,
            },
        )
        log.info(
            "Enriched %s / %s (score=%d, mbid=%s)",
            artist_name,
            clean_album,
            best_score,
            release_mbid,
        )
        time.sleep(1)

    return {"enriched": enriched, "skipped": skipped, "failed": failed, "total": total}


def _reorganize_artist_folders(
    artist_name: str, lib: Path, config: dict, task_id: str | None = None
):
    """Move album folders to Artist/Year/Album structure if not already organized."""
    import re as _re

    from crate.audio import get_audio_files, read_tags

    artist_dir = lib / artist_name
    if not artist_dir.is_dir():
        return

    year_prefix_re = _re.compile(r"^(\d{4})\s*[-–]\s*(.+)$")
    exts = _audio_extensions(config)
    moved = 0

    for subdir in list(artist_dir.iterdir()):
        if not subdir.is_dir() or subdir.name.startswith("."):
            continue
        if subdir.name.isdigit() and len(subdir.name) == 4:
            continue

        match = year_prefix_re.match(subdir.name)
        if match:
            year = match.group(1)
            clean_name = match.group(2).strip()
        else:
            audio_files = get_audio_files(subdir, list(exts))
            if not audio_files:
                continue
            tags = read_tags(audio_files[0])
            year_tag = tags.get("date", "")[:4]
            if not year_tag or not year_tag.isdigit():
                continue
            year = year_tag
            clean_name = subdir.name

        target = artist_dir / year / clean_name
        if target == subdir:
            continue
        if target.exists():
            log.warning("Cannot reorganize %s: target %s already exists", subdir, target)
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(subdir), str(target))
            old_path = str(subdir)
            new_path = str(target)
            with get_db_ctx() as cur:
                cur.execute(
                    "UPDATE library_albums SET name = %s, path = %s WHERE path = %s",
                    (clean_name, new_path, old_path),
                )
                cur.execute(
                    "UPDATE library_tracks SET path = REPLACE(path, %s, %s) WHERE path LIKE %s",
                    (old_path, new_path, old_path + "%"),
                )
            moved += 1
            log.info("Reorganized: %s -> %s", subdir.name, f"{year}/{clean_name}")
            emit_task_event(task_id, "info", {"message": f"Moved {subdir.name} -> {year}/{clean_name}"})
        except Exception:
            log.warning("Failed to reorganize %s", subdir, exc_info=True)

    if moved:
        log.info("Reorganized %d album folders for %s", moved, artist_name)


def _handle_process_new_content(task_id: str, params: dict, config: dict) -> dict:
    """Full pipeline for new content: enrich artist + index genres + analyze audio + bliss."""
    artist_name = params.get("artist", "")
    album_folder = params.get("album", "")

    _mark_processing(artist_name)
    try:
        return _process_new_content_inner(task_id, params, config, artist_name, album_folder)
    finally:
        _unmark_processing(artist_name)


def _process_new_content_inner(
    task_id: str, params: dict, config: dict, artist_name: str, album_folder: str
) -> dict:
    import re as _re

    from crate.db import get_library_albums, get_library_artist, get_library_tracks, set_album_genres, update_track_audiomuse
    from crate.enrichment import enrich_artist
    from crate.popularity import _lastfm_get, _parse_int

    lib = Path(config["library_path"])
    result = {"artist": artist_name, "album": album_folder, "steps": {}}

    artist_row = get_library_artist(artist_name)
    folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
    artist_dir = lib / folder
    if artist_dir.is_dir():
        new_hash = _compute_dir_hash(artist_dir)
        old_hash = artist_row.get("content_hash") if artist_row else None
        if old_hash and new_hash == old_hash:
            log.info("Skipping %s - content unchanged (hash: %s)", artist_name, new_hash[:12])
            return {"artist": artist_name, "skipped": True, "reason": "content_unchanged"}

    update_task(task_id, progress=json.dumps({"step": "organize_folders", "artist": artist_name}))
    try:
        _reorganize_artist_folders(artist_name, lib, config, task_id)
        result["steps"]["organize_folders"] = True
    except Exception:
        log.warning("Folder reorganization failed for %s", artist_name, exc_info=True)
        result["steps"]["organize_folders"] = "failed"

    update_task(task_id, progress=json.dumps({"step": "enrich_artist", "artist": artist_name}))
    try:
        enrich_result = enrich_artist(artist_name, config)
        result["steps"]["enrich_artist"] = enrich_result.get("skipped", False)
        emit_task_event(
            task_id,
            "step_done",
            {"message": f"Enriched: {artist_name}", "step": "enrich_artist", "result": enrich_result},
        )
    except Exception:
        log.warning("Enrich artist failed for %s", artist_name, exc_info=True)
        result["steps"]["enrich_artist"] = "failed"

    albums = []
    update_task(task_id, progress=json.dumps({"step": "album_genres", "artist": artist_name}))
    try:
        albums = get_library_albums(artist_name)
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = get_library_tracks(album["id"])
            album_genres_raw = set()
            if album.get("genre"):
                for genre in album["genre"].split(","):
                    genre = genre.strip()
                    if genre:
                        album_genres_raw.add(genre)
            for track in tracks:
                if track.get("genre"):
                    for genre in track["genre"].split(","):
                        genre = genre.strip()
                        if genre:
                            album_genres_raw.add(genre)
            if album_genres_raw:
                genres = [(genre, 1.0, "tags") for genre in album_genres_raw]
                set_album_genres(album["id"], genres)
        result["steps"]["album_genres"] = True
    except Exception:
        log.warning("Album genre indexing failed", exc_info=True)
        result["steps"]["album_genres"] = "failed"

    update_task(task_id, progress=json.dumps({"step": "album_mbid", "artist": artist_name}))
    try:
        from crate.audio import get_audio_files
        from crate.matcher import _gather_local_info, _get_release_detail, _score_match, _search_musicbrainz

        exts = _audio_extensions(config)
        mbid_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            existing_mbid = album.get("musicbrainz_albumid")
            if existing_mbid and existing_mbid.strip():
                continue

            clean_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
            track_count = album.get("track_count", 0)
            candidates = _search_musicbrainz(artist_name, clean_name, track_count)
            if not candidates:
                time.sleep(1)
                continue

            album_dir = Path(album["path"]) if album.get("path") else None
            if album_dir and album_dir.is_dir():
                local_info = _gather_local_info(get_audio_files(album_dir, list(exts)))
            else:
                db_tracks = get_library_tracks(album["id"])
                local_info = {
                    "artist": artist_name,
                    "album": clean_name,
                    "track_count": track_count,
                    "tracks": [
                        {
                            "title": track.get("title", ""),
                            "length_sec": int(track.get("duration", 0)),
                            "tracknumber": "",
                            "filename": "",
                        }
                        for track in db_tracks
                    ],
                    "total_length": sum(int(track.get("duration", 0)) for track in db_tracks),
                }

            best_release = None
            best_score = 0
            for candidate in candidates[:2]:
                release = _get_release_detail(candidate["mbid"])
                if not release:
                    continue
                score = _score_match(local_info, release)
                if score > best_score:
                    best_score = score
                    best_release = release
                time.sleep(0.5)

            if best_release and best_score >= 70:
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
                        (best_release["mbid"], album["id"]),
                    )
                mbid_count += 1
            time.sleep(1)

        result["steps"]["album_mbid"] = mbid_count
    except Exception:
        log.warning("Album MBID lookup failed", exc_info=True)
        result["steps"]["album_mbid"] = "failed"

    # Audio analysis and bliss are handled by background daemons (analysis_daemon.py).
    # New tracks enter library_tracks with analysis_state='pending' and bliss_state='pending'
    # and are picked up automatically. No need to enqueue anything here.
    result["steps"]["audio_analysis"] = "background_daemon"
    result["steps"]["bliss"] = "background_daemon"

    update_task(task_id, progress=json.dumps({"step": "popularity", "artist": artist_name}))
    try:
        pop_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute(
                            "UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                            (listeners, playcount, album["id"]),
                        )
                    pop_count += 1
            time.sleep(0.25)

        track_pop = 0
        tracks_checked = 0
        max_track_pop = int(get_setting("max_track_popularity", "50"))
        for album in albums:
            if tracks_checked >= max_track_pop:
                break
            if album_folder and album["name"] != album_folder:
                continue
            tracks_db = get_library_tracks(album["id"])
            for track in tracks_db:
                if tracks_checked >= max_track_pop:
                    break
                title = track.get("title", "")
                if not title or track.get("lastfm_listeners"):
                    continue
                tracks_checked += 1
                try:
                    data = _lastfm_get("track.getinfo", artist=artist_name, track=title, autocorrect="1")
                    if data and "track" in data:
                        info = data["track"]
                        listeners = _parse_int(info.get("listeners", 0))
                        playcount = _parse_int(info.get("playcount", 0))
                        if listeners > 0:
                            with get_db_ctx() as cur:
                                cur.execute(
                                    "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s "
                                    "WHERE id = %s",
                                    (listeners, playcount, track["id"]),
                                )
                            track_pop += 1
                except Exception:
                    pass
                time.sleep(0.2)

        from crate.popularity import _normalize_popularity

        _normalize_popularity()
        result["steps"]["popularity"] = {"albums": pop_count, "tracks": track_pop}
    except Exception:
        log.warning("Popularity failed", exc_info=True)
        result["steps"]["popularity"] = "failed"

    update_task(task_id, progress=json.dumps({"step": "covers", "artist": artist_name}))
    try:
        import requests as _requests

        from crate.artwork import fetch_cover_from_caa, save_cover

        covers_fetched = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_dir = Path(album["path"]) if album.get("path") else None
            if not album_dir or not album_dir.is_dir():
                continue
            if any((album_dir / candidate).exists() for candidate in ("cover.jpg", "cover.png", "folder.jpg")):
                continue

            cover_data = None
            mbid = album.get("musicbrainz_albumid")
            if mbid and mbid.strip():
                cover_data = fetch_cover_from_caa(mbid)

            if not cover_data:
                try:
                    album_name = _re.sub(r"^\d{4}\s*-\s*", "", album.get("tag_album") or album["name"])
                    resp = _requests.get(
                        "https://api.deezer.com/search/album",
                        params={"q": f"{artist_name} {album_name}", "limit": 1},
                        timeout=10,
                    )
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        if data and data[0].get("cover_xl"):
                            img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                cover_data = img_resp.content
                except Exception:
                    pass

            if cover_data:
                save_cover(album_dir, cover_data)
                covers_fetched += 1
                with get_db_ctx() as cur:
                    cur.execute("UPDATE library_albums SET has_cover = 1 WHERE id = %s", (album["id"],))

            time.sleep(0.3)
        result["steps"]["covers"] = covers_fetched
    except Exception:
        log.warning("Cover fetching failed", exc_info=True)
        result["steps"]["covers"] = "failed"

    if artist_dir.is_dir():
        final_hash = _compute_dir_hash(artist_dir)
        with get_db_ctx() as cur:
            cur.execute(
                "UPDATE library_artists SET content_hash = %s WHERE name = %s",
                (final_hash, artist_name),
            )

    return result


ENRICHMENT_TASK_HANDLERS: dict[str, TaskHandler] = {
    "enrich_artist": _handle_enrich_single,
    "enrich_artists": _handle_enrich_artists,
    "reset_enrichment": _handle_reset_enrichment,
    "enrich_mbids": _handle_enrich_mbids,
    "process_new_content": _handle_process_new_content,
}
