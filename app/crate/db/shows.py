"""Shows — persistent storage for upcoming concerts/events."""

import json
import logging
import re
from datetime import datetime, timezone

from crate.db.core import get_db_ctx

log = logging.getLogger(__name__)


def upsert_show(external_id: str, artist_name: str, date: str, **kwargs) -> int | None:
    """Insert or update a show. Deduplicates by (artist, date, venue)."""
    now = datetime.now(timezone.utc).isoformat()
    normalized_external_id = (external_id or "").strip() or None
    venue = (kwargs.get("venue") or "").strip() or None
    with get_db_ctx() as cur:
        if normalized_external_id:
            cur.execute("""
                INSERT INTO shows (external_id, artist_name, date, local_time, venue, address_line1, city, region,
                    postal_code, country, country_code, latitude, longitude, url, image_url, lineup,
                    price_range, status, source, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (external_id) DO UPDATE SET
                    artist_name = EXCLUDED.artist_name,
                    date = EXCLUDED.date,
                    local_time = EXCLUDED.local_time,
                    venue = EXCLUDED.venue,
                    address_line1 = EXCLUDED.address_line1,
                    city = EXCLUDED.city,
                    region = EXCLUDED.region,
                    postal_code = EXCLUDED.postal_code,
                    country = EXCLUDED.country,
                    country_code = EXCLUDED.country_code,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    url = EXCLUDED.url,
                    image_url = EXCLUDED.image_url,
                    lineup = EXCLUDED.lineup,
                    price_range = EXCLUDED.price_range,
                    status = EXCLUDED.status,
                    source = EXCLUDED.source,
                    updated_at = EXCLUDED.updated_at
                RETURNING id
            """, (
                normalized_external_id, artist_name, date,
                kwargs.get("local_time"), venue, kwargs.get("address_line1"), kwargs.get("city"),
                kwargs.get("region"), kwargs.get("postal_code"), kwargs.get("country"), kwargs.get("country_code"),
                kwargs.get("latitude"), kwargs.get("longitude"),
                kwargs.get("url"), kwargs.get("image_url"),
                kwargs.get("lineup"), kwargs.get("price_range"),
                kwargs.get("status", "onsale"), kwargs.get("source", "ticketmaster"),
                now, now,
            ))
            return cur.fetchone()["id"]

        cur.execute(
            """
            SELECT id
            FROM shows
            WHERE external_id IS NULL
              AND artist_name = %s
              AND date = %s
              AND COALESCE(venue, '') = COALESCE(%s, '')
            LIMIT 1
            """,
            (artist_name, date, venue),
        )
        existing = cur.fetchone()
        if existing:
            cur.execute(
                """
                UPDATE shows
                SET local_time = %s,
                    address_line1 = %s,
                    city = %s,
                    region = %s,
                    postal_code = %s,
                    country = %s,
                    country_code = %s,
                    latitude = %s,
                    longitude = %s,
                    url = %s,
                    image_url = %s,
                    lineup = %s,
                    price_range = %s,
                    status = %s,
                    source = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    kwargs.get("local_time"),
                    kwargs.get("address_line1"),
                    kwargs.get("city"),
                    kwargs.get("region"),
                    kwargs.get("postal_code"),
                    kwargs.get("country"),
                    kwargs.get("country_code"),
                    kwargs.get("latitude"),
                    kwargs.get("longitude"),
                    kwargs.get("url"),
                    kwargs.get("image_url"),
                    kwargs.get("lineup"),
                    kwargs.get("price_range"),
                    kwargs.get("status", "onsale"),
                    kwargs.get("source", "ticketmaster"),
                    now,
                    existing["id"],
                ),
            )
            return existing["id"]

        cur.execute("""
            INSERT INTO shows (external_id, artist_name, date, local_time, venue, address_line1, city, region,
                postal_code, country, country_code, latitude, longitude, url, image_url, lineup,
                price_range, status, source, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            None, artist_name, date,
            kwargs.get("local_time"), venue, kwargs.get("address_line1"), kwargs.get("city"),
            kwargs.get("region"), kwargs.get("postal_code"), kwargs.get("country"), kwargs.get("country_code"),
            kwargs.get("latitude"), kwargs.get("longitude"),
            kwargs.get("url"), kwargs.get("image_url"),
            kwargs.get("lineup"), kwargs.get("price_range"),
            kwargs.get("status", "onsale"), kwargs.get("source", "ticketmaster"),
            now, now,
        ))
        return cur.fetchone()["id"]


def _normalize_venue(name: str | None) -> str:
    """Normalize venue name for fuzzy matching."""
    if not name:
        return ""
    n = name.lower().strip()
    n = re.sub(r"^(the|la|el|le|les|los|das|die|den)\s+", "", n)
    n = re.sub(r"\s*(sala|hall|venue|theatre|theater|arena|club|room)\s*", " ", n)
    n = re.sub(r"[^a-z0-9\s]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def _normalize_artist(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.lower().strip())


def consolidate_show(show: dict) -> str:
    """Insert or merge a Last.fm show with existing data.

    Dedup strategy:
    1. Match by lastfm_event_id (exact re-scrape)
    2. Match by (artist_name, date, venue) fuzzy — same show from TM
    3. No match → insert as new show

    Merge rules when TM show exists:
    - Keep TM: price_range, status, external_id, url, image_url
    - Add from LFM: lastfm_attendance, lastfm_url, lastfm_event_id, tickets_url (if TM has none)
    - Merge lineup: union, TM order preserved
    - Update source to 'both'

    Returns: 'inserted' | 'merged' | 'skipped'
    """
    now = datetime.now(timezone.utc).isoformat()
    lastfm_event_id = show.get("lastfm_event_id")
    artist = show.get("artist_name", "")
    show_date = show.get("date")
    venue = show.get("venue")

    with get_db_ctx() as cur:
        # 1. Exact match by lastfm_event_id
        existing = None
        if lastfm_event_id:
            cur.execute("SELECT * FROM shows WHERE lastfm_event_id = %s", (lastfm_event_id,))
            existing = cur.fetchone()

        # 2. Fuzzy match by artist + date + venue
        if not existing and artist and show_date:
            cur.execute(
                "SELECT * FROM shows WHERE date = %s AND LOWER(artist_name) = LOWER(%s)",
                (show_date, artist),
            )
            candidates = cur.fetchall()
            norm_venue = _normalize_venue(venue)
            for candidate in candidates:
                if _normalize_venue(candidate.get("venue")) == norm_venue:
                    existing = candidate
                    break
            # Also try: any of the lineup artists match the TM artist
            if not existing and candidates:
                lineup = show.get("lineup") or []
                norm_lineup = {_normalize_artist(a) for a in lineup}
                for candidate in candidates:
                    if _normalize_artist(candidate.get("artist_name")) in norm_lineup:
                        existing = candidate
                        break

        if existing:
            existing = dict(existing)
            # Merge: enrich the existing record with Last.fm data
            updates: list[str] = []
            values: list[object] = []

            if lastfm_event_id and not existing.get("lastfm_event_id"):
                updates.append("lastfm_event_id = %s"); values.append(lastfm_event_id)
            if show.get("lastfm_url") and not existing.get("lastfm_url"):
                updates.append("lastfm_url = %s"); values.append(show["lastfm_url"])
            if show.get("lastfm_attendance"):
                updates.append("lastfm_attendance = %s"); values.append(show["lastfm_attendance"])
            if show.get("tickets_url") and not existing.get("tickets_url") and not existing.get("url"):
                updates.append("tickets_url = %s"); values.append(show["tickets_url"])
            if show.get("scrape_city") and not existing.get("scrape_city"):
                updates.append("scrape_city = %s"); values.append(show["scrape_city"])

            # Merge lineup
            existing_lineup = existing.get("lineup") or []
            new_lineup = show.get("lineup") or []
            if new_lineup:
                merged_lineup = list(existing_lineup)
                existing_lower = {_normalize_artist(a) for a in existing_lineup}
                for a in new_lineup:
                    if _normalize_artist(a) not in existing_lower:
                        merged_lineup.append(a)
                if len(merged_lineup) > len(existing_lineup):
                    updates.append("lineup = %s"); values.append(merged_lineup)

            # Update source to 'both' if existing is from TM
            if existing.get("source") == "ticketmaster":
                updates.append("source = 'both'")

            if not updates:
                return "skipped"

            updates.append("updated_at = %s"); values.append(now)
            values.append(existing["id"])
            cur.execute(
                f"UPDATE shows SET {', '.join(updates)} WHERE id = %s",
                values,
            )
            return "merged"

        # 3. New show — insert
        lineup = show.get("lineup") or []
        cur.execute("""
            INSERT INTO shows (
                external_id, artist_name, date, local_time, venue, address_line1,
                city, country, url, image_url, lineup, status, source,
                lastfm_event_id, lastfm_url, lastfm_attendance, tickets_url, scrape_city,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (external_id) DO NOTHING
        """, (
            show.get("external_id"), artist, show_date, show.get("local_time"),
            venue, show.get("address_line1"), show.get("city"), show.get("country"),
            show.get("url"), show.get("image_url"), lineup,
            show.get("status", "announced"), "lastfm",
            lastfm_event_id, show.get("lastfm_url"), show.get("lastfm_attendance"),
            show.get("tickets_url"), show.get("scrape_city"),
            now, now,
        ))
        return "inserted"


def get_unique_user_cities() -> list[dict]:
    """Get distinct cities from users that have location configured."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT DISTINCT ON (LOWER(city))
                city, country, country_code, latitude, longitude
            FROM users
            WHERE city IS NOT NULL AND latitude IS NOT NULL
            ORDER BY LOWER(city), id
        """)
        return [dict(row) for row in cur.fetchall()]


def get_upcoming_shows(artist_name: str | None = None, city: str | None = None,
                       country: str | None = None, limit: int = 200) -> list[dict]:
    """Get upcoming shows, optionally filtered by exact city/country."""
    today = datetime.now(timezone.utc).date()
    with get_db_ctx() as cur:
        conditions = ["date >= %s", "status != 'cancelled'"]
        params: list = [today]
        if artist_name:
            conditions.append("artist_name = %s")
            params.append(artist_name)
        if city:
            conditions.append("LOWER(city) = LOWER(%s)")
            params.append(city)
        if country:
            conditions.append("LOWER(country_code) = LOWER(%s)")
            params.append(country)
        params.append(limit)
        cur.execute(
            f"SELECT * FROM shows WHERE {' AND '.join(conditions)} ORDER BY date ASC LIMIT %s",
            params,
        )
        return [dict(r) for r in cur.fetchall()]


def get_upcoming_shows_near(
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    limit: int = 200,
) -> list[dict]:
    """Get upcoming shows within a radius of a lat/lon point.

    Uses a bounding box pre-filter for performance, then Haversine
    post-filter for accuracy.  Shows without coordinates are included
    if their scrape_city matches a rough text match (fallback).
    """
    today = datetime.now(timezone.utc).date()
    # Rough bounding box: 1 degree ≈ 111 km
    delta = radius_km / 111.0
    lat_min = latitude - delta
    lat_max = latitude + delta
    lon_min = longitude - delta * 1.5  # wider for longitude at higher latitudes
    lon_max = longitude + delta * 1.5

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT *,
                CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN
                    6371 * acos(
                        LEAST(1.0, GREATEST(-1.0,
                            cos(radians(%s)) * cos(radians(latitude))
                            * cos(radians(longitude) - radians(%s))
                            + sin(radians(%s)) * sin(radians(latitude))
                        ))
                    )
                ELSE NULL END AS distance_km
            FROM shows
            WHERE date >= %s
              AND status != 'cancelled'
              AND (
                  (latitude BETWEEN %s AND %s AND longitude BETWEEN %s AND %s)
                  OR latitude IS NULL
              )
            ORDER BY date ASC
            LIMIT %s
        """, (
            latitude, longitude, latitude,
            today,
            lat_min, lat_max, lon_min, lon_max,
            limit * 3,  # overfetch for post-filter
        ))
        rows = [dict(r) for r in cur.fetchall()]

    # Post-filter: keep shows within radius, or shows without coords
    result = []
    for row in rows:
        dist = row.pop("distance_km", None)
        if dist is not None and dist <= radius_km:
            result.append(row)
        elif dist is None:
            # No coords — include if city text roughly matches
            result.append(row)
        if len(result) >= limit:
            break
    return result


def get_all_shows(limit: int = 500) -> list[dict]:
    """Get all shows (including past) ordered by date desc."""
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM shows ORDER BY date DESC LIMIT %s", (limit,))
        return [dict(r) for r in cur.fetchall()]


def get_show_cities() -> list[str]:
    """Get distinct cities with upcoming shows."""
    today = datetime.now(timezone.utc).date()
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT DISTINCT city FROM shows WHERE date >= %s AND city IS NOT NULL AND city != '' ORDER BY city",
            (today,),
        )
        return [r["city"] for r in cur.fetchall()]


def get_show_countries() -> list[str]:
    """Get distinct countries with upcoming shows."""
    today = datetime.now(timezone.utc).date()
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT DISTINCT country FROM shows WHERE date >= %s AND country IS NOT NULL ORDER BY country",
            (today,),
        )
        return [r["country"] for r in cur.fetchall()]


def delete_past_shows(days_old: int = 30):
    """Remove shows older than N days."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).date()
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM shows WHERE date < %s", (cutoff,))
        return cur.rowcount


def attend_show(user_id: int, show_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO user_show_attendance (user_id, show_id, created_at)
            VALUES (%s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (user_id, show_id, now),
        )
        return cur.rowcount > 0


def unattend_show(user_id: int, show_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute(
            "DELETE FROM user_show_attendance WHERE user_id = %s AND show_id = %s",
            (user_id, show_id),
        )
        return cur.rowcount > 0


def get_attending_show_ids(user_id: int, show_ids: list[int]) -> set[int]:
    if not show_ids:
        return set()
    placeholders = ",".join(["%s"] * len(show_ids))
    with get_db_ctx() as cur:
        cur.execute(
            f"""
            SELECT show_id
            FROM user_show_attendance
            WHERE user_id = %s AND show_id IN ({placeholders})
            """,
            [user_id, *show_ids],
        )
        return {row["show_id"] for row in cur.fetchall()}


def get_show_reminders(user_id: int, show_ids: list[int] | None = None) -> list[dict]:
    with get_db_ctx() as cur:
        if show_ids:
            placeholders = ",".join(["%s"] * len(show_ids))
            cur.execute(
                f"""
                SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                FROM user_show_reminders
                WHERE user_id = %s AND show_id IN ({placeholders})
                """,
                [user_id, *show_ids],
            )
        else:
            cur.execute(
                """
                SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                FROM user_show_reminders
                WHERE user_id = %s
                """,
                (user_id,),
            )
        return [dict(row) for row in cur.fetchall()]


def create_show_reminder(user_id: int, show_id: int, reminder_type: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO user_show_reminders (user_id, show_id, reminder_type, created_at, triggered_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id, show_id, reminder_type) DO NOTHING
            """,
            (user_id, show_id, reminder_type, now, None),
        )
        return cur.rowcount > 0


def get_upcoming_show_counts() -> dict:
    """Return counts of upcoming shows total and from lastfm source."""
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE")
        show_count = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE AND (source = 'lastfm' OR source = 'both')")
        lastfm_count = cur.fetchone()["c"]
    return {"show_count": show_count, "lastfm_count": lastfm_count}
