from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope


def get_unique_user_cities() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT ON (LOWER(city))
                    city, country, country_code, latitude, longitude
                FROM users
                WHERE city IS NOT NULL AND latitude IS NOT NULL
                ORDER BY LOWER(city), id
                """
            )
        ).mappings().all()
    return [dict(row) for row in rows]


def get_upcoming_shows(
    artist_name: str | None = None,
    city: str | None = None,
    country: str | None = None,
    limit: int = 200,
) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    conditions = ["date >= :today", "status != 'cancelled'"]
    params: dict[str, object] = {"today": today, "lim": limit}
    if artist_name:
        conditions.append("artist_name = :artist_name")
        params["artist_name"] = artist_name
    if city:
        conditions.append("LOWER(city) = LOWER(:city)")
        params["city"] = city
    if country:
        conditions.append("LOWER(country_code) = LOWER(:country)")
        params["country"] = country
    with read_scope() as session:
        rows = session.execute(
            text(f"SELECT * FROM shows WHERE {' AND '.join(conditions)} ORDER BY date ASC LIMIT :lim"),
            params,
        ).mappings().all()
    return [dict(row) for row in rows]


def get_upcoming_shows_near(
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    limit: int = 200,
) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    delta = radius_km / 111.0
    lat_min = latitude - delta
    lat_max = latitude + delta
    lon_min = longitude - delta * 1.5
    lon_max = longitude + delta * 1.5

    with read_scope() as session:
        rows = session.execute(
            text(
                """
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
                """
            ),
            {
                "lat": latitude,
                "lon": longitude,
                "today": today,
                "lat_min": lat_min,
                "lat_max": lat_max,
                "lon_min": lon_min,
                "lon_max": lon_max,
                "lim": limit * 3,
            },
        ).mappings().all()

    result: list[dict] = []
    for row in rows:
        item = dict(row)
        dist = item.pop("distance_km", None)
        if dist is not None and dist <= radius_km:
            result.append(item)
        elif dist is None:
            result.append(item)
        if len(result) >= limit:
            break
    return result


def get_all_shows(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT * FROM shows ORDER BY date DESC LIMIT :lim"),
            {"lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_show_cities() -> list[str]:
    today = datetime.now(timezone.utc).date()
    with read_scope() as session:
        rows = session.execute(
            text("SELECT DISTINCT city FROM shows WHERE date >= :today AND city IS NOT NULL AND city != '' ORDER BY city"),
            {"today": today},
        ).mappings().all()
    return [row["city"] for row in rows]


def get_show_countries() -> list[str]:
    today = datetime.now(timezone.utc).date()
    with read_scope() as session:
        rows = session.execute(
            text("SELECT DISTINCT country FROM shows WHERE date >= :today AND country IS NOT NULL ORDER BY country"),
            {"today": today},
        ).mappings().all()
    return [row["country"] for row in rows]


def get_attending_show_ids(user_id: int, show_ids: list[int]) -> set[int]:
    if not show_ids:
        return set()
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT show_id
                FROM user_show_attendance
                WHERE user_id = :user_id AND show_id = ANY(:show_ids)
                """
            ),
            {"user_id": user_id, "show_ids": show_ids},
        ).mappings().all()
    return {row["show_id"] for row in rows}


def get_show_reminders(user_id: int, show_ids: list[int] | None = None) -> list[dict]:
    with read_scope() as session:
        if show_ids:
            rows = session.execute(
                text(
                    """
                    SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                    FROM user_show_reminders
                    WHERE user_id = :user_id AND show_id = ANY(:show_ids)
                    """
                ),
                {"user_id": user_id, "show_ids": show_ids},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                    FROM user_show_reminders
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            ).mappings().all()
    return [dict(row) for row in rows]


def get_upcoming_show_counts() -> dict:
    with read_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE")
        ).mappings().first()
        show_count = row["c"]
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS c FROM shows WHERE date >= CURRENT_DATE AND (source = 'lastfm' OR source = 'both')")
        ).mappings().first()
        lastfm_count = row["c"]
    return {"show_count": show_count, "lastfm_count": lastfm_count}
