"""Shows — persistent storage for upcoming concerts/events."""

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope

log = logging.getLogger(__name__)


def upsert_show(external_id: str, artist_name: str, date: str, **kwargs) -> int | None:
    """Insert or update a show. Deduplicates by (artist, date, venue)."""
    now = datetime.now(timezone.utc).isoformat()
    normalized_external_id = (external_id or "").strip() or None
    venue = (kwargs.get("venue") or "").strip() or None
    with transaction_scope() as session:
        if normalized_external_id:
            row = session.execute(text("""
                INSERT INTO shows (external_id, artist_name, date, local_time, venue, address_line1, city, region,
                    postal_code, country, country_code, latitude, longitude, url, image_url, lineup,
                    price_range, status, source, created_at, updated_at)
                VALUES (:external_id, :artist_name, :date, :local_time, :venue, :address_line1, :city, :region,
                    :postal_code, :country, :country_code, :latitude, :longitude, :url, :image_url, :lineup,
                    :price_range, :status, :source, :created_at, :updated_at)
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
            """), {
                "external_id": normalized_external_id, "artist_name": artist_name, "date": date,
                "local_time": kwargs.get("local_time"), "venue": venue,
                "address_line1": kwargs.get("address_line1"), "city": kwargs.get("city"),
                "region": kwargs.get("region"), "postal_code": kwargs.get("postal_code"),
                "country": kwargs.get("country"), "country_code": kwargs.get("country_code"),
                "latitude": kwargs.get("latitude"), "longitude": kwargs.get("longitude"),
                "url": kwargs.get("url"), "image_url": kwargs.get("image_url"),
                "lineup": kwargs.get("lineup"), "price_range": kwargs.get("price_range"),
                "status": kwargs.get("status", "onsale"), "source": kwargs.get("source", "ticketmaster"),
                "created_at": now, "updated_at": now,
            }).mappings().first()
            return row["id"]

        existing = session.execute(
            text("""
            SELECT id
            FROM shows
            WHERE external_id IS NULL
              AND artist_name = :artist_name
              AND date = :date
              AND COALESCE(venue, '') = COALESCE(:venue, '')
            LIMIT 1
            """),
            {"artist_name": artist_name, "date": date, "venue": venue},
        ).mappings().first()
        if existing:
            session.execute(
                text("""
                UPDATE shows
                SET local_time = :local_time,
                    address_line1 = :address_line1,
                    city = :city,
                    region = :region,
                    postal_code = :postal_code,
                    country = :country,
                    country_code = :country_code,
                    latitude = :latitude,
                    longitude = :longitude,
                    url = :url,
                    image_url = :image_url,
                    lineup = :lineup,
                    price_range = :price_range,
                    status = :status,
                    source = :source,
                    updated_at = :updated_at
                WHERE id = :id
                """),
                {
                    "local_time": kwargs.get("local_time"),
                    "address_line1": kwargs.get("address_line1"),
                    "city": kwargs.get("city"),
                    "region": kwargs.get("region"),
                    "postal_code": kwargs.get("postal_code"),
                    "country": kwargs.get("country"),
                    "country_code": kwargs.get("country_code"),
                    "latitude": kwargs.get("latitude"),
                    "longitude": kwargs.get("longitude"),
                    "url": kwargs.get("url"),
                    "image_url": kwargs.get("image_url"),
                    "lineup": kwargs.get("lineup"),
                    "price_range": kwargs.get("price_range"),
                    "status": kwargs.get("status", "onsale"),
                    "source": kwargs.get("source", "ticketmaster"),
                    "updated_at": now,
                    "id": existing["id"],
                },
            )
            return existing["id"]

        row = session.execute(text("""
            INSERT INTO shows (external_id, artist_name, date, local_time, venue, address_line1, city, region,
                postal_code, country, country_code, latitude, longitude, url, image_url, lineup,
                price_range, status, source, created_at, updated_at)
            VALUES (:external_id, :artist_name, :date, :local_time, :venue, :address_line1, :city, :region,
                :postal_code, :country, :country_code, :latitude, :longitude, :url, :image_url, :lineup,
                :price_range, :status, :source, :created_at, :updated_at)
            RETURNING id
        """), {
            "external_id": None, "artist_name": artist_name, "date": date,
            "local_time": kwargs.get("local_time"), "venue": venue,
            "address_line1": kwargs.get("address_line1"), "city": kwargs.get("city"),
            "region": kwargs.get("region"), "postal_code": kwargs.get("postal_code"),
            "country": kwargs.get("country"), "country_code": kwargs.get("country_code"),
            "latitude": kwargs.get("latitude"), "longitude": kwargs.get("longitude"),
            "url": kwargs.get("url"), "image_url": kwargs.get("image_url"),
            "lineup": kwargs.get("lineup"), "price_range": kwargs.get("price_range"),
            "status": kwargs.get("status", "onsale"), "source": kwargs.get("source", "ticketmaster"),
            "created_at": now, "updated_at": now,
        }).mappings().first()
        return row["id"]


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
    3. No match -> insert as new show

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

    with transaction_scope() as session:
        existing = None
        if lastfm_event_id:
            existing = session.execute(
                text("SELECT * FROM shows WHERE lastfm_event_id = :eid"),
                {"eid": lastfm_event_id},
            ).mappings().first()

        if not existing and artist and show_date:
            candidates = session.execute(
                text("SELECT * FROM shows WHERE date = :date AND LOWER(artist_name) = LOWER(:artist)"),
                {"date": show_date, "artist": artist},
            ).mappings().all()
            norm_venue = _normalize_venue(venue)
            for candidate in candidates:
                if _normalize_venue(candidate.get("venue")) == norm_venue:
                    existing = candidate
                    break
            if not existing and candidates:
                lineup = show.get("lineup") or []
                norm_lineup = {_normalize_artist(a) for a in lineup}
                for candidate in candidates:
                    if _normalize_artist(candidate.get("artist_name")) in norm_lineup:
                        existing = candidate
                        break

        if existing:
            existing = dict(existing)
            updates: list[str] = []
            params: dict = {"id": existing["id"]}
            idx = 0

            if lastfm_event_id and not existing.get("lastfm_event_id"):
                updates.append(f"lastfm_event_id = :u{idx}"); params[f"u{idx}"] = lastfm_event_id; idx += 1
            if show.get("lastfm_url") and not existing.get("lastfm_url"):
                updates.append(f"lastfm_url = :u{idx}"); params[f"u{idx}"] = show["lastfm_url"]; idx += 1
            if show.get("lastfm_attendance"):
                updates.append(f"lastfm_attendance = :u{idx}"); params[f"u{idx}"] = show["lastfm_attendance"]; idx += 1
            if show.get("tickets_url") and not existing.get("tickets_url") and not existing.get("url"):
                updates.append(f"tickets_url = :u{idx}"); params[f"u{idx}"] = show["tickets_url"]; idx += 1
            if show.get("scrape_city") and not existing.get("scrape_city"):
                updates.append(f"scrape_city = :u{idx}"); params[f"u{idx}"] = show["scrape_city"]; idx += 1

            existing_lineup = existing.get("lineup") or []
            new_lineup = show.get("lineup") or []
            if new_lineup:
                merged_lineup = list(existing_lineup)
                existing_lower = {_normalize_artist(a) for a in existing_lineup}
                for a in new_lineup:
                    if _normalize_artist(a) not in existing_lower:
                        merged_lineup.append(a)
                if len(merged_lineup) > len(existing_lineup):
                    updates.append(f"lineup = :u{idx}"); params[f"u{idx}"] = merged_lineup; idx += 1

            if existing.get("source") == "ticketmaster":
                updates.append("source = 'both'")

            if not updates:
                return "skipped"

            updates.append(f"updated_at = :u{idx}"); params[f"u{idx}"] = now; idx += 1
            session.execute(
                text(f"UPDATE shows SET {', '.join(updates)} WHERE id = :id"),
                params,
            )
            return "merged"

        lineup = show.get("lineup") or []
        session.execute(text("""
            INSERT INTO shows (
                external_id, artist_name, date, local_time, venue, address_line1,
                city, country, url, image_url, lineup, status, source,
                lastfm_event_id, lastfm_url, lastfm_attendance, tickets_url, scrape_city,
                created_at, updated_at
            ) VALUES (
                :external_id, :artist_name, :date, :local_time, :venue, :address_line1,
                :city, :country, :url, :image_url, :lineup, :status, :source,
                :lastfm_event_id, :lastfm_url, :lastfm_attendance, :tickets_url, :scrape_city,
                :created_at, :updated_at
            )
            ON CONFLICT (external_id) DO NOTHING
        """), {
            "external_id": show.get("external_id"), "artist_name": artist, "date": show_date,
            "local_time": show.get("local_time"), "venue": venue,
            "address_line1": show.get("address_line1"), "city": show.get("city"),
            "country": show.get("country"), "url": show.get("url"),
            "image_url": show.get("image_url"), "lineup": lineup,
            "status": show.get("status", "announced"), "source": "lastfm",
            "lastfm_event_id": lastfm_event_id, "lastfm_url": show.get("lastfm_url"),
            "lastfm_attendance": show.get("lastfm_attendance"),
            "tickets_url": show.get("tickets_url"), "scrape_city": show.get("scrape_city"),
            "created_at": now, "updated_at": now,
        })
        return "inserted"


def get_unique_user_cities() -> list[dict]:
    """Get distinct cities from users that have location configured."""
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT DISTINCT ON (LOWER(city))
                city, country, country_code, latitude, longitude
            FROM users
            WHERE city IS NOT NULL AND latitude IS NOT NULL
            ORDER BY LOWER(city), id
        """)).mappings().all()
        return [dict(row) for row in rows]


def get_upcoming_shows(artist_name: str | None = None, city: str | None = None,
                       country: str | None = None, limit: int = 200) -> list[dict]:
    """Get upcoming shows, optionally filtered by exact city/country."""
    today = datetime.now(timezone.utc).date()
    conditions = ["date >= :today", "status != 'cancelled'"]
    params: dict = {"today": today}
    if artist_name:
        conditions.append("artist_name = :artist_name")
        params["artist_name"] = artist_name
    if city:
        conditions.append("LOWER(city) = LOWER(:city)")
        params["city"] = city
    if country:
        conditions.append("LOWER(country_code) = LOWER(:country)")
        params["country"] = country
    params["lim"] = limit
    with transaction_scope() as session:
        rows = session.execute(
            text(f"SELECT * FROM shows WHERE {' AND '.join(conditions)} ORDER BY date ASC LIMIT :lim"),
            params,
        ).mappings().all()
        return [dict(r) for r in rows]


def get_upcoming_shows_near(
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    limit: int = 200,
) -> list[dict]:
    """Get upcoming shows within a radius of a lat/lon point."""
    today = datetime.now(timezone.utc).date()
    delta = radius_km / 111.0
    lat_min = latitude - delta
    lat_max = latitude + delta
    lon_min = longitude - delta * 1.5
    lon_max = longitude + delta * 1.5

    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT *,
                CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN
                    6371 * acos(
                        LEAST(1.0, GREATEST(-1.0,
                            cos(radians(:lat)) * cos(radians(latitude))
                            * cos(radians(longitude) - radians(:lon))
                            + sin(radians(:lat)) * sin(radians(latitude))
                        ))
                    )
                ELSE NULL END AS distance_km
            FROM shows
            WHERE date >= :today
              AND status != 'cancelled'
              AND (
                  (latitude BETWEEN :lat_min AND :lat_max AND longitude BETWEEN :lon_min AND :lon_max)
                  OR latitude IS NULL
              )
            ORDER BY date ASC
            LIMIT :lim
        """), {
            "lat": latitude, "lon": longitude,
            "today": today,
            "lat_min": lat_min, "lat_max": lat_max,
            "lon_min": lon_min, "lon_max": lon_max,
            "lim": limit * 3,
        }).mappings().all()

    result = []
    for row in rows:
        d = dict(row)
        dist = d.pop("distance_km", None)
        if dist is not None and dist <= radius_km:
            result.append(d)
        elif dist is None:
            result.append(d)
        if len(result) >= limit:
            break
    return result


def get_all_shows(limit: int = 500) -> list[dict]:
    """Get all shows (including past) ordered by date desc."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM shows ORDER BY date DESC LIMIT :lim"),
            {"lim": limit},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_show_cities() -> list[str]:
    """Get distinct cities with upcoming shows."""
    today = datetime.now(timezone.utc).date()
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT DISTINCT city FROM shows WHERE date >= :today AND city IS NOT NULL AND city != '' ORDER BY city"),
            {"today": today},
        ).mappings().all()
        return [r["city"] for r in rows]


def get_show_countries() -> list[str]:
    """Get distinct countries with upcoming shows."""
    today = datetime.now(timezone.utc).date()
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT DISTINCT country FROM shows WHERE date >= :today AND country IS NOT NULL ORDER BY country"),
            {"today": today},
        ).mappings().all()
        return [r["country"] for r in rows]


def delete_past_shows(days_old: int = 30):
    """Remove shows older than N days."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).date()
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM shows WHERE date < :cutoff"),
            {"cutoff": cutoff},
        )
        return result.rowcount


def attend_show(user_id: int, show_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text("""
            INSERT INTO user_show_attendance (user_id, show_id, created_at)
            VALUES (:user_id, :show_id, :now)
            ON CONFLICT DO NOTHING
            """),
            {"user_id": user_id, "show_id": show_id, "now": now},
        )
        return result.rowcount > 0


def unattend_show(user_id: int, show_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_show_attendance WHERE user_id = :user_id AND show_id = :show_id"),
            {"user_id": user_id, "show_id": show_id},
        )
        return result.rowcount > 0


def get_attending_show_ids(user_id: int, show_ids: list[int]) -> set[int]:
    if not show_ids:
        return set()
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT show_id
            FROM user_show_attendance
            WHERE user_id = :user_id AND show_id = ANY(:show_ids)
            """),
            {"user_id": user_id, "show_ids": show_ids},
        ).mappings().all()
        return {row["show_id"] for row in rows}


def get_show_reminders(user_id: int, show_ids: list[int] | None = None) -> list[dict]:
    with transaction_scope() as session:
        if show_ids:
            rows = session.execute(
                text("""
                SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                FROM user_show_reminders
                WHERE user_id = :user_id AND show_id = ANY(:show_ids)
                """),
                {"user_id": user_id, "show_ids": show_ids},
            ).mappings().all()
        else:
            rows = session.execute(
                text("""
                SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                FROM user_show_reminders
                WHERE user_id = :user_id
                """),
                {"user_id": user_id},
            ).mappings().all()
        return [dict(row) for row in rows]


def create_show_reminder(user_id: int, show_id: int, reminder_type: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text("""
            INSERT INTO user_show_reminders (user_id, show_id, reminder_type, created_at, triggered_at)
            VALUES (:user_id, :show_id, :reminder_type, :now, NULL)
            ON CONFLICT (user_id, show_id, reminder_type) DO NOTHING
            """),
            {"user_id": user_id, "show_id": show_id, "reminder_type": reminder_type, "now": now},
        )
        return result.rowcount > 0


def get_upcoming_show_counts() -> dict:
    """Return counts of upcoming shows total and from lastfm source."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE")
        ).mappings().first()
        show_count = row["c"]
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE AND (source = 'lastfm' OR source = 'both')")
        ).mappings().first()
        lastfm_count = row["c"]
    return {"show_count": show_count, "lastfm_count": lastfm_count}
