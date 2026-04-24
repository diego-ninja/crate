from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def upsert_show(external_id: str, artist_name: str, date: str, **kwargs) -> int | None:
    now = datetime.now(timezone.utc).isoformat()
    normalized_external_id = (external_id or "").strip() or None
    venue = (kwargs.get("venue") or "").strip() or None
    with transaction_scope() as session:
        if normalized_external_id:
            row = session.execute(
                text(
                    """
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
                    """
                ),
                {
                    "external_id": normalized_external_id,
                    "artist_name": artist_name,
                    "date": date,
                    "local_time": kwargs.get("local_time"),
                    "venue": venue,
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
                    "created_at": now,
                    "updated_at": now,
                },
            ).mappings().first()
            return row["id"]

        existing = session.execute(
            text(
                """
                SELECT id
                FROM shows
                WHERE external_id IS NULL
                  AND artist_name = :artist_name
                  AND date = :date
                  AND COALESCE(venue, '') = COALESCE(:venue, '')
                LIMIT 1
                """
            ),
            {"artist_name": artist_name, "date": date, "venue": venue},
        ).mappings().first()
        if existing:
            session.execute(
                text(
                    """
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
                    """
                ),
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

        row = session.execute(
            text(
                """
                INSERT INTO shows (external_id, artist_name, date, local_time, venue, address_line1, city, region,
                    postal_code, country, country_code, latitude, longitude, url, image_url, lineup,
                    price_range, status, source, created_at, updated_at)
                VALUES (:external_id, :artist_name, :date, :local_time, :venue, :address_line1, :city, :region,
                    :postal_code, :country, :country_code, :latitude, :longitude, :url, :image_url, :lineup,
                    :price_range, :status, :source, :created_at, :updated_at)
                RETURNING id
                """
            ),
            {
                "external_id": None,
                "artist_name": artist_name,
                "date": date,
                "local_time": kwargs.get("local_time"),
                "venue": venue,
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
                "created_at": now,
                "updated_at": now,
            },
        ).mappings().first()
        return row["id"]


def _normalize_venue(name: str | None) -> str:
    if not name:
        return ""
    normalized = name.lower().strip()
    normalized = re.sub(r"^(the|la|el|le|les|los|das|die|den)\s+", "", normalized)
    normalized = re.sub(r"\s*(sala|hall|venue|theatre|theater|arena|club|room)\s*", " ", normalized)
    normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _normalize_artist(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.lower().strip())


def consolidate_show(show: dict) -> str:
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
            normalized_venue = _normalize_venue(venue)
            for candidate in candidates:
                if _normalize_venue(candidate.get("venue")) == normalized_venue:
                    existing = candidate
                    break
            if not existing and candidates:
                lineup = show.get("lineup") or []
                normalized_lineup = {_normalize_artist(a) for a in lineup}
                for candidate in candidates:
                    if _normalize_artist(candidate.get("artist_name")) in normalized_lineup:
                        existing = candidate
                        break

        if existing:
            existing = dict(existing)
            updates: list[str] = []
            params: dict[str, object] = {"id": existing["id"]}
            idx = 0

            if lastfm_event_id and not existing.get("lastfm_event_id"):
                updates.append(f"lastfm_event_id = :u{idx}")
                params[f"u{idx}"] = lastfm_event_id
                idx += 1
            if show.get("lastfm_url") and not existing.get("lastfm_url"):
                updates.append(f"lastfm_url = :u{idx}")
                params[f"u{idx}"] = show["lastfm_url"]
                idx += 1
            if show.get("lastfm_attendance"):
                updates.append(f"lastfm_attendance = :u{idx}")
                params[f"u{idx}"] = show["lastfm_attendance"]
                idx += 1
            if show.get("tickets_url") and not existing.get("tickets_url") and not existing.get("url"):
                updates.append(f"tickets_url = :u{idx}")
                params[f"u{idx}"] = show["tickets_url"]
                idx += 1
            if show.get("scrape_city") and not existing.get("scrape_city"):
                updates.append(f"scrape_city = :u{idx}")
                params[f"u{idx}"] = show["scrape_city"]
                idx += 1

            existing_lineup = existing.get("lineup") or []
            new_lineup = show.get("lineup") or []
            if new_lineup:
                merged_lineup = list(existing_lineup)
                existing_lower = {_normalize_artist(a) for a in existing_lineup}
                for artist_name in new_lineup:
                    if _normalize_artist(artist_name) not in existing_lower:
                        merged_lineup.append(artist_name)
                if len(merged_lineup) > len(existing_lineup):
                    updates.append(f"lineup = :u{idx}")
                    params[f"u{idx}"] = merged_lineup
                    idx += 1

            if existing.get("source") == "ticketmaster":
                updates.append("source = 'both'")

            if not updates:
                return "skipped"

            updates.append(f"updated_at = :u{idx}")
            params[f"u{idx}"] = now
            session.execute(text(f"UPDATE shows SET {', '.join(updates)} WHERE id = :id"), params)
            return "merged"

        lineup = show.get("lineup") or []
        session.execute(
            text(
                """
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
                """
            ),
            {
                "external_id": show.get("external_id"),
                "artist_name": artist,
                "date": show_date,
                "local_time": show.get("local_time"),
                "venue": venue,
                "address_line1": show.get("address_line1"),
                "city": show.get("city"),
                "country": show.get("country"),
                "url": show.get("url"),
                "image_url": show.get("image_url"),
                "lineup": lineup,
                "status": show.get("status", "announced"),
                "source": "lastfm",
                "lastfm_event_id": lastfm_event_id,
                "lastfm_url": show.get("lastfm_url"),
                "lastfm_attendance": show.get("lastfm_attendance"),
                "tickets_url": show.get("tickets_url"),
                "scrape_city": show.get("scrape_city"),
                "created_at": now,
                "updated_at": now,
            },
        )
        return "inserted"


def delete_past_shows(days_old: int = 30) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).date()
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM shows WHERE date < :cutoff"),
            {"cutoff": cutoff},
        )
    return int(result.rowcount or 0)


def attend_show(user_id: int, show_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_show_attendance (user_id, show_id, created_at)
                VALUES (:user_id, :show_id, :now)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "show_id": show_id, "now": now},
        )
    return bool(result.rowcount)


def unattend_show(user_id: int, show_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_show_attendance WHERE user_id = :user_id AND show_id = :show_id"),
            {"user_id": user_id, "show_id": show_id},
        )
    return bool(result.rowcount)


def create_show_reminder(user_id: int, show_id: int, reminder_type: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_show_reminders (user_id, show_id, reminder_type, created_at, triggered_at)
                VALUES (:user_id, :show_id, :reminder_type, :now, NULL)
                ON CONFLICT (user_id, show_id, reminder_type) DO NOTHING
                """
            ),
            {"user_id": user_id, "show_id": show_id, "reminder_type": reminder_type, "now": now},
        )
    return bool(result.rowcount)
