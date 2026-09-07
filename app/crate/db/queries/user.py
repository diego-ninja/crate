import re
from datetime import date
from math import cos, radians

from crate.db.queries.shows_shared import dedupe_show_rows
from crate.db.serialize import serialize_rows
from crate.db.tx import read_scope
from crate.show_filters import show_has_tribute_signal
from sqlalchemy import text

_RELEASE_TITLE_SUFFIX_RE = re.compile(r"\s+(?:ep|single)\s*$", re.IGNORECASE)
_RELEASE_TITLE_TOKEN_RE = re.compile(r"[^a-z0-9]+")


def _release_title_without_redundant_type(title: str, release_type: str = "") -> str:
    cleaned = (title or "").strip()
    normalized_type = (release_type or "").strip().lower()
    if normalized_type in {"ep", "single"}:
        suffix = f" {normalized_type}"
        if cleaned.lower().endswith(suffix) and len(cleaned) > len(suffix):
            return cleaned[: -len(suffix)].strip()
    return cleaned


def _release_dedupe_title(title: str, release_type: str = "") -> str:
    base = _release_title_without_redundant_type(title, release_type).lower()
    base = _RELEASE_TITLE_SUFFIX_RE.sub("", base).strip()
    return _RELEASE_TITLE_TOKEN_RE.sub(" ", base).strip()


def _release_dedupe_key(row: dict) -> tuple[str, str, str]:
    return (
        str(row.get("artist_name") or "").strip().lower(),
        str(row.get("release_date") or "").strip(),
        _release_dedupe_title(
            str(row.get("album_title") or ""),
            str(row.get("release_type") or ""),
        ),
    )


def _release_row_score(row: dict) -> tuple[int, int]:
    score = 0
    if row.get("album_id"):
        score += 64
    if row.get("tidal_url") or row.get("source_url"):
        score += 32
    if row.get("cover_url"):
        score += 16
    if row.get("release_type"):
        score += 4
    if row.get("status") == "downloaded":
        score += 2
    title = str(row.get("album_title") or "")
    display_title = _release_title_without_redundant_type(
        title,
        str(row.get("release_type") or ""),
    )
    if title == display_title:
        score += 1
    return score, int(row.get("id") or 0)


def _merge_release_rows(primary: dict, fallback: dict) -> dict:
    merged = dict(primary)
    for key in (
        "artist_id",
        "artist_slug",
        "album_id",
        "album_slug",
        "cover_url",
        "tidal_url",
        "source_url",
        "release_type",
        "release_date",
        "detected_at",
    ):
        if not merged.get(key) and fallback.get(key):
            merged[key] = fallback[key]
    return merged


def _dedupe_release_rows(rows: list[dict]) -> list[dict]:
    deduped: dict[tuple[str, str, str], dict] = {}
    order: list[tuple[str, str, str]] = []
    for row in rows:
        key = _release_dedupe_key(row)
        if not all(key):
            key = (
                key[0] or f"artist:{row.get('id')}",
                key[1] or f"date:{row.get('id')}",
                key[2] or f"title:{row.get('id')}",
            )
            order.append(key)
            deduped[key] = dict(row)
            continue
        existing = deduped.get(key)
        if existing is None:
            order.append(key)
            deduped[key] = dict(row)
            continue
        if _release_row_score(row) > _release_row_score(existing):
            deduped[key] = _merge_release_rows(dict(row), existing)
        else:
            deduped[key] = _merge_release_rows(existing, row)

    releases = [deduped[key] for key in order if key in deduped]
    for release in releases:
        release["album_title"] = _release_title_without_redundant_type(
            str(release.get("album_title") or ""),
            str(release.get("release_type") or ""),
        )
    return releases


def get_feed_new_albums(
    followed_names: list[str], cutoff: str, limit: int
) -> list[dict]:
    if not followed_names:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT 'new_album' AS type, la.artist, la.name AS title, la.year, la.has_cover,
                   la.updated_at AS date
            FROM library_albums la
            WHERE la.artist = ANY(:followed_names)
            AND la.updated_at >= :cutoff
            ORDER BY la.updated_at DESC
            LIMIT :limit
        """),
                {
                    "followed_names": list(followed_names),
                    "cutoff": cutoff,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
        return serialize_rows(rows)


def get_feed_shows(followed_names: list[str], today: date, limit: int) -> list[dict]:
    if not followed_names:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT 'show' AS type, s.artist_name AS artist, s.venue AS title,
                   s.city, s.country, s.date, s.url, s.image_url
            FROM shows s
            WHERE s.artist_name = ANY(:followed_names)
            AND s.date >= :today
            ORDER BY s.date
            LIMIT :limit
        """),
                {
                    "followed_names": list(followed_names),
                    "today": today,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
        return serialize_rows(rows)


def get_feed_new_releases(limit: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT 'release' AS type, nr.artist_name AS artist, nr.album_title AS title,
                   nr.cover_url, nr.year, nr.status, nr.detected_at AS date
            FROM new_releases nr
            WHERE nr.status != 'dismissed'
            ORDER BY nr.detected_at DESC
            LIMIT :limit
        """),
                {"limit": limit},
            )
            .mappings()
            .all()
        )
        return serialize_rows(rows)


def get_upcoming_releases(
    followed_names: list[str],
    today: date,
    recent_cutoff: str,
    limit: int,
) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT
                nr.id,
                nr.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                lalb.id AS album_id,
                lalb.slug AS album_slug,
                nr.album_title,
                nr.cover_url,
                nr.status,
                nr.tidal_url,
                nr.source_url,
                nr.release_type,
                nr.release_date,
                nr.detected_at
            FROM new_releases nr
            LEFT JOIN library_artists la ON la.name = nr.artist_name
            LEFT JOIN library_albums lalb
              ON LOWER(lalb.artist) = LOWER(nr.artist_name)
             AND LOWER(lalb.name) = LOWER(nr.album_title)
            WHERE nr.artist_name = ANY(:followed_names)
              AND nr.status != 'dismissed'
              AND (
                (nr.release_date IS NOT NULL AND nr.release_date > :today)
                OR (
                    nr.detected_at >= :recent_cutoff
                    AND (nr.release_date IS NULL OR nr.release_date < :today)
                )
              )
            ORDER BY COALESCE(nr.release_date, (nr.detected_at AT TIME ZONE 'UTC')::date) ASC
            LIMIT :limit
            """),
                {
                    "followed_names": followed_names,
                    "today": today,
                    "recent_cutoff": recent_cutoff,
                    "limit": limit * 3,
                },
            )
            .mappings()
            .all()
        )
        return _dedupe_release_rows(serialize_rows(rows))[:limit]


def get_upcoming_shows(
    followed_names: list[str],
    today: date,
    user_lat: float | None,
    user_lon: float | None,
    user_radius: int,
    limit: int,
) -> list[dict]:
    params: dict = {
        "followed_names": followed_names,
        "today": today,
        "limit": limit * 3,
    }
    geo_clause = ""
    if user_lat is not None and user_lon is not None:
        lon_scale = max(1.0, 111.320 * abs(cos(radians(user_lat))))
        distance_sql = """
            6371 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(:lat)) * cos(radians(s.latitude))
                    * cos(radians(s.longitude) - radians(:lon))
                    + sin(radians(:lat)) * sin(radians(s.latitude))
                ))
            )
        """
        geo_clause = f"""
                  AND s.latitude IS NOT NULL
                  AND s.longitude IS NOT NULL
                  AND s.latitude BETWEEN :lat_min AND :lat_max
                  AND s.longitude BETWEEN :lon_min AND :lon_max
                  AND ({distance_sql}) <= :radius
        """
        params["lat"] = user_lat
        params["lon"] = user_lon
        params["radius"] = user_radius
        params["lat_min"] = user_lat - user_radius / 111.0
        params["lat_max"] = user_lat + user_radius / 111.0
        params["lon_min"] = user_lon - user_radius / lon_scale
        params["lon_max"] = user_lon + user_radius / lon_scale
    with read_scope() as session:
        # geo_clause is a hardcoded SQL fragment built internally above;
        # it contains no user input — only parameter placeholders.
        rows = (
            session.execute(
                text(
                    """
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
                """
                    + geo_clause
                    + """
                ORDER BY s.date ASC
                LIMIT :limit
                """
                ),
                params,
            )
            .mappings()
            .all()
        )
        clean_rows = [
            row for row in serialize_rows(rows) if not show_has_tribute_signal(row)
        ]
        return dedupe_show_rows(clean_rows)[:limit]


def get_artist_genres_for_names(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT ag.artist_name, g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name = ANY(:artist_names)
            ORDER BY ag.weight DESC
            """),
                {"artist_names": artist_names},
            )
            .mappings()
            .all()
        )
        genre_map: dict[str, list[str]] = {}
        for row in rows:
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
        return genre_map


def get_scrobble_identities(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT provider, status, metadata_json
            FROM user_external_identities
            WHERE user_id = :user_id AND provider IN ('lastfm', 'listenbrainz')
        """),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        return serialize_rows(rows)


def get_user_scrobble_identities(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT provider, external_username, metadata_json
            FROM user_external_identities
            WHERE user_id = :user_id AND provider IN ('lastfm', 'listenbrainz')
              AND status = 'linked'
        """),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        return serialize_rows(rows)
