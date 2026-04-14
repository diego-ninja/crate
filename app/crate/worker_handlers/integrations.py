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


def _handle_sync_shows_lastfm(task_id: str, params: dict, config: dict) -> dict:
    """Scrape Last.fm events for a specific city and consolidate with DB."""
    from crate.db.shows import consolidate_show
    from crate.lastfm_events import scrape_lastfm_events
    from pathlib import Path
    from datetime import date, timedelta

    city = params.get("city", "")
    latitude = float(params.get("latitude", 0))
    longitude = float(params.get("longitude", 0))
    radius_km = int(params.get("radius_km", 60))

    if not city or not latitude:
        return {"error": "Missing city or coordinates"}

    emit_task_event(task_id, "info", {"message": f"Scraping Last.fm events near {city}..."})

    events = scrape_lastfm_events(
        city=city,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
        max_pages=10,
        from_date=date.today(),
        to_date=date.today() + timedelta(days=180),
        fetch_details=False,
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
    )

    # Write JSON intermediate for debugging
    try:
        slug = city.lower().replace(" ", "-").replace(",", "")
        json_dir = Path("/data/shows/lastfm")
        json_dir.mkdir(parents=True, exist_ok=True)
        json_path = json_dir / f"{slug}-{date.today().isoformat()}.json"
        json_path.write_text(json.dumps(events, indent=2, ensure_ascii=False, default=str))

        # Clean old intermediates (>7 days)
        for old_file in json_dir.iterdir():
            if old_file.is_file() and old_file.stat().st_mtime < (date.today() - timedelta(days=7)).toordinal():
                old_file.unlink(missing_ok=True)
    except Exception:
        log.debug("Failed to write Last.fm JSON intermediate", exc_info=True)

    # Consolidate
    inserted, merged, skipped = 0, 0, 0
    for i, event in enumerate(events):
        if is_cancelled(task_id):
            break
        if i % 10 == 0:
            update_task(task_id, progress=json.dumps({
                "phase": "consolidating", "done": i, "total": len(events),
            }))
        try:
            result = consolidate_show(event)
            if result == "inserted":
                inserted += 1
            elif result == "merged":
                merged += 1
            else:
                skipped += 1
        except Exception:
            log.debug("Failed to consolidate event: %s", event.get("artist_name"), exc_info=True)
            skipped += 1

    emit_task_event(task_id, "info", {
        "message": f"Last.fm sync for {city}: {len(events)} scraped, {inserted} new, {merged} merged, {skipped} skipped",
    })

    return {
        "city": city,
        "scraped": len(events),
        "inserted": inserted,
        "merged": merged,
        "skipped": skipped,
    }


INTEGRATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "sync_shows": _handle_sync_shows,
    "sync_shows_lastfm": _handle_sync_shows_lastfm,
    "backfill_similarities": _handle_backfill_similarities,
}
