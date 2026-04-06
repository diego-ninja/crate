"""Shows — persistent storage for upcoming concerts/events."""

from datetime import datetime, timezone

from crate.db.core import get_db_ctx


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


def get_upcoming_shows(artist_name: str | None = None, city: str | None = None,
                       country: str | None = None, limit: int = 200) -> list[dict]:
    """Get upcoming shows, optionally filtered."""
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
