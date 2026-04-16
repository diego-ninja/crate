from crate.db.core import get_db_ctx


def get_artist_refs_by_names_full(names: list[str]) -> dict[str, dict]:
    """Look up artist id/slug/name by lowercase name. Returns {lowercase_name: {id, slug, name}}."""
    normalized_names = sorted({(name or "").strip() for name in names if (name or "").strip()})
    if not normalized_names:
        return {}

    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) = ANY(%s)
            """,
            ([name.lower() for name in normalized_names],),
        )
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "name": row.get("name"),
            }
            for row in cur.fetchall()
        }


def get_similar_artist_refs(names: list[str]) -> dict[str, dict]:
    if not names:
        return {}

    placeholders = ",".join(["%s"] * len(names))
    with get_db_ctx() as cur:
        cur.execute(
            f"""
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) IN ({placeholders})
            """,
            [name.lower() for name in names],
        )
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
            }
            for row in cur.fetchall()
        }


def get_browse_filter_genres() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS cnt
            FROM genres g JOIN artist_genres ag ON g.id = ag.genre_id
            GROUP BY g.name HAVING COUNT(DISTINCT ag.artist_name) >= 1
            ORDER BY cnt DESC LIMIT 50
            """
        )
        return [{"name": row["name"], "count": row["cnt"]} for row in cur.fetchall()]


def get_browse_filter_countries() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT country, COUNT(*) AS cnt FROM library_artists
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
            """
        )
        return [{"name": row["country"], "count": row["cnt"]} for row in cur.fetchall()]


def get_browse_filter_decades() -> list[str]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT DISTINCT formed FROM library_artists
            WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
            """
        )
        decades_set = set()
        for row in cur.fetchall():
            try:
                decade = f"{int(row['formed'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        return sorted(decades_set)


def get_browse_filter_formats() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
            """
        )
        return [{"name": row["format"], "count": row["cnt"]} for row in cur.fetchall()]


def get_artists_count(joins: str, where_sql: str, params: list) -> int:
    with get_db_ctx() as cur:
        count_sql = f"SELECT COUNT(DISTINCT la.name) AS cnt FROM library_artists la {joins} WHERE {where_sql}"
        cur.execute(count_sql, params)
        return cur.fetchone()["cnt"]


def get_artists_page(select_cols: str, joins: str, where_sql: str, order_sql: str, params: list, per_page: int, offset: int) -> list[dict]:
    with get_db_ctx() as cur:
        query_sql = (
            f"SELECT DISTINCT {select_cols} FROM library_artists la {joins} "
            f"WHERE {where_sql} ORDER BY {order_sql} LIMIT %s OFFSET %s"
        )
        cur.execute(query_sql, params + [per_page, offset])
        return [dict(row) for row in cur.fetchall()]


def get_artist_list_genres(artist_name: str) -> list[str]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.artist_name = %s ORDER BY ag.weight DESC LIMIT 5",
            (artist_name,),
        )
        return [row["name"] for row in cur.fetchall()]


def check_artists_in_library(names: list[str]) -> set[str]:
    placeholders = ",".join(["%s"] * len(names))
    with get_db_ctx() as cur:
        cur.execute(f"SELECT name FROM library_artists WHERE LOWER(name) IN ({placeholders})",
                    [n.lower() for n in names])
        return {r["name"].lower() for r in cur.fetchall()}


def get_artist_all_tracks(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                t.id, t.title, t.artist, t.album, t.path, t.duration,
                t.track_number, t.format,
                a.id as album_id, a.slug as album_slug, a.year,
                ar.id as artist_id, ar.slug as artist_slug
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.artist = %s
        """, (artist_name,))
        return [dict(r) for r in cur.fetchall()]


def get_artist_genres_by_name(artist_name: str, limit: int = 5) -> list[str]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT g.name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE ag.artist_name = %s
            ORDER BY ag.weight DESC
            LIMIT %s
            """,
            (artist_name, limit),
        )
        return [row["name"] for row in cur.fetchall()]


def get_artist_track_titles_with_albums(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT t.title, t.path, a.name AS album, a.id AS album_id, a.slug AS album_slug "
            "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
            "WHERE a.artist = %s ORDER BY t.title",
            (artist_name,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_artist_setlist_tracks(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
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
            WHERE a.artist = %s
            ORDER BY a.year NULLS LAST, a.name, t.track_number NULLS LAST, t.title
            """,
            (artist_name,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_artist_top_genres(artist_name: str) -> list[str]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
            "WHERE ag.artist_name = %s ORDER BY ag.weight DESC",
            (artist_name,),
        )
        return [row["name"] for row in cur.fetchall()]


def get_all_artist_genre_map() -> dict[str, list[str]]:
    genre_map: dict[str, list[str]] = {}
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT ag.artist_name, g.name FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id ORDER BY ag.weight DESC
            """
        )
        for row in cur.fetchall():
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_all_artist_genre_map_for_shows() -> dict[str, list[str]]:
    """Same query as get_all_artist_genre_map, used in upcoming endpoint."""
    return get_all_artist_genre_map()
