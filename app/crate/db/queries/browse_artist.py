from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_artist_refs_by_names_full(names: list[str]) -> dict[str, dict]:
    """Look up artist id/slug/name by lowercase name. Returns {lowercase_name: {id, slug, name}}."""
    normalized_names = sorted({(name or "").strip() for name in names if (name or "").strip()})
    if not normalized_names:
        return {}

    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) = ANY(:names)
            """),
            {"names": [name.lower() for name in normalized_names]},
        ).mappings().all()
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "name": row.get("name"),
            }
            for row in rows
        }


def get_similar_artist_refs(names: list[str]) -> dict[str, dict]:
    if not names:
        return {}

    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) = ANY(:names)
            """),
            {"names": [name.lower() for name in names]},
        ).mappings().all()
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
            }
            for row in rows
        }


def get_browse_filter_genres() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS cnt
            FROM genres g JOIN artist_genres ag ON g.id = ag.genre_id
            GROUP BY g.name HAVING COUNT(DISTINCT ag.artist_name) >= 1
            ORDER BY cnt DESC LIMIT 50
            """)
        ).mappings().all()
        return [{"name": row["name"], "count": row["cnt"]} for row in rows]


def get_browse_filter_countries() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT country, COUNT(*) AS cnt FROM library_artists
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
            """)
        ).mappings().all()
        return [{"name": row["country"], "count": row["cnt"]} for row in rows]


def get_browse_filter_decades() -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT DISTINCT formed FROM library_artists
            WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
            """)
        ).mappings().all()
        decades_set = set()
        for row in rows:
            try:
                decade = f"{int(row['formed'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        return sorted(decades_set)


def get_browse_filter_formats() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
            """)
        ).mappings().all()
        return [{"name": row["format"], "count": row["cnt"]} for row in rows]


def get_artists_count(joins: str, where_sql: str, params: dict) -> int:
    """Count distinct artists matching the filter. ``where_sql`` uses
    ``:named`` params and ``params`` is the corresponding dict."""
    with transaction_scope() as session:
        count_sql = f"SELECT COUNT(DISTINCT la.name) AS cnt FROM library_artists la {joins} WHERE {where_sql}"
        row = session.execute(text(count_sql), params).mappings().first()
        return row["cnt"]


def get_artists_page(select_cols: str, joins: str, where_sql: str, order_sql: str, params: dict, per_page: int, offset: int) -> list[dict]:
    """Paginated artist list. ``where_sql`` uses ``:named`` params."""
    all_params = {**params, "per_page": per_page, "offset": offset}
    with transaction_scope() as session:
        query_sql = (
            f"SELECT DISTINCT {select_cols} FROM library_artists la {joins} "
            f"WHERE {where_sql} ORDER BY {order_sql} LIMIT :per_page OFFSET :offset"
        )
        rows = session.execute(text(query_sql), all_params).mappings().all()
        return [dict(row) for row in rows]


def get_artist_list_genres(artist_name: str) -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                 "WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC LIMIT 5"),
            {"artist_name": artist_name},
        ).mappings().all()
        return [row["name"] for row in rows]


def check_artists_in_library(names: list[str]) -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name FROM library_artists WHERE LOWER(name) = ANY(:names)"),
            {"names": [n.lower() for n in names]},
        ).mappings().all()
        return {r["name"].lower() for r in rows}


def get_artist_all_tracks(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                t.id, t.title, t.artist, t.album, t.path, t.duration,
                t.track_number, t.format,
                a.id as album_id, a.slug as album_slug, a.year,
                ar.id as artist_id, ar.slug as artist_slug
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.artist = :artist_name
        """), {"artist_name": artist_name}).mappings().all()
        return [dict(r) for r in rows]


def get_artist_genres_by_name(artist_name: str, limit: int = 5) -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name = :artist_name
            ORDER BY ag.weight DESC
            LIMIT :limit
            """),
            {"artist_name": artist_name, "limit": limit},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_artist_track_titles_with_albums(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT t.title, t.path, a.name AS album, a.id AS album_id, a.slug AS album_slug "
                 "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
                 "WHERE a.artist = :artist_name ORDER BY t.title"),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_artist_setlist_tracks(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                t.id,
                t.storage_id::text AS track_storage_id,
                t.title,
                t.path,
                t.album,
                t.album_id,
                a.slug AS album_slug,
                t.duration
            FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            WHERE a.artist = :artist_name
            ORDER BY a.year NULLS LAST, a.name, t.track_number NULLS LAST, t.title
            """),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_artist_top_genres(artist_name: str) -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                 "WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC"),
            {"artist_name": artist_name},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_all_artist_genre_map() -> dict[str, list[str]]:
    genre_map: dict[str, list[str]] = {}
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id ORDER BY ag.weight DESC
            """)
        ).mappings().all()
        for row in rows:
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_all_artist_genre_map_for_shows() -> dict[str, list[str]]:
    """Same query as get_all_artist_genre_map, used in upcoming endpoint."""
    return get_all_artist_genre_map()
