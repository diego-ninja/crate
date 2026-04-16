from crate.db.core import get_db_ctx


def search_artists(like: str, limit: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT id, slug, name, album_count, has_photo
            FROM library_artists
            WHERE name ILIKE %s
            ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
            LIMIT %s
            """,
            (like, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def search_albums(like: str, limit: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT a.id, a.slug, a.artist, a.name, a.year, a.has_cover,
                   ar.id AS artist_id, ar.slug AS artist_slug
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.name ILIKE %s OR a.artist ILIKE %s
            ORDER BY year DESC NULLS LAST, name ASC
            LIMIT %s
            """,
            (like, like, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def search_tracks(like: str, limit: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT t.id, t.storage_id, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                   a.name AS album, ar.id AS artist_id, ar.slug AS artist_slug,
                   t.path, t.duration
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.title ILIKE %s OR t.artist ILIKE %s OR a.name ILIKE %s
            ORDER BY t.title ASC
            LIMIT %s
            """,
            (like, like, like, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def list_favorites() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("SELECT item_type, item_id, created_at FROM favorites ORDER BY created_at DESC")
        return [dict(row) for row in cur.fetchall()]


def add_favorite(item_type: str, item_id: str, created_at: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO favorites (item_type, item_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (item_type, item_id, created_at),
        )


def remove_favorite(item_type: str, item_id: str) -> None:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM favorites WHERE item_id = %s AND item_type = %s", (item_id, item_type))


def find_track_id_by_path(path_like: str) -> int | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_tracks WHERE path LIKE %s LIMIT 1", (f"%{path_like}",))
        row = cur.fetchone()
        return row["id"] if row else None


def get_track_info_cols(track_id: int, cols: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(f"SELECT {cols} FROM library_tracks WHERE id = %s", (track_id,))
        return cur.fetchone()


def get_track_info_cols_by_storage_id(storage_id: str, cols: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(f"SELECT {cols} FROM library_tracks WHERE storage_id = %s", (storage_id,))
        return cur.fetchone()


def get_track_info_cols_by_path(filepath: str, cols: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT {cols} FROM library_tracks WHERE path LIKE %s LIMIT 1",
            (f"%{filepath}",),
        )
        return cur.fetchone()


def get_track_exists(track_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM library_tracks WHERE id = %s", (track_id,))
        return cur.fetchone() is not None


def get_track_id_by_storage_id(storage_id: str) -> int | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
        return row["id"] if row else None


def get_track_album_genres(track_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT g.name, g.slug, ag.weight
            FROM library_tracks t
            JOIN album_genres ag ON ag.album_id = t.album_id
            JOIN genres g ON g.id = ag.genre_id
            WHERE t.id = %s
            ORDER BY ag.weight DESC NULLS LAST, g.name ASC
            LIMIT 10
            """,
            (track_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_track_artist_genres(track_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT g.name, g.slug, arg.weight
            FROM library_tracks t
            JOIN artist_genres arg ON arg.artist_name = t.artist
            JOIN genres g ON g.id = arg.genre_id
            WHERE t.id = %s
            ORDER BY arg.weight DESC NULLS LAST, g.name ASC
            LIMIT 10
            """,
            (track_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_track_path(track_id: int) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        return row["path"] if row else None


def get_track_path_by_storage_id(storage_id: str) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
        return row["path"] if row else None


def count_mood_tracks(conditions: list[str], params: list) -> int:
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM library_tracks WHERE {' AND '.join(conditions)}",
            params,
        )
        return cur.fetchone()["cnt"]


def get_mood_tracks(conditions: list[str], params: list, limit: int) -> list[dict]:
    all_params = params + [limit]
    with get_db_ctx() as cur:
        cur.execute(
            f"""SELECT t.id, t.storage_id, t.title, t.artist, a.name AS album, t.path, t.duration,
                       ar.id AS artist_id, ar.slug AS artist_slug,
                       a.id AS album_id, a.slug AS album_slug,
                       t.bpm, t.energy, t.danceability, t.valence
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE {' AND '.join(conditions)}
                ORDER BY RANDOM() LIMIT %s""",
            all_params,
        )
        return [dict(r) for r in cur.fetchall()]
