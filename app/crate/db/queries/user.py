from datetime import date, datetime

from crate.db.serialize import serialize_rows
from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_feed_new_albums(followed_names: list[str], cutoff: str, limit: int) -> list[dict]:
    if not followed_names:
        return []
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT 'new_album' AS type, la.artist, la.name AS title, la.year, la.has_cover,
                   la.updated_at AS date
            FROM library_albums la
            WHERE la.artist = ANY(:followed_names)
            AND la.updated_at >= :cutoff
            ORDER BY la.updated_at DESC
            LIMIT :limit
        """), {"followed_names": list(followed_names), "cutoff": cutoff, "limit": limit}).mappings().all()
        return serialize_rows(rows)


def get_feed_shows(followed_names: list[str], today: date, limit: int) -> list[dict]:
    if not followed_names:
        return []
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT 'show' AS type, s.artist_name AS artist, s.venue AS title,
                   s.city, s.country, s.date, s.url, s.image_url
            FROM shows s
            WHERE s.artist_name = ANY(:followed_names)
            AND s.date >= :today
            ORDER BY s.date
            LIMIT :limit
        """), {"followed_names": list(followed_names), "today": today, "limit": limit}).mappings().all()
        return serialize_rows(rows)


def get_feed_new_releases(limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT 'release' AS type, nr.artist_name AS artist, nr.album_title AS title,
                   nr.cover_url, nr.year, nr.status, nr.detected_at AS date
            FROM new_releases nr
            WHERE nr.status != 'dismissed'
            ORDER BY nr.detected_at DESC
            LIMIT :limit
        """), {"limit": limit}).mappings().all()
        return serialize_rows(rows)


def get_upcoming_releases(
    followed_names: list[str], today: date, recent_cutoff: str, limit: int,
) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                nr.id,
                nr.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                nr.album_title,
                nr.cover_url,
                nr.status,
                nr.tidal_url,
                nr.release_type,
                nr.release_date,
                nr.detected_at
            FROM new_releases nr
            LEFT JOIN library_artists la ON la.name = nr.artist_name
            WHERE nr.artist_name = ANY(:followed_names)
              AND nr.status != 'dismissed'
              AND (
                (nr.release_date IS NOT NULL AND nr.release_date >= :today)
                OR nr.detected_at >= :recent_cutoff
              )
            ORDER BY COALESCE(nr.release_date, (nr.detected_at AT TIME ZONE 'UTC')::date) ASC
            LIMIT :limit
            """),
            {"followed_names": followed_names, "today": today, "recent_cutoff": recent_cutoff, "limit": limit},
        ).mappings().all()
        return serialize_rows(rows)


def get_upcoming_shows(
    followed_names: list[str],
    today: date,
    user_lat: float | None,
    user_lon: float | None,
    user_radius: int,
    limit: int,
) -> list[dict]:
    params: dict = {"followed_names": followed_names, "today": today, "limit": limit}
    geo_clause = ""
    if user_lat:
        geo_clause = "AND (s.latitude BETWEEN :lat_min AND :lat_max AND s.longitude BETWEEN :lon_min AND :lon_max OR s.latitude IS NULL)"
        params["lat_min"] = user_lat - user_radius / 111.0
        params["lat_max"] = user_lat + user_radius / 111.0
        params["lon_min"] = user_lon - user_radius / 70.0
        params["lon_max"] = user_lon + user_radius / 70.0
    with transaction_scope() as session:
        rows = session.execute(
            text(f"""
            SELECT
                   s.id,
                   s.artist_name,
                   la.id AS artist_id,
                   la.slug AS artist_slug,
                   s.venue,
                   s.address_line1,
                   s.city,
                   s.region,
                   s.postal_code,
                   s.country,
                   s.country_code,
                   s.date,
                   s.local_time,
                   s.url, s.image_url, s.lineup, s.latitude, s.longitude,
                   s.source, s.lastfm_attendance, s.lastfm_url, s.tickets_url
            FROM shows s
            LEFT JOIN library_artists la ON la.name = s.artist_name
            WHERE s.artist_name = ANY(:followed_names)
              AND s.date >= :today
              AND s.status != 'cancelled'
              {geo_clause}
            ORDER BY s.date ASC
            LIMIT :limit
            """),
            params,
        ).mappings().all()
        return serialize_rows(rows)


def get_artist_genres_for_names(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT ag.artist_name, g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name = ANY(:artist_names)
            ORDER BY ag.weight DESC
            """),
            {"artist_names": artist_names},
        ).mappings().all()
        genre_map: dict[str, list[str]] = {}
        for row in rows:
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
        return genre_map


def get_scrobble_identities(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT provider, status, metadata_json
            FROM user_external_identities
            WHERE user_id = :user_id AND provider IN ('lastfm', 'listenbrainz')
        """), {"user_id": user_id}).mappings().all()
        return serialize_rows(rows)


def get_user_scrobble_identities(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT provider, external_username, metadata_json
            FROM user_external_identities
            WHERE user_id = :user_id AND provider IN ('lastfm', 'listenbrainz')
              AND status = 'linked'
        """), {"user_id": user_id}).mappings().all()
        return serialize_rows(rows)


def update_user_location(user_id: int, fields: list[str], values: list) -> None:
    if not fields:
        return
    set_clauses = []
    named_params: dict = {"user_id": user_id}
    for i, (field, value) in enumerate(zip(fields, values)):
        param_name = f"v{i}"
        col_name = field.split("=")[0].strip()
        set_clauses.append(f"{col_name} = :{param_name}")
        named_params[param_name] = value
    with transaction_scope() as session:
        session.execute(text(f"UPDATE users SET {', '.join(set_clauses)} WHERE id = :user_id"), named_params)
