from __future__ import annotations

from datetime import datetime, timezone

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


__all__ = ["upsert_show"]
