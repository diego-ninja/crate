"""Database queries for library_sync — filesystem to DB synchronization."""

from crate.db.core import get_db_ctx


def get_album_track_count(album_id: int) -> int:
    """Count actual library_tracks rows for an album."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM library_tracks WHERE album_id = %s",
            (album_id,),
        )
        return int(cur.fetchone()["cnt"] or 0)


def get_album_id_by_path(path: str) -> int | None:
    """Return album ID by path, or None."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id FROM library_albums WHERE path = %s", (path,)
        )
        row = cur.fetchone()
        return row["id"] if row else None


def get_tracks_by_album_id(album_id: int) -> dict[str, dict]:
    """Return existing tracks keyed by path for an album."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_tracks WHERE album_id = %s",
            (album_id,),
        )
        return {r["path"]: dict(r) for r in cur.fetchall()}


def delete_track_by_path(path: str):
    """Delete a single track by path."""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM library_tracks WHERE path = %s", (path,))


def get_all_artist_names_and_counts() -> list[dict]:
    """Return all artists with name, album_count, track_count."""
    with get_db_ctx() as cur:
        cur.execute("SELECT name, album_count, track_count FROM library_artists")
        return [dict(row) for row in cur.fetchall()]


def merge_artist_into(source: str, target: str):
    """Move all albums and tracks from source artist to target, then delete source."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT s.id AS source_id, t.id AS target_id
            FROM library_albums s
            JOIN library_albums t ON LOWER(s.name) = LOWER(t.name) AND t.artist = %s
            WHERE s.artist = %s
        """, (target, source))
        conflicts = cur.fetchall()

        for c in conflicts:
            cur.execute("UPDATE library_tracks SET album_id = %s, artist = %s WHERE album_id = %s",
                        (c["target_id"], target, c["source_id"]))
            cur.execute("DELETE FROM library_albums WHERE id = %s", (c["source_id"],))

        cur.execute("UPDATE library_albums SET artist = %s WHERE artist = %s", (target, source))
        cur.execute("UPDATE library_tracks SET artist = %s WHERE artist = %s", (target, source))
        cur.execute("DELETE FROM library_artists WHERE name = %s", (source,))


def get_album_paths_for_artist(artist_name: str) -> list[str]:
    """Return album paths for an artist."""
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_albums WHERE artist = %s", (artist_name,))
        return [r["path"] for r in cur.fetchall()]


def get_all_album_paths() -> list[dict]:
    """Return all album paths with artist."""
    with get_db_ctx() as cur:
        cur.execute("SELECT path, artist FROM library_albums")
        return [dict(row) for row in cur.fetchall()]
