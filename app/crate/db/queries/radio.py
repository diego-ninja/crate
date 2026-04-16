from crate.db.core import get_db_ctx


def get_track_path_by_id(track_id: int) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    return row["path"] if row else None


def get_track_path_by_pattern(path: str, escaped_path: str) -> str | None:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT path
            FROM library_tracks
            WHERE path = %s OR path LIKE %s ESCAPE '\\'
            ORDER BY CASE WHEN path = %s THEN 0 ELSE 1 END, path ASC
            LIMIT 1
            """,
            (path, f"%{escaped_path}", path),
        )
        row = cur.fetchone()
    return row["path"] if row else None


def get_album_for_radio(album_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT artist, name FROM library_albums WHERE id = %s", (album_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_playlist_for_radio(playlist_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT id, name, scope, user_id, is_active FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
    return dict(row) if row else None
