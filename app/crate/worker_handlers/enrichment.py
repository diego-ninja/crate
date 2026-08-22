import logging
import shutil
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from crate.artwork_tasks import queue_artwork_materialization
from crate.artwork_variants import ArtworkAsset
from crate.bandcamp.search import BandcampSearchError, find_exact_album_url
from crate.content import compute_dir_hash as _compute_dir_hash
from crate.db.audit import log_audit
from crate.db.cache_settings import get_setting
from crate.db.cache_store import delete_cache, delete_cache_prefix, get_cache, set_cache
from crate.db.events import emit_task_event
from crate.db.genres import set_album_genres
from crate.db.repositories.bandcamp import set_library_entity_bandcamp_url
from crate.db.jobs.enrichment import (
    get_albums_needing_release_metadata,
    get_album_names_for_artists,
    get_artists_with_mbid,
    persist_album_release_group_types,
    persist_album_release_mbids as _db_persist_album_release_mbids,
    update_album_has_cover,
    update_album_path_after_reorganize,
    update_album_popularity,
    update_artist_content_hash,
)
from crate.db.repositories.library import (
    get_library_albums,
    get_library_artist,
    get_library_artists,
    get_library_tracks,
)
from crate.provider_rate_limits import wait_for_provider_slot
from crate.release_dates import normalize_release_date
from crate.storage_layout import looks_like_entity_uid, resolve_artist_dir
from crate.task_progress import (
    TaskProgress,
    emit_item_event,
    emit_progress,
    entity_label,
)
from crate.worker_handlers import DEFAULT_AUDIO_EXTENSIONS, TaskHandler, is_cancelled
from crate.worker_handlers.analysis import register_parent_finalizer

log = logging.getLogger(__name__)

ENRICHMENT_CACHE_PREFIXES = (
    "enrichment:",
    "lastfm:artist:",
    "fanart:artist:",
    "fanart:bg:",
    "fanart:all:",
    "nd:artist:",
    "spotify:artist:",
)
ENRICH_ARTISTS_CHUNK_SIZE = 20
COMPLETENESS_CHUNK_SIZE = 20
COMPLETENESS_MAX_MUSICBRAINZ_PAGES = 50


def _mark_processing(artist_name: str):
    set_cache(f"processing:{artist_name.lower()}", True, ttl=3600)


def _unmark_processing(artist_name: str):
    delete_cache(f"processing:{artist_name.lower()}")


def _invalidate_artist_top_tracks_cache(artist_name: str) -> None:
    delete_cache_prefix(f"listen:artist_top_tracks:v1:{artist_name.strip().lower()}:")
    delete_cache_prefix(f"listen:artist_top_tracks:v2:{artist_name.strip().lower()}:")
    delete_cache_prefix(f"listen:artist_top_tracks:v3:{artist_name.strip().lower()}:")


def _clean_album_lookup_name(album_name: str) -> str:
    import re

    return re.sub(r"^\d{4}\s*-\s*", "", album_name)


def _may_have_stale_short_form_release(album: Mapping[str, Any]) -> bool:
    primary_type = str(album.get("release_group_primary_type") or "").strip().casefold()
    try:
        track_count = int(album.get("track_count") or 0)
    except (TypeError, ValueError):
        track_count = 0
    return primary_type in {"single", "ep"} and track_count > 1


def _existing_release_is_incompatible(
    album: Mapping[str, Any], release: Mapping[str, Any]
) -> bool:
    """Detect a short-form MB match that cannot represent the local album."""
    primary_type = (
        str(
            release.get("release_group_primary_type")
            or album.get("release_group_primary_type")
            or ""
        )
        .strip()
        .casefold()
    )
    if primary_type not in {"single", "ep"}:
        return False

    try:
        local_count = int(album.get("track_count") or 0)
        release_count = int(release.get("track_count") or 0)
    except (TypeError, ValueError):
        return False

    if local_count <= 1 or release_count <= 0:
        return False
    return release_count * 2 < local_count


def _build_album_match_local_info(
    album: Mapping[str, Any],
    artist_name: str,
    clean_album: str,
    tracks_db: Sequence[Mapping[str, Any]],
    exts: set[str],
) -> dict:
    from crate.audio import get_audio_files
    from crate.matcher import _gather_local_info

    album_path = album.get("path", "")
    album_dir = Path(album_path) if album_path else None
    if album_dir and album_dir.is_dir():
        info = _gather_local_info(get_audio_files(album_dir, list(exts)))
        if not info.get("artist"):
            info["artist"] = artist_name
        if not info.get("album"):
            info["album"] = clean_album
        return info

    return {
        "artist": artist_name,
        "album": clean_album,
        "track_count": len(tracks_db) or album.get("track_count", 0),
        "tracks": [
            {
                "title": track.get("title", ""),
                "length_sec": int(track.get("duration") or 0),
                "tracknumber": str(track.get("track_number", "")),
                "filename": track.get("filename", ""),
            }
            for track in tracks_db
        ],
        "total_length": sum(int(track.get("duration") or 0) for track in tracks_db),
    }


def _find_best_album_release(
    artist_name: str,
    clean_album: str,
    track_count: int,
    local_info: dict,
    max_candidates: int,
) -> tuple[dict | None, int]:
    from crate.matcher import _get_release_detail, _score_match, _search_musicbrainz

    wait_for_provider_slot("musicbrainz", 1.1)
    candidates = _search_musicbrainz(artist_name, clean_album, track_count)
    if not candidates:
        return None, 0

    best_release = None
    best_score = 0
    for candidate in candidates[:max_candidates]:
        wait_for_provider_slot("musicbrainz", 1.1)
        release = _get_release_detail(candidate["mbid"])
        if not release:
            continue
        score = _score_match(local_info, release)
        if score > best_score:
            best_score = score
            best_release = release

    return best_release, best_score


def _auto_apply_album_release(
    task_id: str,
    album_dir: Path | None,
    artist_name: str,
    clean_album: str,
    exts: set[str],
    release: dict,
    score: int,
) -> bool:
    if not album_dir or not album_dir.is_dir():
        return False

    try:
        from crate.matcher import apply_match

        apply_result = apply_match(album_dir, exts, release)
        log.info(
            "Auto-applied MB tags for %s/%s (score=%d, updated=%d)",
            artist_name,
            clean_album,
            score,
            apply_result.get("updated", 0),
        )
        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Auto-applied tags: {artist_name}/{clean_album} (score {score}%)"
            },
        )
        return True
    except Exception:
        log.warning(
            "Auto-apply failed for %s/%s", artist_name, clean_album, exc_info=True
        )
        return False


def _persist_album_release_mbids(
    album_id: int, tracks_db: Sequence[Mapping[str, Any]], release: dict
) -> None:
    _db_persist_album_release_mbids(album_id, tracks_db, release)


def _backfill_known_release_group_types(
    albums: Sequence[Mapping[str, Any]],
    *,
    dates_only: bool = False,
) -> set[int]:
    from crate.musicbrainz_ext import get_artist_releases

    by_artist_mbid: dict[str, list[Mapping[str, Any]]] = {}
    for album in albums:
        artist_mbid = str(album.get("artist_mbid") or "").strip()
        release_group_id = str(album.get("musicbrainz_releasegroupid") or "").strip()
        if artist_mbid and release_group_id:
            by_artist_mbid.setdefault(artist_mbid, []).append(album)

    updates: list[dict[str, Any]] = []
    for artist_mbid, artist_albums in by_artist_mbid.items():
        try:
            release_groups = {
                str(release.get("mbid") or ""): release
                for release in get_artist_releases(artist_mbid)
                if release.get("mbid")
            }
        except Exception:
            log.warning(
                "MusicBrainz release-group backfill failed for artist %s",
                artist_mbid,
                exc_info=True,
            )
            continue
        for album in artist_albums:
            release = release_groups.get(
                str(album.get("musicbrainz_releasegroupid") or "")
            )
            if not release:
                continue
            release_date = normalize_release_date(release.get("first_release_date"))
            if dates_only:
                if not release_date:
                    continue
                updates.append({"id": int(album["id"]), "release_date": release_date})
                continue
            if not release.get("type") and not release_date:
                continue
            update: dict[str, Any] = {"id": int(album["id"])}
            if release.get("type"):
                update.update(
                    {
                        "release_group_primary_type": release["type"],
                        "release_group_secondary_types": list(
                            release.get("secondary_types") or []
                        ),
                    }
                )
            if release_date:
                update["release_date"] = release_date
            updates.append(update)

    persist_album_release_group_types(updates)
    return {int(update["id"]) for update in updates}


def _persist_existing_release_group_types(album_id: int, release: dict) -> bool:
    primary_type = release.get("release_group_primary_type")
    secondary_types = list(release.get("release_group_secondary_types") or [])
    release_group_id = str(release.get("release_group_id") or "").strip()
    release_date = normalize_release_date(release.get("first_release_date"))
    if not primary_type and not secondary_types and not release_date:
        return False

    update = {
        "id": int(album_id),
        "musicbrainz_releasegroupid": release_group_id,
        "release_group_primary_type": primary_type,
        "release_group_secondary_types": secondary_types,
    }
    if release_date:
        update["release_date"] = release_date
    persist_album_release_group_types([update])
    return True


def _broadcast_release_metadata_invalidation() -> None:
    from crate.api.cache_events import broadcast_invalidation

    broadcast_invalidation("library", "home", "global_catalog")


def _write_album_release_tags(
    tracks_db: Sequence[Mapping[str, Any]], release: dict
) -> None:
    import mutagen

    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    mb_tracks = release.get("tracks", [])

    for index, db_track in enumerate(tracks_db):
        if index >= len(mb_tracks):
            break
        mb_track = mb_tracks[index]
        track_mbid = mb_track.get("mbid", "")
        track_path = db_track.get("path", "")
        if not track_path or not Path(track_path).is_file():
            continue
        try:
            audio = getattr(mutagen, "File")(track_path, easy=True)
            if audio is None:
                continue
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


def _sync_album_after_auto_apply(
    album_name: str, artist_name: str, album_dir: Path | None, config: dict
) -> None:
    if not album_dir or not album_dir.is_dir():
        return
    try:
        from crate.library_sync import LibrarySync

        syncer = LibrarySync(config)
        syncer.sync_album(album_dir, artist_name)
    except Exception:
        log.warning("Re-sync after auto-apply failed for %s", album_name, exc_info=True)


def _handle_enrich_artists(task_id: str, params: dict, config: dict) -> dict:
    from crate.enrichment import enrich_artist

    artist_names = [
        str(name).strip() for name in (params.get("artists") or []) if str(name).strip()
    ]
    if artist_names:
        total = len(artist_names)
    else:
        all_artists, total = get_library_artists(per_page=10000)
        artist_names = [artist["name"] for artist in all_artists]

        try:
            chunk_size = int(
                params.get("chunk_size")
                or get_setting(
                    "enrich_artists_chunk_size", str(ENRICH_ARTISTS_CHUNK_SIZE)
                )
                or str(ENRICH_ARTISTS_CHUNK_SIZE)
            )
        except (TypeError, ValueError):
            chunk_size = ENRICH_ARTISTS_CHUNK_SIZE
        chunk_size = max(1, min(chunk_size, 100))
        if total > chunk_size and not params.get("_chunk"):
            from crate.db.repositories.tasks import create_task

            chunks = [
                artist_names[index : index + chunk_size]
                for index in range(0, total, chunk_size)
            ]
            emit_task_event(
                task_id,
                "info",
                {
                    "message": f"Dispatching enrichment for {total} artists in {len(chunks)} chunks"
                },
            )
            for index, chunk in enumerate(chunks):
                chunk_params = {
                    "artists": chunk,
                    "_chunk": True,
                    "chunk_index": index,
                    "total_chunks": len(chunks),
                }
                if params.get("force"):
                    chunk_params["force"] = True
                create_task("enrich_artists", chunk_params, parent_task_id=task_id)

            p = TaskProgress(
                phase="dispatched", phase_count=1, total=len(chunks), done=0
            )
            p.item = f"0/{len(chunks)} chunks"
            emit_progress(task_id, p, force=True)
            return {"_delegated": True, "chunks": len(chunks), "artists": total}

    enriched = 0
    skipped = 0

    p = TaskProgress(phase="enriching", phase_count=1, total=total)

    for index, name in enumerate(artist_names):
        if is_cancelled(task_id):
            break

        p.done = index + 1
        p.item = entity_label(artist=name)
        emit_progress(task_id, p)

        result = enrich_artist(name, config, force=bool(params.get("force", False)))
        if result.get("skipped"):
            skipped += 1
            emit_item_event(
                task_id, level="info", message=f"Skipped: {name}", artist=name
            )
        else:
            enriched += 1
            emit_item_event(
                task_id, level="info", message=f"Enriched: {name}", artist=name
            )

    return {"enriched": enriched, "skipped": skipped, "total": total}


def _handle_enrich_single(task_id: str, params: dict, config: dict) -> dict:
    """Enrich a single artist: all sources + photo + persist to DB."""
    from crate.enrichment import enrich_artist

    name = params.get("artist", "")
    if not name:
        return {"error": "No artist specified"}

    p = TaskProgress(
        phase="enriching", phase_count=1, total=1, item=entity_label(artist=name)
    )
    emit_progress(task_id, p)
    result = enrich_artist(name, config, force=True)
    p.done = 1
    emit_progress(task_id, p, force=True)
    emit_item_event(task_id, level="info", message=f"Enriched: {name}", artist=name)
    return result


def _handle_reset_enrichment(task_id: str, params: dict, config: dict) -> dict:
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
                log.debug("Failed to delete photo %s", photo_path, exc_info=True)

    emit_task_event(task_id, "info", {"message": f"Reset enrichment for: {name}"})
    log_audit("reset_enrichment", "artist", name, task_id=task_id)

    result = _handle_enrich_single(task_id, {"artist": name}, config)
    return {"reset": name, "enrichment": result}


def _emit_lyrics_track_event(task_id: str, data: dict) -> None:
    if data.get("event") != "track_done":
        return
    status = str(data.get("status") or "none")
    title = str(data.get("title") or "")
    artist = str(data.get("artist") or "")
    payload = {
        "message": f"Lyrics {status.upper()} for {entity_label(artist=artist, title=title)}",
        "track_id": data.get("track_id"),
        "track_entity_uid": data.get("track_entity_uid"),
        "album_id": data.get("album_id"),
        "artist": artist,
        "album": data.get("album"),
        "title": title,
        "path": data.get("path"),
        "status": status,
        "found": bool(data.get("found")),
        "has_plain": bool(data.get("has_plain")),
        "has_synced": bool(data.get("has_synced")),
        "provider": data.get("provider") or "lrclib",
        "updated_at": data.get("updated_at"),
        "source": data.get("source"),
        "skipped": bool(data.get("skipped")),
        "error": bool(data.get("error")),
        "done": data.get("done"),
        "total": data.get("total"),
        "index": data.get("index"),
        "lyrics": {
            "status": status,
            "found": bool(data.get("found")),
            "has_plain": bool(data.get("has_plain")),
            "has_synced": bool(data.get("has_synced")),
            "provider": data.get("provider") or "lrclib",
            "updated_at": data.get("updated_at"),
        },
    }
    emit_task_event(task_id, "lyrics_track", payload)


def _handle_sync_lyrics(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.queries.lyrics import list_tracks_for_lyrics
    from crate.lyrics import sync_lyrics_for_tracks

    artist = params.get("artist")
    album_id = params.get("album_id")
    album_entity_uid = params.get("album_entity_uid")
    track_id = params.get("track_id")
    track_entity_uid = params.get("track_entity_uid")
    force = bool(params.get("force", False))
    limit = int(params.get("limit") or 500)
    delay_seconds = float(params.get("delay_seconds", 0.2))
    album_id = int(album_id) if album_id is not None else None
    track_id = int(track_id) if track_id is not None else None

    tracks = list_tracks_for_lyrics(
        artist=artist,
        album_id=album_id,
        album_entity_uid=str(album_entity_uid) if album_entity_uid else None,
        track_id=track_id,
        track_entity_uid=str(track_entity_uid) if track_entity_uid else None,
        limit=limit,
        only_missing=not force,
    )
    progress = TaskProgress(phase="lyrics", phase_count=1, total=len(tracks))
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Syncing lyrics for {len(tracks)} tracks",
            "artist": artist,
            "album_id": album_id,
            "album_entity_uid": album_entity_uid,
            "track_id": track_id,
            "track_entity_uid": track_entity_uid,
            "force": force,
        },
    )

    def _lyrics_progress(data: dict) -> None:
        progress.done = data.get("done", progress.done)
        progress.total = data.get("total", progress.total)
        progress.item = entity_label(
            artist=data.get("artist", ""),
            title=data.get("title", ""),
        )
        emit_progress(task_id, progress)
        _emit_lyrics_track_event(task_id, data)

    result = sync_lyrics_for_tracks(
        tracks,
        force=force,
        delay_seconds=delay_seconds,
        progress_callback=_lyrics_progress,
        cancel_callback=lambda: is_cancelled(task_id),
    )
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Lyrics sync complete: {result.get('found', 0)} found, {result.get('missing', 0)} missing",
            "result": result,
        },
    )
    return result


def _handle_enrich_mbids(task_id: str, params: dict, config: dict) -> dict:
    """Enrich albums and tracks with MusicBrainz IDs."""
    exts = DEFAULT_AUDIO_EXTENSIONS
    artist_filter = params.get("artist")
    min_score = params.get("min_score", 70)
    release_types_only = bool(params.get("release_types_only"))
    release_dates_only = bool(params.get("release_dates_only"))

    if artist_filter:
        albums = get_library_albums(artist_filter)
    else:
        albums = get_albums_needing_release_metadata()
    if release_types_only:
        albums = [
            album
            for album in albums
            if album.get("musicbrainz_albumid")
            or album.get("musicbrainz_releasegroupid")
        ]
    if release_dates_only:
        albums = [
            album
            for album in albums
            if not normalize_release_date(album.get("release_date"))
        ]

    total = len(albums)
    enriched = 0
    skipped = 0
    failed = 0
    if release_dates_only:
        type_backfilled_ids = _backfill_known_release_group_types(
            albums, dates_only=True
        )
    else:
        type_backfilled_ids = _backfill_known_release_group_types(albums)

    p = TaskProgress(phase="matching_mbids", phase_count=1, total=total)

    for index, album in enumerate(albums):
        if is_cancelled(task_id):
            break

        album_name = album.get("tag_album") or album.get("name", "")
        artist_name = album.get("artist", "")
        album_path = album.get("path", "")

        existing_mbid = album.get("musicbrainz_albumid")
        existing_primary_type = album.get("release_group_primary_type")
        existing_release_date = normalize_release_date(album.get("release_date"))
        may_have_stale_short_form = _may_have_stale_short_form_release(album)
        if album["id"] in type_backfilled_ids or (
            existing_mbid
            and existing_mbid.strip()
            and existing_primary_type
            and existing_release_date
        ):
            if not may_have_stale_short_form:
                if release_dates_only:
                    enriched += 1
                else:
                    skipped += 1
                continue

        if release_dates_only and not existing_mbid:
            failed += 1
            continue

        if release_types_only and not existing_mbid:
            failed += 1
            continue

        p.done = index
        p.item = entity_label(artist=artist_name, album=album_name)
        emit_progress(task_id, p)

        if existing_mbid and existing_mbid.strip():
            from crate.matcher import _get_release_detail

            wait_for_provider_slot("musicbrainz", 1.1)
            existing_release = _get_release_detail(existing_mbid.strip())
            if not existing_release:
                failed += 1
                continue
            if not _existing_release_is_incompatible(album, existing_release):
                if _persist_existing_release_group_types(
                    int(album["id"]), existing_release
                ):
                    enriched += 1
                else:
                    failed += 1
                continue
            existing_mbid = None

        clean_album = _clean_album_lookup_name(album_name)
        tracks_db = get_library_tracks(album["id"]) if "id" in album else []
        track_count = len(tracks_db) or album.get("track_count", 0)

        album_dir = Path(album_path) if album_path else None
        local_info = _build_album_match_local_info(
            album,
            artist_name,
            clean_album,
            tracks_db,
            exts,
        )
        best_release, best_score = _find_best_album_release(
            artist_name,
            clean_album,
            track_count,
            local_info,
            max_candidates=3,
        )

        if not best_release or best_score < min_score:
            failed += 1
            continue

        auto_apply_threshold = int(get_setting("mb_auto_apply_threshold", "95") or "95")
        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            _auto_apply_album_release(
                task_id,
                album_dir,
                artist_name,
                clean_album,
                exts,
                best_release,
                best_score,
            )

        _persist_album_release_mbids(album["id"], tracks_db, best_release)

        if best_score < auto_apply_threshold:
            _write_album_release_tags(tracks_db, best_release)

        if best_score >= auto_apply_threshold and album_dir and album_dir.is_dir():
            _sync_album_after_auto_apply(album_name, artist_name, album_dir, config)

        enriched += 1
        emit_task_event(
            task_id,
            "album_matched",
            {
                "message": f"Matched: {artist_name} / {clean_album} (score {best_score}%)",
                "artist": artist_name,
                "album": clean_album,
                "mbid": best_release["mbid"],
                "score": best_score,
            },
        )
        log.info(
            "Enriched %s / %s (score=%d, mbid=%s)",
            artist_name,
            clean_album,
            best_score,
            best_release["mbid"],
        )

    result = {
        "enriched": enriched,
        "skipped": skipped,
        "failed": failed,
        "total": total,
    }
    if release_dates_only:
        result["matched"] = enriched
        result["unresolved"] = failed
    if release_dates_only or release_types_only:
        _broadcast_release_metadata_invalidation()
    return result


def _reorganize_artist_folders(
    artist_name: str, lib: Path, config: dict, task_id: str | None = None
):
    """Move album folders to Artist/Year/Album structure if not already organized."""
    import re as _re

    from crate.audio import get_audio_files, read_tags

    artist_row = get_library_artist(artist_name)
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist_name, existing_only=True
    )
    if artist_row and looks_like_entity_uid(str(artist_row.get("folder_name") or "")):
        log.info(
            "Skip folder reorganization for managed-storage artist %s", artist_name
        )
        return
    if not artist_dir or not artist_dir.is_dir():
        return
    if any(
        looks_like_entity_uid(part.name)
        for part in artist_dir.iterdir()
        if part.is_dir()
    ):
        log.info(
            "Skip folder reorganization for %s because managed-storage album dirs were detected",
            artist_name,
        )
        return

    year_prefix_re = _re.compile(r"^(\d{4})\s*[-–]\s*(.+)$")
    exts = DEFAULT_AUDIO_EXTENSIONS
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
            log.warning(
                "Cannot reorganize %s: target %s already exists", subdir, target
            )
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(subdir), str(target))
            old_path = str(subdir)
            new_path = str(target)
            update_album_path_after_reorganize(old_path, new_path, clean_name)
            moved += 1
            log.info("Reorganized: %s -> %s", subdir.name, f"{year}/{clean_name}")
            if task_id:
                emit_task_event(
                    task_id,
                    "info",
                    {"message": f"Moved {subdir.name} -> {year}/{clean_name}"},
                )
        except Exception:
            log.warning("Failed to reorganize %s", subdir, exc_info=True)

    if moved:
        log.info("Reorganized %d album folders for %s", moved, artist_name)


def _process_new_content_organize_folders(
    task_id: str,
    result: dict,
    artist_name: str,
    lib: Path,
    config: dict,
    p: TaskProgress,
) -> None:
    p.phase = "organize_folders"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        _reorganize_artist_folders(artist_name, lib, config, task_id)
        result["steps"]["organize_folders"] = True
    except Exception:
        log.warning("Folder reorganization failed for %s", artist_name, exc_info=True)
        result["steps"]["organize_folders"] = "failed"


def _process_new_content_enrich_artist(
    task_id: str,
    result: dict,
    artist_name: str,
    config: dict,
    p: TaskProgress,
    *,
    force: bool = False,
) -> None:
    from crate.enrichment import enrich_artist

    p.phase = "enrich_artist"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        enrich_result = enrich_artist(artist_name, config, force=force)
        result["steps"]["enrich_artist"] = enrich_result.get("skipped", False)
        emit_task_event(
            task_id,
            "step_done",
            {
                "message": f"Enriched: {artist_name}",
                "step": "enrich_artist",
                "result": enrich_result,
            },
        )
    except Exception:
        log.warning("Enrich artist failed for %s", artist_name, exc_info=True)
        result["steps"]["enrich_artist"] = "failed"


def _get_album_tracks_cached(album: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
    cached = album.get("_tracks")
    if isinstance(cached, list):
        return cached
    return get_library_tracks(int(album["id"]))


def _process_new_content_album_genres(
    task_id: str,
    result: dict,
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> Sequence[Mapping[str, Any]]:
    from crate.db.queries.browse_artist import get_artist_genre_profile
    from crate.genre_indexer import derive_album_genres

    albums: Sequence[Mapping[str, Any]] = []
    p.phase = "album_genres"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        albums = get_library_albums(artist_name)
        artist_profile = get_artist_genre_profile(artist_name, limit=8)
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks = _get_album_tracks_cached(album)
            track_genres = [
                str(genre) for track in tracks if (genre := track.get("genre"))
            ]
            genres = derive_album_genres(
                album.get("genre"),
                track_genres,
                artist_profile=artist_profile,
            )
            if genres:
                set_album_genres(album["id"], genres)
        result["steps"]["album_genres"] = True
    except Exception:
        log.warning("Album genre indexing failed", exc_info=True)
        result["steps"]["album_genres"] = "failed"
    return albums


def _process_new_content_album_mbids(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    config: dict,
    p: TaskProgress,
) -> None:
    p.phase = "album_mbid"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        exts = DEFAULT_AUDIO_EXTENSIONS
        mbid_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            existing_mbid = album.get("musicbrainz_albumid")
            if (
                existing_mbid
                and existing_mbid.strip()
                and album.get("release_group_primary_type")
                and normalize_release_date(album.get("release_date"))
                and not _may_have_stale_short_form_release(album)
            ):
                continue

            if existing_mbid and existing_mbid.strip():
                from crate.matcher import _get_release_detail

                wait_for_provider_slot("musicbrainz", 1.1)
                existing_release = _get_release_detail(existing_mbid.strip())
                if not existing_release:
                    continue
                if not _existing_release_is_incompatible(album, existing_release):
                    if _persist_existing_release_group_types(
                        int(album["id"]), existing_release
                    ):
                        mbid_count += 1
                    continue

            clean_name = _clean_album_lookup_name(
                album.get("tag_album") or album["name"]
            )
            tracks_db = _get_album_tracks_cached(album)
            track_count = int(album.get("track_count") or 0)
            local_info = _build_album_match_local_info(
                album,
                artist_name,
                clean_name,
                tracks_db,
                exts,
            )
            best_release, best_score = _find_best_album_release(
                artist_name,
                clean_name,
                track_count,
                local_info,
                max_candidates=5,
            )

            if best_release and best_score >= 70:
                _persist_album_release_mbids(
                    int(album["id"]),
                    tracks_db,
                    best_release,
                )
                mbid_count += 1

        result["steps"]["album_mbid"] = mbid_count
    except Exception:
        log.warning("Album MBID lookup failed", exc_info=True)
        result["steps"]["album_mbid"] = "failed"


def _process_new_content_bandcamp_urls(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    p.phase = "bandcamp_urls"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    updated = 0
    checked = 0
    try:
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            if album.get("bandcamp_url") or not album.get("entity_uid"):
                continue
            checked += 1
            clean_name = _clean_album_lookup_name(
                str(album.get("tag_album") or album["name"])
            )
            try:
                url = find_exact_album_url(
                    artist_name,
                    clean_name,
                    allow_search=False,
                )
            except BandcampSearchError:
                log.debug(
                    "Bandcamp album URL lookup failed for %s - %s",
                    artist_name,
                    clean_name,
                    exc_info=True,
                )
                continue
            if url and set_library_entity_bandcamp_url(
                entity_type="album",
                entity_uid=str(album["entity_uid"]),
                url=url,
                source="bandcamp:public_search",
            ):
                updated += 1
        result["steps"]["bandcamp_urls"] = {
            "checked": checked,
            "updated": updated,
        }
    except Exception:
        log.warning("Bandcamp URL enrichment failed", exc_info=True)
        result["steps"]["bandcamp_urls"] = "failed"


def _process_new_content_popularity(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    from crate.popularity import (
        _lastfm_get,
        _normalize_popularity,
        _parse_int,
        refresh_artist_track_popularity_signals,
    )

    p.phase = "popularity"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        pop_count = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_name = _clean_album_lookup_name(
                album.get("tag_album") or album["name"]
            )
            wait_for_provider_slot("lastfm", 0.25)
            data = _lastfm_get(
                "album.getinfo", artist=artist_name, album=album_name, autocorrect="1"
            )
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    update_album_popularity(album["id"], listeners, playcount)
                    pop_count += 1

        refresh_result = refresh_artist_track_popularity_signals(artist_name)
        track_pop = int(refresh_result.get("lastfm_matches", 0))
        spotify_track_pop = int(refresh_result.get("spotify_matches", 0))

        _normalize_popularity([artist_name])
        _invalidate_artist_top_tracks_cache(artist_name)
        result["steps"]["popularity"] = {
            "albums": pop_count,
            "lastfm_track_matches": track_pop,
            "spotify_track_matches": spotify_track_pop,
        }
    except Exception:
        log.warning("Popularity failed", exc_info=True)
        result["steps"]["popularity"] = "failed"


def _process_new_content_missing_covers(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    import requests as _requests

    from crate.artwork import fetch_cover_from_caa, save_cover

    p.phase = "covers"
    p.phase_index += 1
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        covers_fetched = 0
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            album_dir = Path(album["path"]) if album.get("path") else None
            if not album_dir or not album_dir.is_dir():
                continue
            if any(
                (album_dir / candidate).exists()
                for candidate in ("cover.jpg", "cover.png", "folder.jpg")
            ):
                continue

            cover_data = None
            mbid = album.get("musicbrainz_albumid")
            if mbid and mbid.strip():
                wait_for_provider_slot("coverartarchive", 0.3)
                cover_data = fetch_cover_from_caa(mbid)

            if not cover_data:
                try:
                    album_name = _clean_album_lookup_name(
                        album.get("tag_album") or album["name"]
                    )
                    wait_for_provider_slot("deezer", 0.3)
                    resp = _requests.get(
                        "https://api.deezer.com/search/album",
                        params={"q": f"{artist_name} {album_name}", "limit": 1},
                        timeout=10,
                    )
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        if data and data[0].get("cover_xl"):
                            wait_for_provider_slot("deezer", 0.3)
                            img_resp = _requests.get(data[0]["cover_xl"], timeout=10)
                            if (
                                img_resp.status_code == 200
                                and len(img_resp.content) > 1000
                            ):
                                cover_data = img_resp.content
                except Exception:
                    log.debug(
                        "Failed to fetch Deezer cover for %s / %s",
                        artist_name,
                        album_name,
                        exc_info=True,
                    )

            if cover_data:
                save_cover(album_dir, cover_data)
                covers_fetched += 1
                update_album_has_cover(album["id"])
                if album.get("entity_uid"):
                    queue_artwork_materialization(
                        ArtworkAsset("album-cover", str(album["entity_uid"])),
                        reason="source-write",
                    )

        result["steps"]["covers"] = covers_fetched
    except Exception:
        log.warning("Cover fetching failed", exc_info=True)
        result["steps"]["covers"] = "failed"


def _process_new_content_portable_metadata(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    params: dict,
    p: TaskProgress,
) -> None:
    from crate.db.queries.portable_metadata import get_portable_album_payload
    from crate.db.repositories.portable_metadata import mark_album_portable_metadata
    from crate.portable_metadata import write_album_portable_metadata

    p.phase = "portable_metadata"
    p.phase_index += 1
    p.done = 0
    p.total = 0
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        albums_written = 0
        tags_written = 0
        tag_errors = 0
        write_audio_tags = bool(params.get("write_portable_audio_tags", True))
        write_sidecars = bool(params.get("write_portable_sidecars", True))
        target_albums = [
            album
            for album in albums
            if not album_folder or album.get("name") == album_folder
        ]
        p.total = len(target_albums)
        for index, album in enumerate(target_albums, start=1):
            if is_cancelled(task_id):
                break
            p.done = index - 1
            p.item = entity_label(artist=artist_name, album=album.get("name", ""))
            emit_progress(task_id, p)
            payload = get_portable_album_payload(int(album["id"]))
            if not payload:
                continue
            write_result = write_album_portable_metadata(
                payload,
                write_audio_tags=write_audio_tags,
                write_sidecars=write_sidecars,
            )
            mark_album_portable_metadata(
                album_id=write_result.get("album_id"),
                album_entity_uid=write_result.get("album_entity_uid"),
                sidecar_path=write_result.get("sidecar_path"),
                tracks=write_result.get("tracks") or 0,
                tags_written=write_result.get("tags_written") or 0,
                tag_errors=len(write_result.get("tag_errors") or []),
                wrote_sidecar=write_sidecars and bool(write_result.get("sidecar_path")),
                wrote_audio_tags=write_audio_tags,
            )
            albums_written += 1
            tags_written += int(write_result.get("tags_written") or 0)
            tag_errors += len(write_result.get("tag_errors") or [])
        p.done = p.total
        emit_progress(task_id, p, force=True)
        result["steps"]["portable_metadata"] = {
            "albums": albums_written,
            "tags_written": tags_written,
            "tag_errors": tag_errors,
        }
    except Exception:
        log.warning("Portable metadata write failed for %s", artist_name, exc_info=True)
        result["steps"]["portable_metadata"] = "failed"


def _process_new_content_lyrics(
    task_id: str,
    result: dict,
    albums: Sequence[Mapping[str, Any]],
    artist_name: str,
    album_folder: str,
    p: TaskProgress,
) -> None:
    from crate.lyrics import sync_lyrics_for_tracks

    p.phase = "lyrics"
    p.phase_index += 1
    p.done = 0
    p.total = 0
    p.item = entity_label(artist=artist_name)
    emit_progress(task_id, p, force=True)
    try:
        tracks: list[dict[str, Any]] = []
        for album in albums:
            if album_folder and album["name"] != album_folder:
                continue
            tracks.extend(dict(track) for track in _get_album_tracks_cached(album))

        def _lyrics_progress(data: dict) -> None:
            p.done = data.get("done", p.done)
            p.total = data.get("total", p.total)
            p.item = entity_label(
                artist=data.get("artist") or artist_name,
                title=data.get("title", ""),
            )
            emit_progress(task_id, p)
            _emit_lyrics_track_event(task_id, data)

        sync_result = sync_lyrics_for_tracks(
            tracks,
            force=False,
            delay_seconds=0.2,
            progress_callback=_lyrics_progress,
            cancel_callback=lambda: is_cancelled(task_id),
        )
        result["steps"]["lyrics"] = sync_result
        emit_task_event(
            task_id,
            "step_done",
            {
                "message": (
                    f"Lyrics synced: {sync_result.get('found', 0)} found, "
                    f"{sync_result.get('missing', 0)} missing"
                ),
                "step": "lyrics",
                "result": sync_result,
            },
        )
    except Exception:
        log.warning("Lyrics sync failed for %s", artist_name, exc_info=True)
        result["steps"]["lyrics"] = "failed"


def _process_new_content_audio_fingerprints(
    task_id: str,
    result: dict,
    artist_name: str,
    album_folder: str,
) -> None:
    try:
        from crate.db.repositories.tasks import create_task_dedup

        params = {"artist": artist_name, "limit": 1000}
        if album_folder:
            params["album"] = album_folder
        child_task_id = create_task_dedup(
            "backfill_track_audio_fingerprints",
            params,
            dedup_key=f"fingerprints:{artist_name.lower()}:{album_folder.lower()}",
        )
        result["steps"]["audio_fingerprints"] = (
            "queued" if child_task_id else "deduplicated"
        )
        if child_task_id:
            emit_task_event(
                task_id,
                "info",
                {
                    "message": "Queued audio fingerprint backfill",
                    "child_task_id": child_task_id,
                },
            )
    except Exception:
        log.debug(
            "Failed to queue audio fingerprint backfill for %s",
            artist_name,
            exc_info=True,
        )
        result["steps"]["audio_fingerprints"] = "failed"


def _process_new_content_update_artist_hash(artist_dir: Path, artist_name: str) -> None:
    if not artist_dir.is_dir():
        return

    final_hash = _compute_dir_hash(artist_dir)
    update_artist_content_hash(artist_name, final_hash)


def _process_new_content_refresh_artist_summary(artist_name: str, config: dict) -> None:
    if not artist_name:
        return
    try:
        from crate.library_sync import LibrarySync

        lib = Path(config["library_path"])
        artist_row = get_library_artist(artist_name)
        folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
        artist_dir = lib / folder
        if artist_dir.is_dir():
            LibrarySync(config).refresh_artist_summary(artist_name, [artist_dir])
    except Exception:
        log.warning(
            "Failed to refresh artist summary after process_new_content for %s",
            artist_name,
            exc_info=True,
        )


def _handle_process_new_content(task_id: str, params: dict, config: dict) -> dict:
    """Full pipeline for new content: enrich artist + index genres + analyze audio + bliss."""
    artist_name = str(params.get("artist", "") or "").strip()
    album_folder = params.get("album", "")
    if not artist_name or artist_name.startswith("."):
        return {
            "artist": artist_name,
            "album": album_folder,
            "skipped": True,
            "reason": "hidden_library_path",
        }

    _mark_processing(artist_name)
    try:
        return _process_new_content_inner(
            task_id, params, config, artist_name, album_folder
        )
    finally:
        _process_new_content_refresh_artist_summary(artist_name, config)
        _unmark_processing(artist_name)


def _process_new_content_inner(
    task_id: str, params: dict, config: dict, artist_name: str, album_folder: str
) -> dict:
    lib = Path(config["library_path"])
    result = {"artist": artist_name, "album": album_folder, "steps": {}}

    artist_row = get_library_artist(artist_name)
    folder = (artist_row.get("folder_name") if artist_row else None) or artist_name
    force = params.get("force", False)
    artist_dir = lib / folder
    if artist_dir.is_dir() and not force:
        new_hash = _compute_dir_hash(artist_dir)
        old_hash = artist_row.get("content_hash") if artist_row else None
        if old_hash and new_hash == old_hash:
            log.info(
                "Skipping %s - content unchanged (hash: %s)", artist_name, new_hash[:12]
            )
            return {
                "artist": artist_name,
                "skipped": True,
                "reason": "content_unchanged",
            }

    # Ensure artist content is synced (may be missing after migration or fresh download)
    if artist_dir.is_dir():
        try:
            from crate.library_sync import LibrarySync

            sync = LibrarySync(config)
            sync.sync_artist(artist_dir)
        except Exception:
            log.warning("Pre-enrichment sync failed for %s", artist_name, exc_info=True)

    p = TaskProgress(
        phase="starting", phase_count=8, total=1, item=entity_label(artist=artist_name)
    )
    emit_progress(task_id, p, force=True)

    _process_new_content_organize_folders(task_id, result, artist_name, lib, config, p)
    _process_new_content_enrich_artist(
        task_id, result, artist_name, config, p, force=bool(force)
    )
    albums = _process_new_content_album_genres(
        task_id, result, artist_name, album_folder, p
    )
    _process_new_content_album_mbids(
        task_id, result, albums, artist_name, album_folder, config, p
    )
    _process_new_content_bandcamp_urls(
        task_id, result, albums, artist_name, album_folder, p
    )
    _process_new_content_lyrics(task_id, result, albums, artist_name, album_folder, p)

    # Audio analysis and bliss are handled by background daemons (analysis_daemon.py).
    # New tracks enter library_tracks with analysis_state='pending' and bliss_state='pending'
    # and are picked up automatically. No need to enqueue anything here.
    result["steps"]["audio_analysis"] = "background_daemon"
    result["steps"]["bliss"] = "background_daemon"
    _process_new_content_audio_fingerprints(task_id, result, artist_name, album_folder)

    _process_new_content_popularity(
        task_id, result, albums, artist_name, album_folder, p
    )
    _process_new_content_missing_covers(
        task_id, result, albums, artist_name, album_folder, p
    )
    _process_new_content_portable_metadata(
        task_id, result, albums, artist_name, album_folder, params, p
    )
    _process_new_content_update_artist_hash(artist_dir, artist_name)

    # Notify connected clients to refresh cached library data.
    # Worker runs in a separate process — POST to the API to broadcast.
    try:
        import requests as _req

        _artist_row = get_library_artist(artist_name)
        _scopes = ["library"]
        if _artist_row and _artist_row.get("id"):
            _scopes.append(f"artist:{_artist_row['id']}")
        _req.post(
            "http://crate-api:8585/api/cache/invalidate",
            json={"scopes": _scopes},
            timeout=3,
        )
    except Exception:
        pass  # Cache invalidation is best-effort

    return result


def _fetch_completeness_musicbrainz(mbid: str, artist_name: str) -> dict | None:
    """Fetch the paginated album release groups for one artist."""
    import musicbrainzngs

    musicbrainzngs.set_useragent("crate", "1.0", "https://github.com/crate")
    wait_for_provider_slot("musicbrainz", 1.1)
    mb_artist = musicbrainzngs.get_artist_by_id(mbid)["artist"]
    mb_name = mb_artist.get("name", "")
    from thefuzz import fuzz

    if fuzz.ratio(artist_name.lower(), mb_name.lower()) < 70:
        log.warning("MBID mismatch: %s -> %s, skipping", mbid, mb_name)
        return None

    all_albums: list[dict] = []
    total_count = 0
    offset = 0
    complete = False
    for _page in range(COMPLETENESS_MAX_MUSICBRAINZ_PAGES):
        wait_for_provider_slot("musicbrainz", 1.1)
        response = musicbrainzngs.browse_release_groups(
            artist=mbid,
            release_type=["album"],
            limit=100,
            offset=offset,
        )
        release_groups = response.get("release-group-list", [])
        total_count = int(response.get("release-group-count", total_count))
        all_albums.extend(
            {
                "title": group.get("title", ""),
                "type": group.get("primary-type", ""),
                "year": group.get("first-release-date", "")[:4]
                if group.get("first-release-date")
                else "",
            }
            for group in release_groups
        )
        if not release_groups or offset + len(release_groups) >= total_count:
            complete = True
            break
        offset += len(release_groups)

    if total_count and not complete:
        raise RuntimeError(
            f"MusicBrainz release-group pagination exceeded "
            f"{COMPLETENESS_MAX_MUSICBRAINZ_PAGES} pages for {mbid}"
        )

    return {"count": total_count or len(all_albums), "albums": all_albums}


def _compute_completeness_for_artists(
    task_id: str, artists: list[dict], config: dict
) -> dict:
    del config
    import re

    artist_names = [str(artist["name"]) for artist in artists]
    local_names_by_artist = get_album_names_for_artists(artist_names)
    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    progress = TaskProgress(phase="completeness", phase_count=1, total=len(artists))
    results: list[dict] = []
    failed = 0

    for index, artist in enumerate(artists):
        if is_cancelled(task_id):
            break
        progress.done = index + 1
        progress.item = entity_label(artist=artist["name"])
        emit_progress(task_id, progress)

        try:
            mb_data = get_cache(
                f"mb:albums:{artist['mbid']}", max_age_seconds=86400 * 7
            )
            if not mb_data:
                mb_data = _fetch_completeness_musicbrainz(
                    artist["mbid"], artist["name"]
                )
                if mb_data is None:
                    failed += 1
                    continue
                set_cache(f"mb:albums:{artist['mbid']}", mb_data, ttl=604800)

            mb_count = int(mb_data.get("count") or 0)
            local_count = int(artist.get("album_count") or 0)
            pct = round(local_count / mb_count * 100) if mb_count > 0 else 100
            local_names = local_names_by_artist.get(artist["name"], set())
            local_clean = {year_re.sub("", name).lower() for name in local_names}
            missing = [
                album
                for album in mb_data.get("albums", [])
                if album["title"].lower() not in local_names
                and album["title"].lower() not in local_clean
            ]

            results.append(
                {
                    "artist_id": artist["id"],
                    "artist_entity_uid": artist.get("entity_uid"),
                    "artist_slug": artist["slug"],
                    "artist": artist["name"],
                    "has_photo": bool(artist.get("has_photo")),
                    "listeners": artist.get("listeners", 0),
                    "local_count": local_count,
                    "mb_count": mb_count,
                    "pct": min(pct, 100),
                    "missing": missing[:10],
                }
            )
        except Exception:
            failed += 1
            log.warning(
                "Completeness check failed for %s", artist["name"], exc_info=True
            )

    return {
        "artists_checked": len(results),
        "total": len(artists),
        "failed_artists": failed,
        "results": results,
    }


def _handle_compute_completeness(task_id: str, params: dict, config: dict) -> dict:
    """Compute library completeness vs MusicBrainz, fanned out by artist chunks."""
    artists = params.get("artists")
    if artists:
        return _compute_completeness_for_artists(task_id, list(artists), config)

    artists = get_artists_with_mbid()
    if not artists:
        set_cache("discover:completeness", [], ttl=86400)
        return {"artists_checked": 0, "total": 0, "results": []}

    try:
        chunk_size = int(params.get("chunk_size") or COMPLETENESS_CHUNK_SIZE)
    except (TypeError, ValueError):
        chunk_size = COMPLETENESS_CHUNK_SIZE
    chunk_size = max(1, min(chunk_size, 100))

    if len(artists) > chunk_size:
        from crate.db.repositories.tasks import create_task

        chunks = [
            artists[index : index + chunk_size]
            for index in range(0, len(artists), chunk_size)
        ]
        emit_task_event(
            task_id,
            "info",
            {
                "message": f"Dispatching completeness for {len(artists)} artists in {len(chunks)} chunks"
            },
        )
        for index, chunk in enumerate(chunks):
            create_task(
                "compute_completeness",
                {
                    "artists": chunk,
                    "_chunk": True,
                    "chunk_index": index,
                    "total_chunks": len(chunks),
                },
                parent_task_id=task_id,
            )
        progress = TaskProgress(
            phase="dispatched", phase_count=1, total=len(chunks), done=0
        )
        progress.item = f"0/{len(chunks)} chunks"
        emit_progress(task_id, progress, force=True)
        return {"_delegated": True, "chunks": len(chunks), "artists": len(artists)}

    result = _compute_completeness_for_artists(task_id, artists, config)
    final = _completeness_finalize_from_results(task_id, result)
    return {**result, **final}


def _completeness_finalize_from_results(task_id: str, result: dict) -> dict:
    """Publish a single-task result using the same rules as fan-in."""
    failed_artists = int(result.get("failed_artists") or 0)
    if failed_artists:
        emit_task_event(
            task_id,
            "warning",
            {
                "message": f"Completeness skipped cache update for {failed_artists} failed artists"
            },
        )
        return {"cache_written": False, "failed_artists": failed_artists}

    results = sorted(result.get("results", []), key=lambda item: item["pct"])
    set_cache("discover:completeness", results, ttl=86400)
    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Completeness computed: {len(results)}/{result.get('total', 0)} artists checked"
        },
    )
    return {"cache_written": True}


def _completeness_finalize(parent_task_id: str) -> dict:
    """Merge completed chunks and publish only a complete aggregate cache."""
    from crate.db.repositories.tasks import get_child_task_results

    children = get_child_task_results(parent_task_id)
    failed_chunks = sum(1 for child in children if child.get("status") != "completed")
    if failed_chunks:
        emit_task_event(
            parent_task_id,
            "warning",
            {"message": f"Completeness finished with {failed_chunks} failed chunks"},
        )
        return {
            "cache_written": False,
            "artists_checked": 0,
            "total": 0,
            "failed_chunks": failed_chunks,
        }

    results: list[dict] = []
    total = 0
    failed_artists = 0
    for child in children:
        result = child.get("result") or {}
        total += int(result.get("total") or 0)
        failed_artists += int(result.get("failed_artists") or 0)
        results.extend(result.get("results") or [])

    if failed_artists:
        emit_task_event(
            parent_task_id,
            "warning",
            {
                "message": f"Completeness skipped cache update for {failed_artists} failed artists"
            },
        )
        return {
            "cache_written": False,
            "artists_checked": len(results),
            "total": total,
            "failed_artists": failed_artists,
        }

    results.sort(key=lambda item: item["pct"])
    set_cache("discover:completeness", results, ttl=86400)
    emit_task_event(
        parent_task_id,
        "info",
        {"message": f"Completeness computed: {len(results)}/{total} artists checked"},
    )
    return {"cache_written": True, "artists_checked": len(results), "total": total}


def _handle_refresh_probable_setlist(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    from crate.api.cache_events import broadcast_invalidation
    from crate.setlistfm import refresh_probable_setlist
    from crate.slugs import build_artist_slug

    artist_name = str(params.get("artist_name") or "").strip()
    if not artist_name:
        raise ValueError("artist_name is required")
    result = refresh_probable_setlist(artist_name)
    broadcast_invalidation("upcoming", f"artist:{build_artist_slug(artist_name)}")
    return result


ENRICHMENT_TASK_HANDLERS: dict[str, TaskHandler] = {
    "enrich_artist": _handle_enrich_single,
    "enrich_artists": _handle_enrich_artists,
    "sync_lyrics": _handle_sync_lyrics,
    "reset_enrichment": _handle_reset_enrichment,
    "enrich_mbids": _handle_enrich_mbids,
    "process_new_content": _handle_process_new_content,
    "compute_completeness": _handle_compute_completeness,
    "refresh_probable_setlist": _handle_refresh_probable_setlist,
}

# Completeness uses the shared analysis fan-in coordinator because its child
# tasks run through the same actor lifecycle as the other chunked workloads.
register_parent_finalizer("compute_completeness", _completeness_finalize)
