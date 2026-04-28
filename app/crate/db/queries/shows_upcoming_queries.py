from __future__ import annotations

from datetime import datetime, timezone

from crate.db.queries.shows_shared import dedupe_show_rows
from sqlalchemy import text

from crate.db.tx import read_scope


def get_upcoming_shows(
    artist_name: str | None = None,
    city: str | None = None,
    country: str | None = None,
    limit: int = 200,
) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    conditions = ["date >= :today", "status != 'cancelled'"]
    params: dict[str, object] = {"today": today, "lim": limit * 3}
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
    return dedupe_show_rows([dict(row) for row in rows])[:limit]


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
        if len(result) >= limit * 3:
            break
    return dedupe_show_rows(result)[:limit]


def get_all_shows(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT * FROM shows ORDER BY date DESC LIMIT :lim"),
            {"lim": limit},
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


__all__ = [
    "get_all_shows",
    "get_upcoming_show_counts",
    "get_upcoming_shows",
    "get_upcoming_shows_near",
]
