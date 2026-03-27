"""Shows — persistent storage for upcoming concerts/events."""

from datetime import datetime, timezone
from crate.db.core import get_db_ctx


def upsert_show(external_id: str, artist_name: str, date: str, **kwargs) -> int | None:
    """Insert or update a show. Deduplicates by (artist, date, venue)."""
    now = datetime.now(timezone.utc).isoformat()
    venue = kwargs.get("venue") or ""
    with get_db_ctx() as cur:
        # Skip if same artist+date+venue already exists (Ticketmaster returns dupes)
        cur.execute(
            "SELECT id FROM shows WHERE artist_name = %s AND date = %s AND venue = %s LIMIT 1",
            (artist_name, date, venue),
        )
        existing = cur.fetchone()
        if existing:
            return existing["id"]
        cur.execute("""
            INSERT INTO shows (external_id, artist_name, date, local_time, venue, city, region,
                country, country_code, latitude, longitude, url, image_url, lineup,
                price_range, status, source, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (external_id) DO UPDATE SET
                date = EXCLUDED.date, local_time = EXCLUDED.local_time,
                venue = EXCLUDED.venue, city = EXCLUDED.city,
                status = EXCLUDED.status, price_range = EXCLUDED.price_range,
                updated_at = EXCLUDED.updated_at
            RETURNING id
        """, (
            external_id, artist_name, date,
            kwargs.get("local_time"), kwargs.get("venue"), kwargs.get("city"),
            kwargs.get("region"), kwargs.get("country"), kwargs.get("country_code"),
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT DISTINCT city FROM shows WHERE date >= %s AND city IS NOT NULL AND city != '' ORDER BY city",
            (today,),
        )
        return [r["city"] for r in cur.fetchall()]


def get_show_countries() -> list[str]:
    """Get distinct countries with upcoming shows."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT DISTINCT country FROM shows WHERE date >= %s AND country IS NOT NULL ORDER BY country",
            (today,),
        )
        return [r["country"] for r in cur.fetchall()]


def delete_past_shows(days_old: int = 30):
    """Remove shows older than N days."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).strftime("%Y-%m-%d")
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM shows WHERE date < %s", (cutoff,))
        return cur.rowcount
