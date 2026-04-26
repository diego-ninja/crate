from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.repositories.shows_shared import normalize_artist, normalize_venue
from crate.db.tx import transaction_scope


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
            normalized_venue = normalize_venue(venue)
            for candidate in candidates:
                if normalize_venue(candidate.get("venue")) == normalized_venue:
                    existing = candidate
                    break
            if not existing and candidates:
                lineup = show.get("lineup") or []
                normalized_lineup = {normalize_artist(name) for name in lineup}
                for candidate in candidates:
                    if normalize_artist(candidate.get("artist_name")) in normalized_lineup:
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
                existing_lower = {normalize_artist(name) for name in existing_lineup}
                for artist_name in new_lineup:
                    if normalize_artist(artist_name) not in existing_lower:
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


__all__ = ["consolidate_show"]
