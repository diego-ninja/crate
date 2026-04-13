import json
import logging
from crate.db import emit_task_event, get_db_ctx, update_task
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)


def _handle_sync_shows(task_id: str, params: dict, config: dict) -> dict:
    """Sync shows from Ticketmaster to DB for all library artists."""
    from crate.db import delete_past_shows, get_library_artists, upsert_show
    from crate.ticketmaster import get_upcoming_shows as tm_get_shows
    from crate.ticketmaster import is_configured

    if not is_configured():
        return {"error": "Ticketmaster not configured"}

    artists, _ = get_library_artists(per_page=10000)
    total = len(artists)
    synced = 0
    shows_found = 0

    for index, artist in enumerate(artists):
        if is_cancelled(task_id):
            break
        name = artist["name"]
        if index % 10 == 0:
            update_task(
                task_id,
                progress=json.dumps({"phase": "fetching", "artist": name, "done": index, "total": total}),
            )

        try:
            events = tm_get_shows(name, limit=20)
            for event in events:
                external_id = event.get("id")
                if not external_id:
                    continue
                upsert_show(
                    external_id=external_id,
                    artist_name=name,
                    date=event.get("local_date") or event.get("date", "")[:10],
                    local_time=event.get("local_time"),
                    venue=event.get("venue"),
                    address_line1=event.get("address_line1"),
                    city=event.get("city"),
                    region=event.get("region"),
                    postal_code=event.get("postal_code"),
                    country=event.get("country"),
                    country_code=event.get("country_code"),
                    latitude=float(event["latitude"]) if event.get("latitude") else None,
                    longitude=float(event["longitude"]) if event.get("longitude") else None,
                    url=event.get("url"),
                    image_url=event.get("image"),
                    lineup=event.get("lineup"),
                    price_range=str(event["price_range"]) if event.get("price_range") else None,
                    status=event.get("status", "onsale"),
                )
                shows_found += 1
            synced += 1
        except Exception:
            log.debug("Failed to sync shows for %s", name, exc_info=True)

    deleted = delete_past_shows(days_old=30)
    return {"artists_checked": synced, "shows_found": shows_found, "old_deleted": deleted}


def _handle_backfill_similarities(task_id: str, params: dict, config: dict) -> dict:
    """Populate artist_similarities from existing similar_json on library_artists."""
    from crate.db import bulk_upsert_similarities, mark_library_status

    with get_db_ctx() as cur:
        cur.execute("SELECT name, similar_json FROM library_artists WHERE similar_json IS NOT NULL")
        rows = cur.fetchall()

    total = len(rows)
    upserted = 0
    for index, row in enumerate(rows):
        if is_cancelled(task_id):
            break
        similar_json = row["similar_json"]
        if not similar_json:
            continue
        try:
            similar = similar_json if isinstance(similar_json, list) else json.loads(similar_json)
        except Exception:
            continue
        if not isinstance(similar, list) or not similar:
            continue
        try:
            bulk_upsert_similarities(row["name"], similar)
            upserted += len(similar)
        except Exception:
            log.warning("backfill_similarities: failed for %s", row["name"], exc_info=True)
        if index % 50 == 0:
            update_task(task_id, progress=json.dumps({"phase": "backfill", "done": index + 1, "total": total}))

    try:
        updated = mark_library_status()
        log.info("backfill_similarities: marked %d rows in_library", updated)
    except Exception:
        log.warning("backfill_similarities: mark_library_status failed", exc_info=True)

    return {"artists_processed": total, "rows_upserted": upserted}


INTEGRATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_shows": _handle_sync_shows,
    "backfill_similarities": _handle_backfill_similarities,
}
