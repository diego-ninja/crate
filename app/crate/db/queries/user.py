from datetime import date, datetime

from crate.db.core import get_db_ctx


def get_feed_new_albums(followed_names: list[str], cutoff: str, limit: int) -> list[dict]:
    if not followed_names:
        return []
    placeholders = ",".join(["%s"] * len(followed_names))
    with get_db_ctx() as cur:
        cur.execute(f"""
            SELECT 'new_album' AS type, la.artist, la.name AS title, la.year, la.has_cover,
                   la.updated_at AS date
            FROM library_albums la
            WHERE la.artist IN ({placeholders})
            AND la.updated_at >= %s
            ORDER BY la.updated_at DESC
            LIMIT %s
        """, list(followed_names) + [cutoff, limit])
        return [dict(r) for r in cur.fetchall()]


def get_feed_shows(followed_names: list[str], today: date, limit: int) -> list[dict]:
    if not followed_names:
        return []
    placeholders = ",".join(["%s"] * len(followed_names))
    with get_db_ctx() as cur:
        cur.execute(f"""
            SELECT 'show' AS type, s.artist_name AS artist, s.venue AS title,
                   s.city, s.country, s.date, s.url, s.image_url
            FROM shows s
            WHERE s.artist_name IN ({placeholders})
            AND s.date >= %s
            ORDER BY s.date
            LIMIT %s
        """, list(followed_names) + [today, limit])
        return [dict(r) for r in cur.fetchall()]


def get_feed_new_releases(limit: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT 'release' AS type, nr.artist_name AS artist, nr.album_title AS title,
                   nr.cover_url, nr.year, nr.status, nr.detected_at AS date
            FROM new_releases nr
            WHERE nr.status != 'dismissed'
            ORDER BY nr.detected_at DESC
            LIMIT %s
        """, (limit,))
        return [dict(r) for r in cur.fetchall()]


def get_upcoming_releases(
    followed_names: list[str], today: date, recent_cutoff: str, limit: int,
) -> list[dict]:
    placeholders = ",".join(["%s"] * len(followed_names))
    with get_db_ctx() as cur:
        cur.execute(
            f"""
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
            WHERE nr.artist_name IN ({placeholders})
              AND nr.status != 'dismissed'
              AND (
                (nr.release_date IS NOT NULL AND nr.release_date >= %s)
                OR nr.detected_at >= %s
              )
            ORDER BY COALESCE(nr.release_date, (nr.detected_at AT TIME ZONE 'UTC')::date) ASC
            LIMIT %s
            """,
            followed_names + [today, recent_cutoff, limit],
        )
        return [dict(r) for r in cur.fetchall()]


def get_upcoming_shows(
    followed_names: list[str],
    today: date,
    user_lat: float | None,
    user_lon: float | None,
    user_radius: int,
    limit: int,
) -> list[dict]:
    placeholders = ",".join(["%s"] * len(followed_names))
    with get_db_ctx() as cur:
        cur.execute(
            f"""
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
            WHERE s.artist_name IN ({placeholders})
              AND s.date >= %s
              AND s.status != 'cancelled'
              {"AND (s.latitude BETWEEN %s AND %s AND s.longitude BETWEEN %s AND %s OR s.latitude IS NULL)" if user_lat else ""}
            ORDER BY s.date ASC
            LIMIT %s
            """,
            followed_names + [today] + (
                [user_lat - user_radius / 111.0, user_lat + user_radius / 111.0,
                 user_lon - user_radius / 70.0, user_lon + user_radius / 70.0]
                if user_lat else []
            ) + [limit],
        )
        return [dict(r) for r in cur.fetchall()]


def get_artist_genres_for_names(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    placeholders = ",".join(["%s"] * len(artist_names))
    with get_db_ctx() as cur:
        cur.execute(
            f"""
            SELECT ag.artist_name, g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name IN ({placeholders})
            ORDER BY ag.weight DESC
            """,
            artist_names,
        )
        genre_map: dict[str, list[str]] = {}
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
        return genre_map


def get_scrobble_identities(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT provider, status, metadata_json
            FROM user_external_identities
            WHERE user_id = %s AND provider IN ('lastfm', 'listenbrainz')
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]


def update_user_location(user_id: int, fields: list[str], values: list) -> None:
    if not fields:
        return
    values.append(user_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = %s", values)
