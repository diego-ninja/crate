import base64
import hashlib
import io as _io
import logging
import tempfile
import time
from pathlib import Path
from typing import Literal, cast

from PIL import ImageOps
from PIL.Image import Image as PILImage

from crate.artwork_materializer import materialize_artwork
from crate.artwork_maintenance import (
    cleanup_artwork_variants,
    find_corrupt_artwork_assets,
    repair_artwork_manifest_permissions,
)
from crate.artwork_sources import resolve_artwork_source
from crate.artwork_tasks import queue_artwork_materialization
from crate.artwork_tasks import (
    ARTWORK_BACKFILL_VERSION,
    ARTWORK_MANIFEST_PERMISSIONS_VERSION,
)
from crate.artwork_variants import (
    ARTWORK_KINDS,
    ArtworkAsset,
    ArtworkKind,
    external_artist_asset,
)
from crate.artist_hero_artwork import (
    DESKTOP_HERO_RENDER_SIZE,
    MOBILE_HERO_RENDER_SIZE,
    ARTIST_HERO_RENDER_VERSION,
    artist_hero_revision,
    render_artist_hero_composition,
    render_artist_hero_compositions,
)
from crate.artist_hero_contract import artist_hero_recipe_hash
from crate.artist_hero_candidates import load_candidate_content
from crate.artist_hero_publication import (
    ARTIST_HERO_PUBLICATION_VERSION,
    ArtistHeroArtifactIdentity,
    artist_hero_source_fingerprint,
    publish_artist_hero_artifact,
)
from crate.db.cache_store import set_cache
from crate.db.events import emit_task_event
from crate.db.queries.artwork_backfill import (
    list_artwork_backfill_albums,
    list_artwork_backfill_artists,
    list_artwork_backfill_genres,
)
from crate.db.repositories.library import (
    get_library_album,
    get_library_album_by_id,
    get_library_artist,
)
from crate.db.repositories.artist_hero_artwork import (
    delete_artist_hero_composition,
    get_artist_hero_artwork,
    list_artist_hero_backfill_candidates,
    upsert_artist_hero_artwork,
)
from crate.db.repositories.artist_artwork_assets import (
    ARTIST_ARTWORK_SLOTS,
    assign_artist_artwork_slot,
    create_or_get_artist_artwork_asset,
    delete_artist_artwork_asset,
    get_artist_artwork_asset,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.releases import update_new_release_cover
from crate.release_covers import release_cover_abspath, release_cover_public_url
from crate.metrics import record_later
from crate.task_progress import TaskProgress, emit_progress, entity_label
from crate.db.jobs.artwork import (
    set_album_has_cover,
    set_artist_has_photo,
    touch_artist_artwork,
)
from crate.storage_layout import resolve_artist_dir
from crate.streaming.paths import cache_root
from crate.worker_handlers import (
    DEFAULT_AUDIO_EXTENSIONS,
    TaskHandler,
    is_cancelled,
    start_scan,
)

log = logging.getLogger(__name__)

ARTIST_HERO_WEBP_QUALITY = 95
ARTIST_HERO_WEBP_METHOD = 6


def _save_artist_hero_webp_atomic(image: PILImage, destination: Path) -> None:
    """Publish a complete Hero render without exposing a partial WebP."""

    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        image.save(
            temporary_path,
            "WEBP",
            quality=ARTIST_HERO_WEBP_QUALITY,
            method=ARTIST_HERO_WEBP_METHOD,
        )
        temporary_path.replace(destination)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def _publish_artist_hero_manifest(
    *,
    artist_row: dict,
    revision: str,
    rendered: dict[str, PILImage],
    raw_sources: dict[str, bytes],
    recipes: dict[str, dict],
    existing: dict,
    enabled: tuple[str, ...],
) -> dict | None:
    """Publish immutable renders before exposing their active manifest."""

    entity_uid = str(artist_row.get("entity_uid") or "")
    if not entity_uid:
        return None

    artifacts: dict[str, dict] = {}
    existing_manifest = existing.get("render_manifest")
    if isinstance(existing_manifest, dict) and isinstance(
        existing_manifest.get("artifacts"), dict
    ):
        artifacts.update(
            {
                composition: dict(artifact)
                for composition, artifact in existing_manifest["artifacts"].items()
                if composition in {"desktop", "mobile"} and isinstance(artifact, dict)
            }
        )

    for composition, image in rendered.items():
        raw_source = raw_sources.get(composition)
        recipe = recipes.get(composition)
        if raw_source is None or recipe is None:
            continue
        identity = ArtistHeroArtifactIdentity(
            artist_entity_uid=entity_uid,
            composition=composition,
            render_revision=revision,
        )
        publication = publish_artist_hero_artifact(
            identity,
            image,
            source_fingerprint=artist_hero_source_fingerprint(raw_source),
            recipe_hash=artist_hero_recipe_hash(recipe),
            renderer_version=ARTIST_HERO_RENDER_VERSION,
        )
        artifacts[composition] = {
            key: publication.manifest[key]
            for key in (
                "renderer_version",
                "render_revision",
                "source_fingerprint",
                "recipe_hash",
                "relative_path",
            )
        }

    if any(composition not in artifacts for composition in enabled):
        return None
    return {
        "manifest_version": ARTIST_HERO_PUBLICATION_VERSION,
        "editorial_revision": revision,
        "artifacts": artifacts,
    }


def _broadcast_artwork_invalidation(*scopes: str) -> None:
    try:
        from crate.api.cache_events import (
            broadcast_invalidation,
            wait_for_cache_invalidation,
        )

        broadcast_invalidation(*dict.fromkeys(scopes))
        wait_for_cache_invalidation()
    except Exception:
        log.debug("Failed to broadcast artwork cache invalidation", exc_info=True)


def _warm_recent_home_discovery_snapshots() -> None:
    from crate.db.home_warming import warm_recent_home_discovery_snapshots

    warm_recent_home_discovery_snapshots()


def _handle_materialize_artwork_variants(
    task_id: str, params: dict, config: dict
) -> dict:
    del config
    allowed_params = {"kind", "entity_key", "reason"}
    if set(params) - allowed_params:
        return {"error": "Unsupported artwork task parameters"}

    kind = str(params.get("kind") or "")
    entity_key = str(params.get("entity_key") or "")
    if kind not in ARTWORK_KINDS:
        return {"error": "Unsupported artwork kind"}
    try:
        asset = ArtworkAsset(cast(ArtworkKind, kind), entity_key)
    except ValueError as exc:
        return {"error": str(exc)}

    emit_progress(
        task_id,
        TaskProgress(phase="resolve_artwork_source", done=0, total=1),
        force=True,
    )
    reason = str(params.get("reason") or "")
    source = resolve_artwork_source(
        asset,
        allow_provider=reason not in {"backfill", "integrity-repair"},
    )
    if source is None:
        return {
            "status": "missing",
            "kind": asset.kind,
            "entity_key": asset.entity_key,
        }

    materialized = materialize_artwork(
        asset,
        source.content,
        source_media_type=source.media_type,
    )
    emit_progress(
        task_id,
        TaskProgress(phase="materialize_artwork", done=1, total=1),
        force=True,
    )
    return {
        "status": "materialized",
        "kind": asset.kind,
        "entity_key": asset.entity_key,
        "origin": source.origin,
        "revision": materialized.get("source_revision"),
        "variant_count": int(materialized.get("variant_count") or 0),
    }


def _handle_backfill_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del config
    batch_size = max(1, min(int(params.get("batch_size") or 100), 1000))
    after_artist_id = max(0, int(params.get("after_artist_id") or 0))
    after_album_id = max(0, int(params.get("after_album_id") or 0))
    include_genres = bool(params.get("include_genres", True))
    after_genre_slug = str(params.get("after_genre_slug") or "").strip().lower()

    artists = list_artwork_backfill_artists(after_id=after_artist_id, limit=batch_size)
    albums = list_artwork_backfill_albums(after_id=after_album_id, limit=batch_size)
    genres = (
        list_artwork_backfill_genres(after_slug=after_genre_slug, limit=batch_size)
        if include_genres
        else []
    )
    total_assets = len(artists) * 2 + len(albums) + len(genres)
    progress = TaskProgress(phase="artwork_backfill", phase_count=1, total=total_assets)
    emit_progress(task_id, progress, force=True)

    queued = 0
    skipped_missing_identity = 0
    for row in artists:
        entity_uid = str(row.get("entity_uid") or "")
        if not entity_uid:
            skipped_missing_identity += 1
            continue
        for kind in ("artist-photo", "artist-background"):
            queue_artwork_materialization(
                ArtworkAsset(cast(ArtworkKind, kind), entity_uid), reason="backfill"
            )
            queued += 1
            progress.done += 1

    for row in albums:
        entity_uid = str(row.get("entity_uid") or "")
        if not entity_uid:
            skipped_missing_identity += 1
            continue
        queue_artwork_materialization(
            ArtworkAsset("album-cover", entity_uid), reason="backfill"
        )
        queued += 1
        progress.done += 1

    for row in genres:
        slug = str(row.get("slug") or "")
        if not slug:
            skipped_missing_identity += 1
            continue
        queue_artwork_materialization(
            ArtworkAsset("genre-cover", slug), reason="backfill"
        )
        queued += 1
        progress.done += 1

    emit_progress(task_id, progress, force=True)
    next_artist_id = int(artists[-1]["id"]) if artists else after_artist_id
    next_album_id = int(albums[-1]["id"]) if albums else after_album_id
    next_genre_slug = str(genres[-1]["slug"]) if genres else after_genre_slug
    has_next_page = (
        len(artists) >= batch_size
        or len(albums) >= batch_size
        or (include_genres and len(genres) >= batch_size)
    )
    if has_next_page:
        next_params = {
            "after_artist_id": next_artist_id,
            "after_album_id": next_album_id,
            "batch_size": batch_size,
            "include_genres": include_genres,
        }
        if include_genres:
            next_params["after_genre_slug"] = next_genre_slug
        cursor_key = f"{next_artist_id}:{next_album_id}"
        if include_genres:
            cursor_key += f":{next_genre_slug}"
        create_task_dedup(
            "backfill_artwork_variants",
            next_params,
            dedup_key=(
                f"artwork-backfill:{cursor_key}:{batch_size}:{int(include_genres)}"
            ),
        )

    for kind, remaining in (
        ("artist", len(artists) >= batch_size),
        ("album", len(albums) >= batch_size),
        ("genre", include_genres and len(genres) >= batch_size),
    ):
        record_later(
            "artwork.backfill.remaining",
            1.0 if remaining else 0.0,
            {"kind": kind},
        )

    if not has_next_page:
        try:
            from crate.db.cache_settings import set_setting

            set_setting("artwork_variants_backfill_version", ARTWORK_BACKFILL_VERSION)
        except Exception:
            log.warning("Failed to persist artwork backfill completion", exc_info=True)

    return {
        "status": "continued" if has_next_page else "completed",
        "artists_seen": len(artists),
        "albums_seen": len(albums),
        "genres_seen": len(genres),
        "queued": queued,
        "skipped_missing_identity": skipped_missing_identity,
        "next_queued": has_next_page,
        "after_artist_id": next_artist_id,
        "after_album_id": next_album_id,
    }


def _handle_cleanup_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    max_assets = max(1, min(int(params.get("max_assets") or 10_000), 100_000))
    return cleanup_artwork_variants(max_assets=max_assets)


def _handle_repair_artwork_variants(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    max_assets = max(1, min(int(params.get("max_assets") or 1000), 100_000))
    corrupt = find_corrupt_artwork_assets(max_assets=max_assets)
    for asset in corrupt:
        queue_artwork_materialization(asset, reason="integrity-repair")
    result = {"assets_checked": max_assets, "requeued": len(corrupt)}
    if bool(params.get("repair_manifest_permissions")):
        permissions = repair_artwork_manifest_permissions(max_assets=max_assets)
        result.update(
            {
                "manifest_assets_checked": permissions["assets_checked"],
                "permissions_repaired": permissions["permissions_repaired"],
            }
        )
        from crate.db.cache_settings import set_setting

        set_setting(
            "artwork_manifest_permissions_version",
            ARTWORK_MANIFEST_PERMISSIONS_VERSION,
        )
    return result


def _handle_resolve_external_artist_artwork(
    task_id: str, params: dict, config: dict
) -> dict:
    del task_id, config
    artist_name = str(params.get("artist_name") or "").strip()
    if not artist_name:
        return {"error": "Artist name is required"}

    from crate.external_artist_artwork import (
        mark_external_artist_artwork_missing,
        persist_external_artist_artwork,
        resolve_external_artist_artwork,
    )

    image = resolve_external_artist_artwork(artist_name)
    if not image:
        mark_external_artist_artwork_missing(artist_name)
        return {"status": "missing", "artist_name": artist_name}

    try:
        persist_external_artist_artwork(artist_name, image)
    except (OSError, RuntimeError, ValueError):
        log.debug("External artwork persistence failed for %s", artist_name)
        mark_external_artist_artwork_missing(artist_name)
        return {"status": "missing", "artist_name": artist_name}

    materialize_artwork(
        external_artist_asset(artist_name),
        image,
        source_media_type="image/jpeg",
    )

    return {"status": "cached", "artist_name": artist_name}


def _handle_fetch_artwork_all(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover, scan_missing_covers

    lib = Path(config["library_path"])
    missing = scan_missing_covers(lib, DEFAULT_AUDIO_EXTENSIONS)

    fetched = 0
    failed = 0
    total = len(missing)

    p = TaskProgress(phase="fetching_covers", phase_count=1, total=total)

    for i, album in enumerate(missing):
        if is_cancelled(task_id):
            break
        mbid = album.get("mbid")
        if not mbid:
            continue
        p.done = i + 1
        p.item = entity_label(
            artist=album.get("artist", ""),
            album=album.get("album", ""),
            path=album.get("path", ""),
        )
        emit_progress(task_id, p)
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(Path(album["path"]), image)
            fetched += 1
        else:
            failed += 1

    emit_task_event(
        task_id,
        "info",
        {"message": f"Artwork fetch complete: {fetched}/{total} covers fetched"},
    )
    return {"fetched": fetched, "failed": failed, "total": total}


def _handle_batch_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    lib = Path(config["library_path"])
    albums = params.get("albums", [])
    results = []

    p = TaskProgress(phase="batch_covers", phase_count=1, total=len(albums))

    for i, item in enumerate(albums):
        if is_cancelled(task_id):
            break
        mbid = item.get("mbid")
        path = item.get("path")
        p.done = i + 1
        p.item = entity_label(path=path or "")
        emit_progress(task_id, p)

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

    fetched = sum(1 for r in results if r.get("status") == "fetched")
    emit_task_event(
        task_id, "info", {"message": f"Batch covers: fetched {fetched}/{len(albums)}"}
    )
    return {"results": results}


def _handle_fetch_cover(task_id: str, params: dict, config: dict) -> dict:
    from crate.artwork import fetch_cover_from_caa, save_cover

    mbid = params.get("mbid")
    path = params.get("path")
    if not mbid:
        return {"error": "No MBID"}

    emit_task_event(
        task_id,
        "info",
        {"message": f"Fetching cover from CoverArtArchive for {path or mbid}"},
    )

    lib = Path(config["library_path"])
    album_dir = lib / path if path else None

    image = fetch_cover_from_caa(mbid)
    if not image:
        emit_task_event(
            task_id, "info", {"message": f"No cover found on CAA for {path or mbid}"}
        )
        return {"error": "No cover found on CAA"}

    if album_dir and album_dir.is_dir():
        save_cover(album_dir, image)
        emit_task_event(task_id, "info", {"message": f"Cover saved for {path or mbid}"})
        return {"status": "saved", "path": str(album_dir / "cover.jpg")}

    return {"error": "Album directory not found"}


def _handle_fetch_artist_covers(task_id: str, params: dict, config: dict) -> dict:
    from crate.audio import read_tags as _read_tags
    from crate.audio import get_audio_files
    from crate.artwork import fetch_cover_from_caa, save_cover

    artist_name = params.get("artist", "")
    lib = Path(config["library_path"])
    artist_row = get_library_artist(artist_name)
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist_name, existing_only=True
    )
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist not found"}

    fetched = failed = skipped = total = 0
    p = TaskProgress(
        phase="artist_covers", phase_count=1, item=entity_label(artist=artist_name)
    )
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        total += 1
        p.total = total
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
        p.done = total
        p.item = entity_label(artist=artist_name, album=album_dir.name)
        emit_progress(task_id, p)
        image = fetch_cover_from_caa(mbid)
        if image:
            save_cover(album_dir, image)
            fetched += 1
        else:
            failed += 1

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Artist covers for {artist_name}: {fetched}/{total} fetched, {skipped} skipped"
        },
    )
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
    from crate.artwork import (
        extract_embedded_cover,
        fetch_cover_from_caa,
        save_cover,
        scan_missing_covers,
    )

    lib = Path(config["library_path"])

    p = TaskProgress(phase="scanning", phase_count=2)
    emit_progress(task_id, p, force=True)
    emit_task_event(
        task_id, "info", {"message": "Scanning library for missing covers..."}
    )
    missing = scan_missing_covers(lib, DEFAULT_AUDIO_EXTENSIONS)

    emit_task_event(
        task_id,
        "info",
        {
            "message": f"Found {len(missing)} albums without covers",
            "total": len(missing),
        },
    )

    found = 0
    not_found = 0
    p.phase = "searching"
    p.phase_index = 1
    p.total = len(missing)

    for i, album in enumerate(missing):
        if is_cancelled(task_id):
            break

        artist = album["artist"]
        album_name = album["album"]
        mbid = album.get("mbid")
        album_path = album["path"]

        p.done = i
        p.item = entity_label(artist=artist, album=album_name)
        emit_progress(task_id, p)

        cover_data = None
        source = None

        if mbid and mbid.strip():
            cover_data = fetch_cover_from_caa(mbid)
            if cover_data:
                source = "coverartarchive"

        if not cover_data:
            audio_files = list(Path(album_path).glob("*.flac")) + list(
                Path(album_path).glob("*.mp3")
            )
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
            log.debug(
                "Failed to fetch Deezer cover for %s / %s", artist, album, exc_info=True
            )

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


def _handle_import_artist_artwork_asset(
    task_id: str, params: dict, config: dict
) -> dict:
    """Validate and persist one reusable source image in an artist gallery."""
    del task_id
    from PIL import Image, ImageOps

    artist = str(params.get("artist") or "").strip()
    if not artist:
        return {"error": "Artist is required"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    artist_id = int(artist_row["id"])
    requested_artist_id = int(params.get("artist_id") or artist_id)
    if requested_artist_id != artist_id:
        return {"error": "Artist identity mismatch"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist directory not found"}
    artist_dir = artist_dir.resolve()
    if not artist_dir.is_relative_to(lib):
        return {"error": "Artist directory is outside the library"}

    raw: bytes
    resolved_origin = str(params.get("origin") or "manual-upload")
    data_b64 = str(params.get("data_b64") or "")
    candidate = str(params.get("candidate") or "")
    if data_b64:
        try:
            raw = base64.b64decode(data_b64, validate=True)
        except ValueError:
            return {"error": "Invalid image data"}
    elif candidate:
        loaded = load_candidate_content(
            candidate, artist_id=artist_id, artist_dir=artist_dir
        )
        if loaded is None:
            return {"error": "Candidate not found"}
        raw, candidate_origin = loaded
        if not params.get("origin"):
            resolved_origin = candidate_origin
    else:
        return {"error": "No image data"}

    if not raw or len(raw) > 25 * 1024 * 1024:
        return {"error": "Invalid image"}
    try:
        with Image.open(_io.BytesIO(raw)) as opened:
            opened.load()
            if (
                opened.width <= 0
                or opened.height <= 0
                or opened.width * opened.height > 80_000_000
            ):
                return {"error": "Invalid image dimensions"}
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except (Image.DecompressionBombError, OSError, ValueError):
        return {"error": "Invalid image"}

    normalized = _io.BytesIO()
    image.save(normalized, "JPEG", quality=94, optimize=True)
    content = normalized.getvalue()
    checksum = hashlib.sha256(content).hexdigest()
    relative_path = (
        Path(".crate") / "artwork-gallery" / checksum[:2] / f"{checksum}.jpg"
    )
    destination = (artist_dir / relative_path).resolve()
    if not destination.is_relative_to(artist_dir):
        return {"error": "Artwork path is outside the artist directory"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file():
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(content)
        temporary.replace(destination)

    asset = create_or_get_artist_artwork_asset(
        artist_id=artist_id,
        checksum=checksum,
        storage_path=relative_path.as_posix(),
        origin=resolved_origin,
        label=str(params.get("label") or params.get("filename") or "Curated artwork")[
            :160
        ],
        mime_type="image/jpeg",
        width=image.width,
        height=image.height,
    )
    return {
        "status": "imported",
        "asset_id": int(asset["id"]),
        "checksum": checksum,
        "width": image.width,
        "height": image.height,
    }


def _handle_assign_artist_artwork_slot(
    task_id: str, params: dict, config: dict
) -> dict:
    """Materialize a gallery asset into one public artist artwork slot."""
    artist = str(params.get("artist") or "").strip()
    slot = str(params.get("slot") or "")
    if not artist:
        return {"error": "Artist is required"}
    if slot not in ARTIST_ARTWORK_SLOTS:
        return {"error": "Unknown artist artwork slot"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    artist_id = int(artist_row["id"])
    if int(params.get("artist_id") or artist_id) != artist_id:
        return {"error": "Artist identity mismatch"}
    try:
        asset_id = int(params.get("asset_id") or 0)
    except (TypeError, ValueError):
        return {"error": "Invalid artwork asset"}
    asset = get_artist_artwork_asset(artist_id, asset_id)
    if not asset:
        return {"error": "Artwork asset not found"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist directory not found"}
    artist_dir = artist_dir.resolve()
    source_path = (artist_dir / str(asset["storage_path"])).resolve()
    if not source_path.is_relative_to(artist_dir) or not source_path.is_file():
        return {"error": "Artwork asset file not found"}
    raw = source_path.read_bytes()

    upload_params: dict = {
        "artist": artist,
        "data_b64": base64.b64encode(raw).decode(),
        "source_origin": f"gallery:{asset_id}",
    }
    if slot == "avatar":
        upload_params["type"] = "artist_photo"
    elif slot == "background":
        upload_params["type"] = "background"
    else:
        from PIL import Image

        with Image.open(_io.BytesIO(raw)) as source:
            width, height = source.size
        existing = get_artist_hero_artwork(artist_id) or {}
        default_desktop, default_mobile = _derived_hero_recipes(width, height)
        upload_params.update(
            {
                "type": "artist_hero",
                "composition": "desktop" if slot == "hero_desktop" else "mobile",
                "desktop_recipe": dict(
                    existing.get("desktop_recipe") or default_desktop
                ),
                "mobile_recipe": dict(existing.get("mobile_recipe") or default_mobile),
            }
        )

    result = _handle_upload_image(task_id, upload_params, config)
    if result.get("error"):
        return result
    if not assign_artist_artwork_slot(
        artist_id=artist_id, slot=slot, asset_id=asset_id
    ):
        return {"error": "Artwork slot assignment failed"}
    return {
        "status": "assigned",
        "artist_id": artist_id,
        "asset_id": asset_id,
        "slot": slot,
        "path": result.get("path"),
    }


def _handle_delete_artist_artwork_asset(
    task_id: str, params: dict, config: dict
) -> dict:
    """Delete one unassigned reusable artwork source and its file."""
    del task_id
    artist = str(params.get("artist") or "").strip()
    if not artist:
        return {"error": "Artist is required"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    artist_id = int(artist_row["id"])
    if int(params.get("artist_id") or artist_id) != artist_id:
        return {"error": "Artist identity mismatch"}
    try:
        asset_id = int(params.get("asset_id") or 0)
    except (TypeError, ValueError):
        return {"error": "Invalid artwork asset"}

    asset = get_artist_artwork_asset(artist_id, asset_id)
    if not asset:
        return {"error": "Artwork asset not found"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist directory not found"}
    artist_dir = artist_dir.resolve()
    source_path = (artist_dir / str(asset["storage_path"])).resolve()
    if not source_path.is_relative_to(artist_dir):
        return {"error": "Artwork asset path is outside the artist directory"}

    deleted = delete_artist_artwork_asset(artist_id=artist_id, asset_id=asset_id)
    if not deleted:
        return {"error": "Artwork asset is assigned to a slot"}

    if source_path.is_file():
        source_path.unlink()
    _broadcast_artwork_invalidation(f"artist:{artist_id}", "library")
    return {"status": "deleted", "artist_id": artist_id, "asset_id": asset_id}


def _handle_delete_artist_hero_composition(
    task_id: str, params: dict, config: dict
) -> dict:
    """Delete one Hero composition and its rendered/source artifacts."""
    del task_id
    artist = str(params.get("artist") or "").strip()
    composition = str(params.get("composition") or "")
    if not artist:
        return {"error": "Artist is required"}
    if composition not in {"desktop", "mobile"}:
        return {"error": "Invalid artist hero composition"}

    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    artist_id = int(artist_row["id"])
    if int(params.get("artist_id") or artist_id) != artist_id:
        return {"error": "Artist identity mismatch"}

    existing = get_artist_hero_artwork(artist_id)
    if not existing or existing.get(f"{composition}_enabled", True) is False:
        return {"error": "Artist hero composition not found"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist directory not found"}
    artist_dir = artist_dir.resolve()
    if not artist_dir.is_relative_to(lib):
        return {"error": "Artist directory is outside the library"}

    def _safe_child(filename: str) -> Path:
        path = (artist_dir / filename).resolve()
        if not path.is_relative_to(artist_dir):
            raise ValueError("Artist hero path is outside the artist directory")
        return path

    other = "mobile" if composition == "desktop" else "desktop"
    target_files = (
        _safe_child(f"artist-hero-source-{composition}.jpg"),
        _safe_child(f"artist-hero-{composition}.webp"),
    )
    other_enabled = existing.get(f"{other}_enabled", True) is not False
    files_to_delete = list(target_files)
    if not other_enabled:
        files_to_delete.extend(
            _safe_child(filename)
            for filename in (
                "artist-hero-source.jpg",
                "artist-hero-source-desktop.jpg",
                "artist-hero-source-mobile.jpg",
                "artist-hero-desktop.webp",
                "artist-hero-mobile.webp",
            )
        )

    deleted = delete_artist_hero_composition(
        artist_id=artist_id, composition=composition
    )
    if deleted is None:
        return {"error": "Artist hero composition not found"}
    for path in dict.fromkeys(files_to_delete):
        if path.is_file():
            path.unlink()

    _broadcast_artwork_invalidation(f"artist:{artist_id}", "library", "home")
    _warm_recent_home_discovery_snapshots()
    return {
        "status": "deleted",
        "artist_id": artist_id,
        "composition": composition,
        "remaining_compositions": deleted.get("remaining_compositions", []),
    }


def _handle_upload_image(task_id: str, params: dict, config: dict) -> dict:
    """Save uploaded image to the correct location in the library."""
    from PIL import Image

    img_type = params.get("type")
    artist = params.get("artist", "")
    album = params.get("album", "")
    release_id = params.get("release_id")
    data_b64 = params.get("data_b64", "")

    if not data_b64:
        return {"error": "No image data"}

    raw = base64.b64decode(data_b64)
    with Image.open(_io.BytesIO(raw)) as opened:
        opened.load()
        img = ImageOps.exif_transpose(opened).convert("RGB")
    lib = Path(config["library_path"]).resolve()

    def _safe_dest(path: Path) -> Path:
        resolved = path.resolve()
        if not resolved.is_relative_to(lib):
            raise ValueError(f"Path traversal blocked: {resolved} is outside {lib}")
        return resolved

    invalidation_scopes: list[str] = []
    materialization_assets: list[ArtworkAsset] = []

    if img_type == "cover":
        album_data = get_library_album(artist, album)
        if not album_data:
            return {"error": "Album not found"}
        dest = _safe_dest(Path(album_data["path"]) / "cover.jpg")
        img.save(str(dest), "JPEG", quality=92)
        if album_data.get("id"):
            set_album_has_cover(int(album_data["id"]))
            invalidation_scopes.append(f"album:{album_data['id']}")
        if album_data.get("entity_uid"):
            materialization_assets.append(
                ArtworkAsset("album-cover", str(album_data["entity_uid"]))
            )
        invalidation_scopes.extend(["library", "home"])
    elif img_type == "release_cover":
        if not release_id:
            return {"error": "Release not found"}
        dest = release_cover_abspath(int(release_id))
        img.save(str(dest), "JPEG", quality=92)
        if not update_new_release_cover(
            int(release_id),
            cover_url=release_cover_public_url(int(release_id)),
            cover_source="manual",
        ):
            return {"error": "Release not found"}
        materialization_assets.append(
            ArtworkAsset("release-cover", str(int(release_id)))
        )
        invalidation_scopes.extend(["library", "home", "upcoming"])
    elif img_type == "artist_photo":
        artist_row = get_library_artist(artist)
        found_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not found_dir or not found_dir.is_dir():
            return {"error": "Artist directory not found"}
        dest = _safe_dest(found_dir / "artist.jpg")
        img.save(str(dest), "JPEG", quality=92)
        set_artist_has_photo(artist)
        if artist_row and artist_row.get("id"):
            invalidation_scopes.append(f"artist:{artist_row['id']}")
        if artist_row and artist_row.get("entity_uid"):
            materialization_assets.append(
                ArtworkAsset("artist-photo", str(artist_row["entity_uid"]))
            )
        invalidation_scopes.extend(["library", "home", "shows", "upcoming"])
    elif img_type == "background":
        artist_row = get_library_artist(artist)
        found_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not found_dir or not found_dir.is_dir():
            return {"error": "Artist directory not found"}
        dest = _safe_dest(found_dir / "background.jpg")
        img.save(str(dest), "JPEG", quality=90)
        touch_artist_artwork(artist)
        if artist_row and artist_row.get("id"):
            invalidation_scopes.append(f"artist:{artist_row['id']}")
        if artist_row and artist_row.get("entity_uid"):
            materialization_assets.append(
                ArtworkAsset("artist-background", str(artist_row["entity_uid"]))
            )
        invalidation_scopes.extend(["library", "home", "shows", "upcoming"])
    elif img_type == "artist_hero":
        artist_row = get_library_artist(artist)
        found_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not artist_row or not found_dir or not found_dir.is_dir():
            return {"error": "Artist directory not found"}
        desktop_recipe = dict(params.get("desktop_recipe") or {})
        mobile_recipe = dict(params.get("mobile_recipe") or {})
        composition = str(params.get("composition") or "shared")
        if composition not in {"shared", "desktop", "mobile"}:
            return {"error": "Invalid artist hero composition"}
        existing = get_artist_hero_artwork(int(artist_row["id"])) or {}
        source_name = (
            "artist-hero-source.jpg"
            if composition == "shared"
            else f"artist-hero-source-{composition}.jpg"
        )
        dest = _safe_dest(found_dir / source_name)
        img.save(str(dest), "JPEG", quality=94)
        targets = ("desktop", "mobile") if composition == "shared" else (composition,)
        rendered_compositions: dict[str, PILImage] = {}
        raw_sources = {target: raw for target in targets}
        for target in targets:
            recipe = desktop_recipe if target == "desktop" else mobile_recipe
            output_size = (
                DESKTOP_HERO_RENDER_SIZE
                if target == "desktop"
                else MOBILE_HERO_RENDER_SIZE
            )
            rendered = render_artist_hero_composition(img, recipe, output_size)
            rendered_compositions[target] = rendered
            _save_artist_hero_webp_atomic(
                rendered, _safe_dest(found_dir / f"artist-hero-{target}.webp")
            )
        legacy_width = int(existing.get("source_width") or img.width)
        legacy_height = int(existing.get("source_height") or img.height)
        desktop_width = existing.get("desktop_source_width")
        desktop_height = existing.get("desktop_source_height")
        desktop_origin = existing.get("desktop_source_origin")
        mobile_width = existing.get("mobile_source_width")
        mobile_height = existing.get("mobile_source_height")
        mobile_origin = existing.get("mobile_source_origin")
        if composition in {"shared", "desktop"}:
            desktop_width, desktop_height = img.size
            desktop_origin = str(params.get("source_origin") or "manual-upload")
        if composition in {"shared", "mobile"}:
            mobile_width, mobile_height = img.size
            mobile_origin = str(params.get("source_origin") or "manual-upload")
        if composition == "shared":
            legacy_width, legacy_height = img.size
        revision = artist_hero_revision(
            raw,
            repr(sorted(desktop_recipe.items())).encode(),
            repr(sorted(mobile_recipe.items())).encode(),
        )
        desktop_enabled = (
            True
            if composition in {"shared", "desktop"}
            else existing.get("desktop_enabled", True)
        )
        mobile_enabled = (
            True
            if composition in {"shared", "mobile"}
            else existing.get("mobile_enabled", True)
        )
        render_manifest = _publish_artist_hero_manifest(
            artist_row=artist_row,
            revision=revision,
            rendered=rendered_compositions,
            raw_sources=raw_sources,
            recipes={"desktop": desktop_recipe, "mobile": mobile_recipe},
            existing=existing,
            enabled=tuple(
                composition
                for composition, is_enabled in (
                    ("desktop", desktop_enabled),
                    ("mobile", mobile_enabled),
                )
                if is_enabled
            ),
        )
        applied = upsert_artist_hero_artwork(
            artist_id=int(artist_row["id"]),
            provenance="manual",
            review_status="approved",
            source_width=legacy_width,
            source_height=legacy_height,
            desktop_recipe=desktop_recipe,
            mobile_recipe=mobile_recipe,
            revision=revision,
            desktop_source_width=desktop_width,
            desktop_source_height=desktop_height,
            desktop_source_origin=desktop_origin,
            mobile_source_width=mobile_width,
            mobile_source_height=mobile_height,
            mobile_source_origin=mobile_origin,
            desktop_enabled=desktop_enabled,
            mobile_enabled=mobile_enabled,
            render_manifest=render_manifest,
            expected_revision=existing.get("revision"),
        )
        if applied is False:
            return {
                "status": "conflict",
                "reason": "artist-hero-profile-changed",
                "artist_id": int(artist_row["id"]),
            }
        entity_uid = str(artist_row.get("entity_uid") or "")
        if entity_uid:
            materialization_assets.extend(
                ArtworkAsset("artist-hero", f"{entity_uid}:{target}")
                for target in targets
            )
        invalidation_scopes.extend([f"artist:{artist_row['id']}", "library", "home"])
    elif img_type == "genre_cover":
        from crate.db.repositories.genres_taxonomy_metadata import (
            update_genre_taxonomy_node_metadata,
        )
        from crate.genre_covers import persist_genre_cover_upload

        slug = str(params.get("slug") or "").strip().lower()
        if not slug:
            return {"error": "Genre slug is required"}
        try:
            cover_path = persist_genre_cover_upload(
                slug,
                filename=str(params.get("filename") or ""),
                content_type=params.get("content_type"),
                payload=raw,
            )
        except ValueError as exc:
            return {"error": str(exc)}
        if not update_genre_taxonomy_node_metadata(slug, cover_path=cover_path):
            return {"error": "Genre not found"}
        dest = Path(cover_path)
        materialization_assets.append(ArtworkAsset("genre-cover", slug))
        invalidation_scopes.extend(["library", "home", f"genre:{slug}"])
    else:
        return {"error": f"Unknown image type: {img_type}"}

    log.info(
        "Image uploaded: %s for %s (%dx%d)", img_type, artist, img.width, img.height
    )

    for materialization_asset in materialization_assets:
        queue_artwork_materialization(materialization_asset, reason="source-write")

    if img_type == "cover":
        try:
            start_scan()
        except Exception:
            log.debug("Failed to start library scan after cover upload", exc_info=True)

    _broadcast_artwork_invalidation(*invalidation_scopes)
    if img_type == "artist_hero":
        _warm_recent_home_discovery_snapshots()

    return {
        "type": img_type,
        "path": str(dest),
        "width": img.width,
        "height": img.height,
    }


def _derived_hero_recipes(width: int, height: int) -> tuple[dict, dict]:
    base = {
        "crop": {"x": 0, "y": 0, "width": width, "height": height},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
        "flip_horizontal": False,
        "rotation": 0,
        "blur": 36,
        "feather": 30,
        "gradient": 0.5,
        "grayscale": False,
        "brightness": 1.0,
        "contrast": 1.0,
    }
    return ({**base, "mode": "extend"}, {**base, "mode": "extend"})


def _handle_compose_artist_hero(task_id: str, params: dict, config: dict) -> dict:
    del task_id
    from PIL import Image

    artist = str(params.get("artist") or "").strip()
    if not artist:
        return {"error": "Artist is required"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"error": "Artist directory not found"}
    artist_dir = artist_dir.resolve()
    if not artist_dir.is_relative_to(lib):
        return {"error": "Artist directory is outside the library"}

    composition = str(params.get("composition") or "shared")
    if composition not in {"shared", "desktop", "mobile"}:
        return {"error": "Invalid artist hero composition"}

    legacy_source_path = artist_dir / "artist-hero-source.jpg"
    source_paths = {
        "desktop": artist_dir / "artist-hero-source-desktop.jpg",
        "mobile": artist_dir / "artist-hero-source-mobile.jpg",
    }
    targets = ("desktop", "mobile") if composition == "shared" else (composition,)
    for target in targets:
        if not source_paths[target].is_file():
            source_paths[target] = legacy_source_path
        if not source_paths[target].is_file():
            return {"error": "Artist hero source not found"}

    def _read_source(path: Path) -> tuple[bytes, Image.Image]:
        raw_source = path.read_bytes()
        with Image.open(_io.BytesIO(raw_source)) as opened:
            opened.load()
            return raw_source, ImageOps.exif_transpose(opened).convert("RGB")

    try:
        loaded_sources = {
            target: _read_source(source_paths[target]) for target in targets
        }
    except (OSError, ValueError):
        return {"error": "Invalid artist hero source"}

    artist_id = int(artist_row["id"])
    existing = get_artist_hero_artwork(artist_id) or {}
    desktop_recipe = dict(params.get("desktop_recipe") or {})
    mobile_recipe = dict(params.get("mobile_recipe") or {})
    recipes = {"desktop": desktop_recipe, "mobile": mobile_recipe}
    output_sizes = {
        "desktop": DESKTOP_HERO_RENDER_SIZE,
        "mobile": MOBILE_HERO_RENDER_SIZE,
    }
    output_names = {
        "desktop": "artist-hero-desktop.webp",
        "mobile": "artist-hero-mobile.webp",
    }
    rendered_compositions: dict[str, PILImage] = {}
    for target, (_raw, image) in loaded_sources.items():
        rendered = render_artist_hero_composition(
            image, recipes[target], output_sizes[target]
        )
        rendered_compositions[target] = rendered
        _save_artist_hero_webp_atomic(
            rendered,
            artist_dir / output_names[target],
        )

    revision_parts: list[bytes] = []
    for target in ("desktop", "mobile"):
        raw = loaded_sources.get(target, (None, None))[0]
        revision_parts.append(
            raw if raw is not None else str(existing.get("revision") or "").encode()
        )
        revision_parts.append(repr(sorted(recipes[target].items())).encode())
    revision = artist_hero_revision(*revision_parts)
    fallback_image = next(iter(loaded_sources.values()))[1]
    desktop_image = loaded_sources.get("desktop", (None, fallback_image))[1]
    mobile_image = loaded_sources.get("mobile", (None, fallback_image))[1]
    desktop_source_width = existing.get("desktop_source_width")
    desktop_source_height = existing.get("desktop_source_height")
    mobile_source_width = existing.get("mobile_source_width")
    mobile_source_height = existing.get("mobile_source_height")
    if "desktop" in loaded_sources:
        desktop_source_width, desktop_source_height = desktop_image.size
    if "mobile" in loaded_sources:
        mobile_source_width, mobile_source_height = mobile_image.size
    desktop_enabled = (
        True
        if composition in {"shared", "desktop"}
        else existing.get("desktop_enabled", True)
    )
    mobile_enabled = (
        True
        if composition in {"shared", "mobile"}
        else existing.get("mobile_enabled", True)
    )
    render_manifest = _publish_artist_hero_manifest(
        artist_row=artist_row,
        revision=revision,
        rendered=rendered_compositions,
        raw_sources={target: raw for target, (raw, _image) in loaded_sources.items()},
        recipes=recipes,
        existing=existing,
        enabled=tuple(
            composition
            for composition, is_enabled in (
                ("desktop", desktop_enabled),
                ("mobile", mobile_enabled),
            )
            if is_enabled
        ),
    )
    applied = upsert_artist_hero_artwork(
        artist_id=artist_id,
        provenance="manual",
        review_status="approved",
        source_width=int(existing.get("source_width") or desktop_image.width),
        source_height=int(existing.get("source_height") or desktop_image.height),
        desktop_recipe=desktop_recipe,
        mobile_recipe=mobile_recipe,
        revision=revision,
        desktop_source_width=desktop_source_width,
        desktop_source_height=desktop_source_height,
        desktop_source_origin=existing.get("desktop_source_origin") or "manual-upload",
        mobile_source_width=mobile_source_width,
        mobile_source_height=mobile_source_height,
        mobile_source_origin=existing.get("mobile_source_origin") or "manual-upload",
        desktop_enabled=desktop_enabled,
        mobile_enabled=mobile_enabled,
        render_manifest=render_manifest,
        expected_revision=existing.get("revision"),
    )
    if applied is False:
        return {
            "status": "conflict",
            "reason": "artist-hero-profile-changed",
            "artist_id": artist_id,
        }
    entity_uid = str(artist_row.get("entity_uid") or "")
    if entity_uid:
        for target in targets:
            queue_artwork_materialization(
                ArtworkAsset("artist-hero", f"{entity_uid}:{target}"),
                reason="source-write",
            )
    _broadcast_artwork_invalidation(f"artist:{artist_id}", "library", "home")
    _warm_recent_home_discovery_snapshots()
    return {"status": "composed", "artist_id": artist_id, "revision": revision}


def _handle_preview_artist_hero(task_id: str, params: dict, config: dict) -> dict:
    """Render a temporary preview without mutating the persisted hero profile."""

    from PIL import Image

    artist = str(params.get("artist") or "").strip()
    composition = str(params.get("composition") or "")
    recipe = params.get("recipe")
    if not artist or composition not in {"desktop", "mobile"}:
        return {"error": "Invalid artist hero preview parameters"}
    if not isinstance(recipe, dict):
        return {"error": "Invalid artist hero recipe"}

    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    raw_data = params.get("data_b64")
    if raw_data:
        try:
            raw = base64.b64decode(str(raw_data), validate=True)
            with Image.open(_io.BytesIO(raw)) as opened:
                opened.load()
                image = ImageOps.exif_transpose(opened).convert("RGB")
        except (ValueError, OSError):
            return {"error": "Invalid artist hero source"}
    else:
        lib = Path(config["library_path"]).resolve()
        artist_dir = resolve_artist_dir(
            lib, artist_row, fallback_name=artist, existing_only=True
        )
        if not artist_dir or not artist_dir.is_dir():
            return {"error": "Artist directory not found"}
        source_path = artist_dir / f"artist-hero-source-{composition}.jpg"
        if not source_path.is_file():
            source_path = artist_dir / "artist-hero-source.jpg"
        if not source_path.is_file():
            return {"error": "Artist hero source not found"}
        try:
            raw = source_path.read_bytes()
            with Image.open(_io.BytesIO(raw)) as opened:
                opened.load()
                image = ImageOps.exif_transpose(opened).convert("RGB")
        except (OSError, ValueError):
            return {"error": "Invalid artist hero source"}

    output_size = (
        DESKTOP_HERO_RENDER_SIZE
        if composition == "desktop"
        else MOBILE_HERO_RENDER_SIZE
    )
    rendered = render_artist_hero_composition(image, recipe, output_size)
    preview_id = hashlib.sha256(f"{task_id}:{composition}".encode("utf-8")).hexdigest()
    preview_dir = cache_root() / "artist-hero-previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    preview_path = preview_dir / f"{preview_id}.webp"
    _save_artist_hero_webp_atomic(rendered, preview_path)
    revision = artist_hero_revision(raw, repr(sorted(recipe.items())).encode("utf-8"))
    artist_id = int(artist_row["id"])
    size = (1480, 600) if composition == "desktop" else (1080, 1350)
    from crate.artist_hero_contract import artist_hero_composition_view

    view = artist_hero_composition_view(
        artist_id=artist_id,
        composition=cast(Literal["desktop", "mobile"], composition),
        recipe=recipe,
        source_size=image.size,
        render_revision=revision,
    )
    view["asset_path"] = f"/api/artwork/artists/{artist_id}/hero-preview/{preview_id}"
    view["width"], view["height"] = size
    return {
        "status": "previewed",
        "artist_id": artist_id,
        "preview_id": preview_id,
        "preview_url": view["asset_path"],
        "composition": composition,
        "view": view,
    }


def _handle_recompose_artist_hero(task_id: str, params: dict, config: dict) -> dict:
    """Refresh persisted hero files after a renderer change.

    This deliberately preserves the profile's provenance and review status. It
    is used by delivery when it encounters a hero generated by an older
    renderer, so a cache invalidation does not keep serving the old geometry.
    """
    del task_id
    from PIL import Image

    artist = str(params.get("artist") or "").strip()
    if not artist:
        return {"error": "Artist is required"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    existing = get_artist_hero_artwork(int(artist_row["id"]))
    if not existing:
        return {"status": "skipped", "reason": "missing-profile"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"status": "skipped", "reason": "missing-artist-directory"}
    artist_dir = artist_dir.resolve()
    if not artist_dir.is_relative_to(lib):
        return {"error": "Artist directory is outside the library"}

    legacy_source_path = artist_dir / "artist-hero-source.jpg"
    source_paths = {
        "desktop": artist_dir / "artist-hero-source-desktop.jpg",
        "mobile": artist_dir / "artist-hero-source-mobile.jpg",
    }
    available_paths: dict[str, Path] = {}
    for composition, specific_path in source_paths.items():
        if existing.get(f"{composition}_enabled", True) is False:
            continue
        if specific_path.is_file():
            available_paths[composition] = specific_path
        elif legacy_source_path.is_file():
            available_paths[composition] = legacy_source_path
    if not available_paths:
        return {"status": "skipped", "reason": "missing-hero-source"}

    def _read_source(path: Path) -> tuple[bytes, Image.Image]:
        raw_source = path.read_bytes()
        with Image.open(_io.BytesIO(raw_source)) as opened:
            opened.load()
            return raw_source, ImageOps.exif_transpose(opened).convert("RGB")

    try:
        loaded_sources = {
            composition: _read_source(path)
            for composition, path in available_paths.items()
        }
    except (OSError, ValueError):
        return {"status": "skipped", "reason": "invalid-hero-source"}

    desktop_recipe = dict(existing.get("desktop_recipe") or {})
    mobile_recipe = dict(existing.get("mobile_recipe") or {})
    recipes = {"desktop": desktop_recipe, "mobile": mobile_recipe}
    if any(not recipes[composition] for composition in loaded_sources):
        return {"status": "skipped", "reason": "missing-hero-recipes"}

    render_sizes = {
        "desktop": DESKTOP_HERO_RENDER_SIZE,
        "mobile": MOBILE_HERO_RENDER_SIZE,
    }
    output_names = {
        "desktop": "artist-hero-desktop.webp",
        "mobile": "artist-hero-mobile.webp",
    }
    rendered_compositions: dict[str, PILImage] = {}
    for composition, (_raw, image) in loaded_sources.items():
        rendered = render_artist_hero_composition(
            image, recipes[composition], render_sizes[composition]
        )
        rendered_compositions[composition] = rendered
        _save_artist_hero_webp_atomic(
            rendered,
            artist_dir / output_names[composition],
        )

    revision_parts: list[bytes] = []
    for composition in ("desktop", "mobile"):
        raw = loaded_sources.get(composition, (None, None))[0]
        revision_parts.append(
            raw if raw is not None else str(existing.get("revision") or "").encode()
        )
        revision_parts.append(repr(sorted(recipes[composition].items())).encode())
    revision = artist_hero_revision(*revision_parts)
    artist_id = int(artist_row["id"])
    fallback_image = next(iter(loaded_sources.values()))[1]
    desktop_image = loaded_sources.get("desktop", (None, fallback_image))[1]
    mobile_image = loaded_sources.get("mobile", (None, fallback_image))[1]
    desktop_source_width = existing.get("desktop_source_width")
    desktop_source_height = existing.get("desktop_source_height")
    mobile_source_width = existing.get("mobile_source_width")
    mobile_source_height = existing.get("mobile_source_height")
    if "desktop" in loaded_sources:
        desktop_source_width, desktop_source_height = desktop_image.size
    if "mobile" in loaded_sources:
        mobile_source_width, mobile_source_height = mobile_image.size
    desktop_enabled = existing.get("desktop_enabled", True) is not False
    mobile_enabled = existing.get("mobile_enabled", True) is not False
    render_manifest = _publish_artist_hero_manifest(
        artist_row=artist_row,
        revision=revision,
        rendered=rendered_compositions,
        raw_sources={target: raw for target, (raw, _image) in loaded_sources.items()},
        recipes=recipes,
        existing=existing,
        enabled=tuple(
            composition
            for composition, is_enabled in (
                ("desktop", desktop_enabled),
                ("mobile", mobile_enabled),
            )
            if is_enabled
        ),
    )
    applied = upsert_artist_hero_artwork(
        artist_id=artist_id,
        provenance=str(existing["provenance"]),
        review_status=str(existing["review_status"]),
        source_width=int(existing.get("source_width") or desktop_image.width),
        source_height=int(existing.get("source_height") or desktop_image.height),
        desktop_recipe=desktop_recipe,
        mobile_recipe=mobile_recipe,
        revision=revision,
        desktop_source_width=desktop_source_width,
        desktop_source_height=desktop_source_height,
        desktop_source_origin=existing.get("desktop_source_origin"),
        mobile_source_width=mobile_source_width,
        mobile_source_height=mobile_source_height,
        mobile_source_origin=existing.get("mobile_source_origin"),
        render_manifest=render_manifest,
        expected_revision=existing.get("revision"),
    )
    if applied is False:
        return {
            "status": "conflict",
            "reason": "artist-hero-profile-changed",
            "artist_id": artist_id,
        }
    entity_uid = str(artist_row.get("entity_uid") or "")
    if entity_uid:
        for composition in loaded_sources:
            queue_artwork_materialization(
                ArtworkAsset("artist-hero", f"{entity_uid}:{composition}"),
                reason="renderer-migration",
            )
    _broadcast_artwork_invalidation(f"artist:{artist_id}", "library", "home")
    _warm_recent_home_discovery_snapshots()
    return {"status": "recomposed", "artist_id": artist_id, "revision": revision}


def _handle_derive_artist_hero(task_id: str, params: dict, config: dict) -> dict:
    del task_id
    from PIL import Image

    artist = str(params.get("artist") or "").strip()
    if not artist:
        return {"error": "Artist is required"}
    artist_row = get_library_artist(artist)
    if not artist_row:
        return {"error": "Artist not found"}
    artist_id = int(artist_row["id"])
    existing = get_artist_hero_artwork(artist_id)
    if existing and existing.get("provenance") == "manual":
        return {"status": "skipped", "reason": "manual-artwork"}

    lib = Path(config["library_path"]).resolve()
    artist_dir = resolve_artist_dir(
        lib, artist_row, fallback_name=artist, existing_only=True
    )
    if not artist_dir or not artist_dir.is_dir():
        return {"status": "skipped", "reason": "missing-background"}
    artist_dir = artist_dir.resolve()
    if not artist_dir.is_relative_to(lib):
        return {"error": "Artist directory is outside the library"}
    background_path = artist_dir / "background.jpg"
    if not background_path.is_file():
        return {"status": "skipped", "reason": "missing-background"}

    try:
        raw = background_path.read_bytes()
        with Image.open(_io.BytesIO(raw)) as opened:
            opened.load()
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except (OSError, ValueError):
        return {"status": "skipped", "reason": "invalid-background"}
    if image.width < 1600 or image.height < 720:
        return {"status": "skipped", "reason": "insufficient-resolution"}

    desktop_recipe, mobile_recipe = _derived_hero_recipes(image.width, image.height)
    rendered = render_artist_hero_compositions(
        image,
        desktop_recipe=desktop_recipe,
        mobile_recipe=mobile_recipe,
    )
    image.save(artist_dir / "artist-hero-source.jpg", "JPEG", quality=94)
    _save_artist_hero_webp_atomic(
        rendered["desktop"], artist_dir / "artist-hero-desktop.webp"
    )
    _save_artist_hero_webp_atomic(
        rendered["mobile"], artist_dir / "artist-hero-mobile.webp"
    )
    revision = artist_hero_revision(raw, b":derived-hero")
    render_manifest = _publish_artist_hero_manifest(
        artist_row=artist_row,
        revision=revision,
        rendered=rendered,
        raw_sources={"desktop": raw, "mobile": raw},
        recipes={"desktop": desktop_recipe, "mobile": mobile_recipe},
        existing=existing or {},
        enabled=("desktop", "mobile"),
    )
    applied = upsert_artist_hero_artwork(
        artist_id=artist_id,
        provenance="derived_background",
        review_status="unreviewed",
        source_width=image.width,
        source_height=image.height,
        desktop_recipe=desktop_recipe,
        mobile_recipe=mobile_recipe,
        revision=revision,
        desktop_enabled=True,
        mobile_enabled=True,
        render_manifest=render_manifest,
        expected_revision=(existing or {}).get("revision"),
    )
    if applied is False:
        return {
            "status": "conflict",
            "reason": "artist-hero-profile-changed",
            "artist_id": artist_id,
        }
    entity_uid = str(artist_row.get("entity_uid") or "")
    if entity_uid:
        for composition in ("desktop", "mobile"):
            queue_artwork_materialization(
                ArtworkAsset("artist-hero", f"{entity_uid}:{composition}"),
                reason="source-write",
            )
    _broadcast_artwork_invalidation(f"artist:{artist_id}", "library", "home")
    _warm_recent_home_discovery_snapshots()
    return {
        "status": "derived",
        "artist_id": artist_id,
        "revision": revision,
    }


def _handle_backfill_artist_heroes(task_id: str, params: dict, config: dict) -> dict:
    del task_id, config
    after_id = max(0, int(params.get("after_artist_id") or 0))
    batch_size = max(1, min(int(params.get("batch_size") or 25), 100))
    candidates = list_artist_hero_backfill_candidates(
        after_id=after_id, limit=batch_size
    )
    for candidate in candidates:
        create_task_dedup(
            "derive_artist_hero",
            {"artist": candidate["name"]},
            dedup_key=f"derive-artist-hero:{candidate['id']}",
        )
    next_queued = len(candidates) >= batch_size
    next_after_id = int(candidates[-1]["id"]) if candidates else after_id
    if next_queued:
        create_task_dedup(
            "backfill_artist_heroes",
            {"after_artist_id": next_after_id, "batch_size": batch_size},
            dedup_key=f"backfill-artist-heroes:{next_after_id}:{batch_size}",
        )
    return {
        "status": "continued" if next_queued else "completed",
        "queued": len(candidates),
        "after_artist_id": next_after_id,
        "next_queued": next_queued,
    }


def _handle_fetch_album_cover(task_id: str, params: dict, config: dict) -> dict:
    """Search all sources for a cover for a specific album."""
    from crate.artwork import extract_embedded_cover, fetch_cover_from_caa, save_cover

    artist = params.get("artist", "")
    album = params.get("album", "")
    path = params.get("path", "")
    mbid = params.get("mbid", "")
    album_id = params.get("album_id")

    album_dir = Path(path) if path else None
    if not album_dir or not album_dir.is_dir():
        return {"error": "Album directory not found"}

    if any((album_dir / c).exists() for c in ("cover.jpg", "cover.png", "folder.jpg")):
        return {"status": "already_has_cover"}

    cover_data = None
    source = None

    # 1. CoverArtArchive (MBID)
    if mbid and mbid.strip():
        cover_data = fetch_cover_from_caa(mbid)
        if cover_data:
            source = "coverartarchive"

    # 2. Embedded in audio files
    if not cover_data:
        audio_files = list(album_dir.glob("*.flac")) + list(album_dir.glob("*.mp3"))
        for audio_file in audio_files[:1]:
            embedded = extract_embedded_cover(audio_file)
            if embedded:
                cover_data = embedded
                source = "embedded"
                break

    # 3. Deezer
    if not cover_data:
        cover_data = _fetch_deezer_cover(artist, album)
        if cover_data:
            source = "deezer"

    # 4. iTunes
    if not cover_data:
        cover_data = _fetch_itunes_cover(artist, album)
        if cover_data:
            source = "itunes"

    # 5. Last.fm
    if not cover_data:
        cover_data = _fetch_lastfm_cover(artist, album)
        if cover_data:
            source = "lastfm"

    # 6. MusicBrainz search (if no MBID)
    if not cover_data and not (mbid and mbid.strip()):
        cover_data = _search_musicbrainz_cover(artist, album)
        if cover_data:
            source = "musicbrainz"

    if cover_data:
        save_cover(album_dir, cover_data)
        if album_id:
            set_album_has_cover(album_id)
            album_row = get_library_album_by_id(int(album_id))
            if album_row and album_row.get("entity_uid"):
                queue_artwork_materialization(
                    ArtworkAsset("album-cover", str(album_row["entity_uid"])),
                    reason="source-write",
                )
        emit_task_event(
            task_id,
            "cover_applied",
            {
                "message": f"Cover found for {artist} / {album} ({source})",
                "source": source,
            },
        )
        return {"status": "found", "source": source}

    return {
        "status": "not_found",
        "sources_tried": [
            "coverartarchive",
            "embedded",
            "deezer",
            "itunes",
            "lastfm",
            "musicbrainz",
        ],
    }


ARTWORK_TASK_HANDLERS: dict[str, TaskHandler] = {
    "materialize_artwork_variants": _handle_materialize_artwork_variants,
    "backfill_artwork_variants": _handle_backfill_artwork_variants,
    "backfill_artist_heroes": _handle_backfill_artist_heroes,
    "compose_artist_hero": _handle_compose_artist_hero,
    "preview_artist_hero": _handle_preview_artist_hero,
    "recompose_artist_hero": _handle_recompose_artist_hero,
    "derive_artist_hero": _handle_derive_artist_hero,
    "cleanup_artwork_variants": _handle_cleanup_artwork_variants,
    "repair_artwork_variants": _handle_repair_artwork_variants,
    "resolve_external_artist_artwork": _handle_resolve_external_artist_artwork,
    "fetch_cover": _handle_fetch_cover,
    "fetch_album_cover": _handle_fetch_album_cover,
    "fetch_artist_covers": _handle_fetch_artist_covers,
    "fetch_artwork_all": _handle_fetch_artwork_all,
    "batch_covers": _handle_batch_covers,
    "scan_missing_covers": _handle_scan_missing_covers,
    "apply_cover": _handle_apply_cover,
    "assign_artist_artwork_slot": _handle_assign_artist_artwork_slot,
    "delete_artist_artwork_asset": _handle_delete_artist_artwork_asset,
    "delete_artist_hero_composition": _handle_delete_artist_hero_composition,
    "import_artist_artwork_asset": _handle_import_artist_artwork_asset,
    "upload_image": _handle_upload_image,
}
