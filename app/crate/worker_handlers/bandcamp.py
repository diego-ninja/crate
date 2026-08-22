from __future__ import annotations

import logging
import os
import re
import shutil
import time
from pathlib import Path

from crate.bandcamp.collection_sync import (
    BandcampCollectionSyncError,
    sync_collection_with_command,
)
from crate.bandcamp.client import BandcampClient, BandcampClientError
from crate.bandcamp.client import session_material_from_payload
from crate.bandcamp.credential_broker import (
    BandcampCredentialBridgeChallenge,
    BandcampCredentialBridgeDisabled,
    login_with_credentials,
)
from crate.bandcamp.credentials import (
    CredentialSecretError,
    fingerprint_secret,
    load_secret,
    revoke_secret,
    store_secret,
)
from crate.bandcamp.downloads import (
    BandcampDownloadError,
    download_purchase_with_command,
)
from crate.bandcamp.discover import (
    BandcampDiscoverAuthError,
    BandcampDiscoverClient,
    BandcampDiscoverError,
    BandcampDiscoverRateLimited,
    bandcamp_discover_enabled,
)
from crate.bandcamp.matcher import create_matches_for_bandcamp_item
from crate.bandcamp.search import (
    BandcampSearchError,
    find_bandcamp_url_in_metadata,
    find_exact_album_url,
    find_exact_artist_url,
)
from crate.db.events import emit_task_event
from crate.db.jobs.bandcamp import bandcamp_write_scope
from crate.db.repositories.bandcamp import (
    backfill_confirmed_bandcamp_entity_urls,
    complete_pairing_challenge,
    create_bandcamp_import,
    get_bandcamp_global_import_guard,
    get_bandcamp_import,
    get_connection_by_id,
    get_connection_for_user,
    get_existing_bandcamp_library_import,
    get_latest_bandcamp_import_for_item,
    get_user_owned_bandcamp_item,
    list_bandcamp_item_ids,
    list_library_albums_missing_bandcamp_urls,
    list_library_artists_missing_bandcamp_urls,
    mark_connection_error,
    mark_connection_synced,
    mark_bandcamp_imports_withdrawn,
    mark_user_bandcamp_items_removed,
    refresh_bandcamp_radar_for_user,
    refresh_bandcamp_discover_for_user,
    set_library_entity_bandcamp_url,
    set_bandcamp_import_task,
    update_bandcamp_import_status,
    upsert_connection,
    upsert_bandcamp_item,
    upsert_user_bandcamp_item,
)
from crate.db.repositories.library_contributions import (
    count_active_album_contributors,
    get_user_album_contribution,
    mark_album_contribution_withdrawn,
)
from crate.db.repositories.library import get_library_album
from crate.db.repositories.tasks import create_task
from crate.db.queries.browse import find_album_row
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

_BANDCAMP_IMPORT_ACTIVE_STATUSES = {"queued", "downloading", "importing"}
_BANDCAMP_IMPORT_DONE_STATUSES = {"completed"}
_BANDCAMP_SOURCE_REF_RE = re.compile(r"^bandcamp:(?P<item_id>\d+)(?::\d+)?$")
_BANDCAMP_PUBLIC_SEARCH_DELAY_SECONDS = 0.35


def _queue_missing_bandcamp_import(
    *,
    user_id: int,
    connection_id: int,
    bandcamp_item_id: int,
    item: dict,
    parent_task_id: str,
    requested_format: str = "flac",
) -> str | None:
    global_guard = get_bandcamp_global_import_guard(
        bandcamp_item_id=bandcamp_item_id,
        artist_name=str(item.get("artist_name") or ""),
        album_title=str(item.get("album_title") or ""),
    )
    if global_guard:
        return None

    existing_import = get_existing_bandcamp_library_import(
        bandcamp_item_id=bandcamp_item_id,
    )
    if existing_import:
        return None

    latest = get_latest_bandcamp_import_for_item(
        user_id=user_id,
        bandcamp_item_id=bandcamp_item_id,
    )
    if latest and latest.get("status") in (
        _BANDCAMP_IMPORT_ACTIVE_STATUSES | _BANDCAMP_IMPORT_DONE_STATUSES
    ):
        return None

    import_row = create_bandcamp_import(
        user_id=user_id,
        connection_id=connection_id,
        bandcamp_item_id=bandcamp_item_id,
        requested_format=requested_format,
    )
    task_id = create_task(
        "bandcamp_import_purchase",
        {
            "user_id": user_id,
            "connection_id": connection_id,
            "bandcamp_import_id": int(import_row["id"]),
            "bandcamp_item_id": bandcamp_item_id,
            "format": requested_format,
            "force": latest is not None and latest.get("status") == "failed",
        },
        parent_task_id=parent_task_id,
    )
    set_bandcamp_import_task(int(import_row["id"]), task_id)
    return task_id


def _bandcamp_item_exists_in_library(item: dict) -> bool:
    artist_name = str(item.get("artist_name") or "").strip()
    album_title = str(item.get("album_title") or "").strip()
    if not artist_name or not album_title:
        return False
    return find_album_row(artist_name, album_title) is not None


def _bandcamp_item_id_from_source_ref(source_ref: str | None) -> int | None:
    match = _BANDCAMP_SOURCE_REF_RE.match(str(source_ref or "").strip())
    if not match:
        return None
    return int(match.group("item_id"))


def _delete_library_album_for_withdrawal(
    task_id: str,
    contribution: dict,
    config: dict,
    *,
    exclude_user_id: int | None = None,
) -> dict:
    album_id = contribution.get("album_id")
    if not album_id:
        return {"deleted": False, "reason": "missing_album_id"}

    if (
        count_active_album_contributors(int(album_id), exclude_user_id=exclude_user_id)
        > 0
    ):
        return {"deleted": False, "reason": "shared_album"}

    artist = str(contribution.get("artist_name") or "").strip()
    album = str(contribution.get("album_name") or "").strip()
    if not artist or not album:
        return {"deleted": False, "reason": "missing_album_identity"}

    from crate.worker_handlers.management import _handle_delete_album

    result = _handle_delete_album(
        task_id,
        {"artist": artist, "album": album, "mode": "full"},
        config,
    )
    return {"deleted": True, "result": result}


def _handle_bandcamp_connect_credentials(
    task_id: str, params: dict, config: dict
) -> dict:
    user_id = int(params["user_id"])
    pairing_id = str(params["pairing_id"])
    credential_secret_ref = str(params["credential_secret_ref"])
    progress = TaskProgress(phase="bandcamp_auth", phase_count=1, total=1, done=0)
    emit_progress(task_id, progress)
    emit_task_event(
        task_id,
        "bandcamp.auth.started",
        {"message": "Starting Bandcamp credential bridge login"},
    )

    if is_cancelled(task_id):
        complete_pairing_challenge(pairing_id, status="cancelled")
        return {"cancelled": True}

    try:
        credentials = load_secret(
            credential_secret_ref, scope="bandcamp_web_credentials"
        )
        result = login_with_credentials(
            email=str(credentials.get("email") or ""),
            password=str(credentials.get("password") or ""),
        )
        if result.status != "connected" or not result.session:
            raise BandcampCredentialBridgeChallenge(
                result.message or "Bandcamp login requires manual challenge"
            )

        identity = BandcampClient(result.session).validate_session()
        session_secret_ref = store_secret(
            "bandcamp_session",
            {
                "cookies": result.session.cookies,
                "profile": {
                    "username": identity.username,
                    "fan_id": identity.fan_id,
                    "display_name": identity.display_name,
                    "image_url": identity.image_url,
                },
            },
        )
        upsert_connection(
            user_id=user_id,
            session_secret_ref=session_secret_ref,
            session_fingerprint=fingerprint_secret({"cookies": result.session.cookies}),
            connection_method="web_credential_bridge",
            username=identity.username,
            fan_id=identity.fan_id,
            display_name=identity.display_name,
            image_url=identity.image_url,
        )
        complete_pairing_challenge(
            pairing_id,
            status="connected",
            result={"username": identity.username, "fan_id": identity.fan_id},
        )
        progress.done = 1
        emit_progress(task_id, progress)
        emit_task_event(
            task_id,
            "bandcamp.auth.succeeded",
            {"message": "Bandcamp account connected", "username": identity.username},
        )
        return {"connected": True, "username": identity.username}
    except BandcampCredentialBridgeDisabled as exc:
        mark_connection_error(user_id, str(exc))
        complete_pairing_challenge(
            pairing_id,
            status="failed",
            result={"message": str(exc), "code": "bridge_disabled"},
        )
        emit_task_event(task_id, "bandcamp.auth.failed", {"message": str(exc)})
        raise
    except BandcampCredentialBridgeChallenge as exc:
        mark_connection_error(user_id, str(exc))
        complete_pairing_challenge(
            pairing_id,
            status="challenge_required",
            result={"message": str(exc), "code": "challenge_required"},
        )
        emit_task_event(
            task_id,
            "bandcamp.auth.challenge_required",
            {"message": str(exc)},
        )
        raise
    finally:
        revoke_secret(credential_secret_ref)


def _handle_bandcamp_sync_collection(task_id: str, params: dict, config: dict) -> dict:
    user_id = int(params["user_id"])
    connection_id = int(params["connection_id"])
    include = [
        str(value)
        for value in (params.get("include") or ["collection"])
        if str(value) in {"collection", "wishlist", "following"}
    ] or ["collection"]
    auto_import_purchases = bool(params.get("auto_import_purchases", True))
    requested_format = str(params.get("format") or "flac").strip().lower() or "flac"
    progress = TaskProgress(
        phase="bandcamp_sync",
        phase_count=1,
        total=1,
        done=0,
    )
    emit_progress(task_id, progress)
    emit_task_event(
        task_id,
        "bandcamp.sync.started",
        {"message": "Starting Bandcamp collection sync", "include": include},
    )

    if is_cancelled(task_id):
        return {"cancelled": True}

    connection = get_connection_by_id(connection_id)
    if not connection or int(connection["user_id"]) != user_id:
        raise RuntimeError("Bandcamp connection not found")

    try:
        session_payload = load_secret(
            str(connection["session_secret_ref"]),
            scope="bandcamp_session",
        )
        session_material = session_material_from_payload(session_payload)
        sync_result = sync_collection_with_command(session_material, include=include)
        total = max(len(sync_result.items), 1)
        progress.total = total
        emit_progress(task_id, progress, force=True)

        counts = {relation_type: 0 for relation_type in include}
        matches_created = 0
        removed = {relation_type: 0 for relation_type in include}
        seen_item_ids = {relation_type: [] for relation_type in include}
        import_candidates: list[int] = []

        with bandcamp_write_scope() as session:
            for index, synced in enumerate(sync_result.items, start=1):
                item = upsert_bandcamp_item(synced.item, session=session)
                local_item_id = int(item["id"])
                upsert_user_bandcamp_item(
                    user_id=user_id,
                    connection_id=connection_id,
                    bandcamp_item_id=local_item_id,
                    relation_type=synced.relation_type,
                    owned=synced.owned,
                    downloadable=synced.downloadable,
                    purchase_date=synced.purchase_date,
                    added_at=synced.added_at,
                    raw=synced.raw,
                    session=session,
                )
                counts[synced.relation_type] = counts.get(synced.relation_type, 0) + 1
                seen_item_ids.setdefault(synced.relation_type, []).append(local_item_id)
                if (
                    auto_import_purchases
                    and synced.relation_type == "collection"
                    and synced.owned
                    and synced.downloadable
                ):
                    import_candidates.append(local_item_id)
                matches_created += len(
                    create_matches_for_bandcamp_item(local_item_id, session=session)
                )
                if index == total or index % 25 == 0:
                    progress.done = index
                    emit_progress(task_id, progress)

            for relation_type in include:
                removed[relation_type] = mark_user_bandcamp_items_removed(
                    user_id=user_id,
                    relation_type=relation_type,
                    seen_item_ids=seen_item_ids.get(relation_type, []),
                    session=session,
                )
            radar = refresh_bandcamp_radar_for_user(user_id, session=session)
            mark_connection_synced(connection_id, session=session)

        queued_imports = 0
        skipped_existing = 0
        for bandcamp_item_id in import_candidates:
            item = get_user_owned_bandcamp_item(
                user_id=user_id,
                bandcamp_item_id=bandcamp_item_id,
            )
            if not item:
                continue
            if _bandcamp_item_exists_in_library(item):
                skipped_existing += 1
                continue
            child_task_id = _queue_missing_bandcamp_import(
                user_id=user_id,
                connection_id=connection_id,
                bandcamp_item_id=bandcamp_item_id,
                item=item,
                parent_task_id=task_id,
                requested_format=requested_format,
            )
            if child_task_id:
                queued_imports += 1

        progress.done = total
        emit_progress(task_id, progress, force=True)
        emit_task_event(
            task_id,
            "bandcamp.sync.succeeded",
            {
                "message": "Bandcamp collection synced",
                "counts": counts,
                "removed": removed,
                "matches_created": matches_created,
                "radar_upserted": radar.get("upserted", 0),
                "imports_queued": queued_imports,
                "imports_skipped_existing": skipped_existing,
            },
        )
        return {
            "synced": sum(counts.values()),
            "counts": counts,
            "removed": removed,
            "matches_created": matches_created,
            "radar_upserted": radar.get("upserted", 0),
            "imports_queued": queued_imports,
            "imports_skipped_existing": skipped_existing,
        }
    except BandcampCollectionSyncError as exc:
        mark_connection_error(user_id, str(exc))
        emit_task_event(task_id, "bandcamp.sync.failed", {"message": str(exc)})
        raise


def _handle_bandcamp_backfill_entity_urls(
    task_id: str,
    params: dict,
    config: dict,
) -> dict:
    limit = max(1, min(int(params.get("limit") or 100), 5000))
    public_search = bool(params.get("public_search", True))
    include_artists = bool(params.get("artists", True))
    include_albums = bool(params.get("albums", True))
    progress = TaskProgress(
        phase="bandcamp_backfill",
        phase_count=1,
        total=1,
        done=0,
    )
    emit_progress(task_id, progress)
    emit_task_event(
        task_id,
        "bandcamp.backfill.started",
        {
            "message": "Backfilling Bandcamp entity URLs",
            "limit": limit,
            "public_search": public_search,
        },
    )

    if is_cancelled(task_id):
        return {"cancelled": True}

    item_ids = list_bandcamp_item_ids(limit=limit)
    matches_created = 0
    with bandcamp_write_scope() as session:
        for item_id in item_ids:
            matches_created += len(
                create_matches_for_bandcamp_item(item_id, session=session)
            )
        internal_backfill = backfill_confirmed_bandcamp_entity_urls(
            limit=limit,
            session=session,
        )

    public_artist_updates = 0
    public_album_updates = 0
    public_errors = 0
    artist_targets = (
        list_library_artists_missing_bandcamp_urls(limit=limit)
        if public_search and include_artists
        else []
    )
    album_targets = (
        list_library_albums_missing_bandcamp_urls(limit=limit)
        if public_search and include_albums
        else []
    )
    progress.total = max(len(artist_targets) + len(album_targets), 1)
    emit_progress(task_id, progress, force=True)

    index = 0
    for row in artist_targets:
        index += 1
        if is_cancelled(task_id):
            return {"cancelled": True}
        try:
            url = find_bandcamp_url_in_metadata(
                row.get("urls_json"),
                entity_type="artist",
            )
            source = "bandcamp:metadata_url"
            if not url:
                url = find_exact_artist_url(
                    str(row.get("name") or ""),
                    allow_search=False,
                )
                source = "bandcamp:direct_probe"
            if url and set_library_entity_bandcamp_url(
                entity_type="artist",
                entity_uid=str(row["entity_uid"]),
                url=url,
                source=source,
            ):
                public_artist_updates += 1
        except BandcampSearchError as exc:
            public_errors += 1
            emit_task_event(
                task_id,
                "bandcamp.backfill.lookup_error",
                {"message": str(exc), "entity_type": "artist"},
            )
        progress.done = index
        if index == progress.total or index % 10 == 0:
            emit_progress(task_id, progress)
        if index < progress.total:
            time.sleep(_BANDCAMP_PUBLIC_SEARCH_DELAY_SECONDS)

    if public_search and include_albums and public_artist_updates:
        album_targets = list_library_albums_missing_bandcamp_urls(limit=limit)

    for row in album_targets:
        index += 1
        if is_cancelled(task_id):
            return {"cancelled": True}
        try:
            artist_url = row.get(
                "artist_bandcamp_url"
            ) or find_bandcamp_url_in_metadata(
                row.get("artist_urls_json"),
                entity_type="artist",
            )
            url = find_exact_album_url(
                str(row.get("artist") or ""),
                str(row.get("name") or ""),
                artist_url=str(artist_url or ""),
                allow_search=False,
            )
            if url and set_library_entity_bandcamp_url(
                entity_type="album",
                entity_uid=str(row["entity_uid"]),
                url=url,
                source="bandcamp:direct_probe",
            ):
                public_album_updates += 1
        except BandcampSearchError as exc:
            public_errors += 1
            emit_task_event(
                task_id,
                "bandcamp.backfill.lookup_error",
                {"message": str(exc), "entity_type": "album"},
            )
        progress.done = index
        if index == progress.total or index % 10 == 0:
            emit_progress(task_id, progress)
        if index < progress.total:
            time.sleep(_BANDCAMP_PUBLIC_SEARCH_DELAY_SECONDS)

    result = {
        "items_scanned": len(item_ids),
        "matches_created": matches_created,
        "confirmed_urls_scanned": internal_backfill.get("scanned", 0),
        "confirmed_urls_updated": internal_backfill.get("updated", 0),
        "public_artist_urls_updated": public_artist_updates,
        "public_album_urls_updated": public_album_updates,
        "public_search_errors": public_errors,
    }
    progress.done = progress.total
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "bandcamp.backfill.succeeded",
        {"message": "Bandcamp entity URL backfill completed", **result},
    )
    return result


def _handle_bandcamp_import_purchase(task_id: str, params: dict, config: dict) -> dict:
    user_id = int(params["user_id"])
    connection_id = int(params["connection_id"])
    import_id = int(params["bandcamp_import_id"])
    bandcamp_item_id = int(params["bandcamp_item_id"])
    requested_format = str(params.get("format") or "flac").strip().lower() or "flac"

    progress = TaskProgress(phase="bandcamp_import", phase_count=3, total=3, done=0)
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "bandcamp.import.started",
        {"message": "Starting Bandcamp purchase import", "format": requested_format},
    )

    if is_cancelled(task_id):
        update_bandcamp_import_status(import_id, status="cancelled")
        return {"cancelled": True}

    connection = get_connection_by_id(connection_id)
    if not connection or int(connection["user_id"]) != user_id:
        update_bandcamp_import_status(
            import_id,
            status="failed",
            error="Bandcamp connection not found",
        )
        raise RuntimeError("Bandcamp connection not found")

    import_row = get_bandcamp_import(import_id, user_id=user_id)
    owned_item = get_user_owned_bandcamp_item(
        user_id=user_id,
        bandcamp_item_id=bandcamp_item_id,
    )
    if not import_row or not owned_item:
        update_bandcamp_import_status(
            import_id,
            status="failed",
            error="Owned Bandcamp item not found",
        )
        raise RuntimeError("Owned Bandcamp item not found")
    if not owned_item.get("owned") or not owned_item.get("downloadable"):
        update_bandcamp_import_status(
            import_id,
            status="failed",
            error="Bandcamp item is not downloadable",
        )
        raise RuntimeError("Bandcamp item is not downloadable")

    duplicate_guard = get_bandcamp_global_import_guard(
        bandcamp_item_id=bandcamp_item_id,
        artist_name=str(owned_item.get("artist_name") or ""),
        album_title=str(owned_item.get("album_title") or ""),
        exclude_import_id=import_id,
    )
    if duplicate_guard or _bandcamp_item_exists_in_library(owned_item):
        update_bandcamp_import_status(
            import_id,
            status="skipped",
            error="Bandcamp purchase already exists in the Crate library",
            imported_album_uid=duplicate_guard.get("imported_album_uid")
            if duplicate_guard
            else None,
            imported_track_uids=duplicate_guard.get("imported_track_uids")
            if duplicate_guard
            else None,
        )
        emit_task_event(
            task_id,
            "bandcamp.import.skipped",
            {"message": "Bandcamp purchase already exists in the Crate library"},
        )
        return {
            "success": True,
            "skipped": True,
            "reason": "already_in_library",
            "import_id": import_id,
        }

    staging_dir = _bandcamp_import_staging_dir(import_id)
    raw_dir = staging_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    try:
        update_bandcamp_import_status(import_id, status="downloading")
        session_payload = load_secret(
            str(connection["session_secret_ref"]),
            scope="bandcamp_session",
        )
        session_material = session_material_from_payload(session_payload)
        download_result = download_purchase_with_command(
            session_material,
            item=owned_item,
            output_dir=raw_dir,
            requested_format=requested_format,
        )
        progress.done = 1
        progress.phase = "importing"
        emit_progress(task_id, progress, force=True)
        emit_task_event(
            task_id,
            "bandcamp.import.downloaded",
            {
                "message": "Bandcamp archive downloaded",
                "archives": len(download_result.archive_paths),
            },
        )

        from crate.worker_handlers.acquisition import _handle_library_upload

        update_bandcamp_import_status(import_id, status="importing")
        upload_result = _handle_library_upload(
            task_id,
            {
                "staging_dir": str(staging_dir),
                "uploader_user_id": user_id,
                "source": "bandcamp",
                "source_ref": f"bandcamp:{owned_item['id']}",
            },
            config,
        )
        if upload_result.get("error"):
            raise BandcampDownloadError(str(upload_result["error"]))

        contribution = next(iter(upload_result.get("contributions") or []), {})
        imported_album_uid = contribution.get("album_entity_uid")
        imported_track_uids = contribution.get("track_entity_uids") or []
        imported_album_id = contribution.get("album_id")
        if not imported_album_uid and imported_album_id:
            album_row = get_library_album(
                str(contribution.get("artist_name") or ""),
                str(contribution.get("album_name") or ""),
            )
            imported_album_uid = album_row.get("entity_uid") if album_row else None

        progress.done = 3
        progress.phase = "complete"
        emit_progress(task_id, progress, force=True)
        update_bandcamp_import_status(
            import_id,
            status="completed",
            source_archive_url="bandcamp://downloaded",
            imported_album_uid=imported_album_uid,
            imported_track_uids=imported_track_uids,
        )
        emit_task_event(
            task_id,
            "bandcamp.import.succeeded",
            {
                "message": "Bandcamp purchase imported",
                "albums_imported": upload_result.get("albums_imported"),
            },
        )
        return {
            "success": True,
            "import_id": import_id,
            "downloaded_archives": len(download_result.archive_paths),
            "upload": upload_result,
        }
    except BandcampDownloadError as exc:
        update_bandcamp_import_status(import_id, status="failed", error=str(exc))
        emit_task_event(task_id, "bandcamp.import.failed", {"message": str(exc)})
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def _bandcamp_import_staging_dir(import_id: int) -> Path:
    root = Path(os.environ.get("DATA_DIR", "/data")) / "bandcamp-imports"
    return root / str(import_id)


def _handle_bandcamp_radar_refresh(task_id: str, params: dict, config: dict) -> dict:
    user_id = int(params["user_id"])
    emit_task_event(
        task_id,
        "bandcamp.radar.started",
        {"message": "Refreshing Bandcamp Radar"},
    )
    radar_result = refresh_bandcamp_radar_for_user(user_id)
    result: dict[str, object] = dict(radar_result)
    result["discover"] = _handle_bandcamp_discover_refresh(task_id, params, config)
    emit_task_event(
        task_id,
        "bandcamp.radar.succeeded",
        {
            "message": "Bandcamp Radar refreshed",
            "upserted": result.get("upserted", 0),
        },
    )
    return result


def _handle_bandcamp_discover_refresh(
    task_id: str,
    params: dict,
    config: dict,
) -> dict:
    del config
    user_id = int(params["user_id"])
    if not bandcamp_discover_enabled():
        return {"enabled": False}

    connection = get_connection_for_user(user_id)
    if not connection or str(connection.get("status") or "") != "connected":
        emit_task_event(
            task_id,
            "bandcamp.discover.skipped",
            {"reason": "inactive_connection"},
        )
        return {"enabled": True, "skipped": "inactive_connection"}

    emit_task_event(task_id, "bandcamp.discover.started", {})
    try:
        session_payload = load_secret(
            str(connection["session_secret_ref"]),
            scope="bandcamp_session",
        )
        session_material = session_material_from_payload(session_payload)
        result = BandcampDiscoverClient(
            session_material,
            cache_key=f"bandcamp:discover:user:{user_id}",
        ).fetch_followed()
        persisted = refresh_bandcamp_discover_for_user(
            user_id,
            [
                {
                    "item": entry.item,
                    "page_cursor": entry.page_cursor,
                    "rank": entry.rank,
                }
                for entry in result.items
            ],
            last_cursor=result.last_cursor,
            cache_metadata=result.cache_metadata,
        )
        response = {
            "enabled": True,
            "pages_fetched": result.pages_fetched,
            "items_accepted": len(result.items),
            "items_skipped": result.skipped_items,
            "upserted": persisted.get("upserted", 0),
            "stale": persisted.get("stale", 0),
            "cache_hit": result.cache_hit,
        }
        emit_task_event(task_id, "bandcamp.discover.succeeded", response)
        return response
    except (
        BandcampDiscoverAuthError,
        BandcampClientError,
        CredentialSecretError,
    ) as exc:
        response = {"enabled": True, "session_error": 1}
        emit_task_event(
            task_id,
            "bandcamp.discover.session_error",
            {"message": str(exc)},
        )
        return response
    except BandcampDiscoverRateLimited as exc:
        response = {"enabled": True, "rate_limited": 1}
        emit_task_event(
            task_id,
            "bandcamp.discover.rate_limited",
            {"message": str(exc)},
        )
        return response
    except BandcampDiscoverError as exc:
        response = {"enabled": True, "provider_error": 1}
        emit_task_event(
            task_id,
            "bandcamp.discover.failed",
            {"message": str(exc)},
        )
        return response


def _handle_bandcamp_withdraw_contribution(
    task_id: str, params: dict, config: dict
) -> dict:
    user_id = int(params["user_id"])
    contribution_id = int(params["contribution_id"])

    progress = TaskProgress(phase="bandcamp_withdraw", phase_count=2, total=2, done=0)
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "bandcamp.withdraw.started",
        {"message": "Withdrawing Bandcamp contribution"},
    )

    contribution = get_user_album_contribution(
        user_id=user_id,
        contribution_id=contribution_id,
        source="bandcamp",
    )
    if not contribution:
        raise RuntimeError("Bandcamp contribution not found")
    if contribution.get("status") != "active":
        return {"withdrawn": False, "reason": "not_active"}

    if is_cancelled(task_id):
        return {"cancelled": True}

    withdrawn = mark_album_contribution_withdrawn(
        user_id=user_id,
        contribution_id=contribution_id,
        source="bandcamp",
    )
    if not withdrawn:
        raise RuntimeError("Bandcamp contribution could not be withdrawn")

    bandcamp_item_id = _bandcamp_item_id_from_source_ref(contribution.get("source_ref"))
    imports_withdrawn = 0
    if bandcamp_item_id is not None:
        imports_withdrawn = mark_bandcamp_imports_withdrawn(
            user_id=user_id,
            bandcamp_item_id=bandcamp_item_id,
        )

    progress.done = 1
    emit_progress(task_id, progress, force=True)

    delete_result = _delete_library_album_for_withdrawal(task_id, contribution, config)

    progress.done = 2
    progress.phase = "complete"
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "bandcamp.withdraw.succeeded",
        {
            "message": "Bandcamp contribution withdrawn",
            "album_deleted": bool(delete_result.get("deleted")),
            "imports_withdrawn": imports_withdrawn,
        },
    )
    return {
        "withdrawn": True,
        "contribution_id": contribution_id,
        "imports_withdrawn": imports_withdrawn,
        "album_delete": delete_result,
    }


def _handle_bandcamp_cleanup_user_contributions(
    task_id: str, params: dict, config: dict
) -> dict:
    user_id = int(params["user_id"])
    raw_contributions = params.get("contributions") or []
    contributions = [item for item in raw_contributions if isinstance(item, dict)]
    progress = TaskProgress(
        phase="bandcamp_user_cleanup",
        phase_count=1,
        total=max(len(contributions), 1),
        done=0,
    )
    emit_progress(task_id, progress, force=True)

    deleted = 0
    skipped = 0
    seen_album_ids: set[int] = set()
    for index, contribution in enumerate(contributions, start=1):
        if is_cancelled(task_id):
            return {"cancelled": True, "deleted": deleted, "skipped": skipped}

        album_id = contribution.get("album_id")
        if album_id is None:
            skipped += 1
            continue
        try:
            album_id_int = int(album_id)
        except (TypeError, ValueError):
            skipped += 1
            continue
        if album_id_int in seen_album_ids:
            skipped += 1
            continue
        seen_album_ids.add(album_id_int)

        remaining = count_active_album_contributors(
            album_id_int,
            exclude_user_id=user_id,
        )
        if remaining > 0:
            skipped += 1
        else:
            result = _delete_library_album_for_withdrawal(
                task_id,
                contribution,
                config,
                exclude_user_id=user_id,
            )
            if result.get("deleted"):
                deleted += 1
            else:
                skipped += 1

        progress.done = index
        emit_progress(task_id, progress)

    progress.done = progress.total
    progress.phase = "complete"
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "bandcamp.user_cleanup.succeeded",
        {
            "message": "Bandcamp user contributions cleanup completed",
            "deleted": deleted,
            "skipped": skipped,
        },
    )
    return {"deleted": deleted, "skipped": skipped, "total": len(contributions)}


BANDCAMP_TASK_HANDLERS: dict[str, TaskHandler] = {
    "bandcamp_connect_credentials": _handle_bandcamp_connect_credentials,
    "bandcamp_sync_collection": _handle_bandcamp_sync_collection,
    "bandcamp_discover_refresh": _handle_bandcamp_discover_refresh,
    "bandcamp_import_purchase": _handle_bandcamp_import_purchase,
    "bandcamp_radar_refresh": _handle_bandcamp_radar_refresh,
    "bandcamp_backfill_entity_urls": _handle_bandcamp_backfill_entity_urls,
    "bandcamp_withdraw_contribution": _handle_bandcamp_withdraw_contribution,
    "bandcamp_cleanup_user_contributions": _handle_bandcamp_cleanup_user_contributions,
}
