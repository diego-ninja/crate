"""Database queries for analysis_daemon — background analysis state management.

Uses FOR UPDATE SKIP LOCKED for atomic claim queries — keep exactly as-is.
"""

from datetime import datetime, timezone

from crate.db.core import get_db_ctx


def claim_track(state_column: str) -> dict | None:
    """Atomically claim the next pending track for processing.
    Uses FOR UPDATE SKIP LOCKED to avoid race conditions."""
    with get_db_ctx() as cur:
        cur.execute(f"""
            UPDATE library_tracks
            SET {state_column} = 'analyzing'
            WHERE id = (
                SELECT id FROM library_tracks
                WHERE {state_column} = 'pending' AND path IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, path, title, artist, album
        """)
        row = cur.fetchone()
        return dict(row) if row else None


def mark_done(track_id: int, state_column: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'done', updated_at = %s WHERE id = %s",
            (now, track_id),
        )


def mark_failed(track_id: int, state_column: str):
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'failed' WHERE id = %s",
            (track_id,),
        )


def reset_stale_claims(state_column: str) -> int:
    """On startup, reset any tracks stuck in 'analyzing' state from a previous crash.
    Returns the number of rows reset."""
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'pending' WHERE {state_column} = 'analyzing'"
        )
        return cur.rowcount


def get_pending_count(state_column: str) -> int:
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT COUNT(*) as cnt FROM library_tracks WHERE {state_column} = 'pending'"
        )
        return cur.fetchone()["cnt"]


def store_bliss_vector(track_id: int, vector: list[float]):
    """Store a bliss vector and mark as done in one update."""
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET bliss_vector = %s, bliss_state = 'done' "
            "WHERE id = %s",
            (vector, track_id),
        )


def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE analysis_state = 'done') as analysis_done,
                COUNT(*) FILTER (WHERE analysis_state = 'pending') as analysis_pending,
                COUNT(*) FILTER (WHERE analysis_state = 'analyzing') as analysis_active,
                COUNT(*) FILTER (WHERE analysis_state = 'failed') as analysis_failed,
                COUNT(*) FILTER (WHERE bliss_state = 'done') as bliss_done,
                COUNT(*) FILTER (WHERE bliss_state = 'pending') as bliss_pending,
                COUNT(*) FILTER (WHERE bliss_state = 'analyzing') as bliss_active,
                COUNT(*) FILTER (WHERE bliss_state = 'failed') as bliss_failed
            FROM library_tracks
        """)
        row = cur.fetchone()
        return dict(row) if row else {}


# ── Worker handler queries ───────────────────────────────────────


def get_artists_needing_analysis() -> set[str]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bpm IS NULL OR t.energy IS NULL "
            "GROUP BY al.artist"
        )
        return {row["artist"] for row in cur.fetchall()}


def get_artists_needing_bliss() -> set[str]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bliss_vector IS NULL "
            "GROUP BY al.artist"
        )
        return {row["artist"] for row in cur.fetchall()}


def get_albums_needing_popularity(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id, name, tag_album FROM library_albums "
            "WHERE artist = %s AND lastfm_listeners IS NULL",
            (artist_name,),
        )
        return [dict(row) for row in cur.fetchall()]


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s "
            "WHERE id = %s",
            (listeners, playcount, album_id),
        )


def get_tracks_needing_popularity(artist_name: str, limit: int = 50) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT t.id, t.title FROM library_tracks t "
            "JOIN library_albums a ON t.album_id = a.id "
            "WHERE a.artist = %s AND t.lastfm_listeners IS NULL "
            "AND t.title IS NOT NULL AND t.title != '' LIMIT %s",
            (artist_name, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s "
            "WHERE id = %s",
            (listeners, playcount, track_id),
        )


def requeue_tracks(set_clause: str, track_id: int | None = None,
                   album_id: int | None = None, artist: str | None = None,
                   album_name: str | None = None, scope: str | None = None) -> int:
    with get_db_ctx() as cur:
        if track_id:
            cur.execute(f"UPDATE library_tracks SET {set_clause} WHERE id = %s", (track_id,))
        elif album_id:
            cur.execute(f"UPDATE library_tracks SET {set_clause} WHERE album_id = %s", (album_id,))
        elif artist and album_name:
            cur.execute(
                f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                "(SELECT id FROM library_albums WHERE artist = %s AND name = %s)",
                (artist, album_name),
            )
        elif artist:
            cur.execute(
                f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                "(SELECT id FROM library_albums WHERE artist = %s)",
                (artist,),
            )
        elif scope == "all":
            cur.execute(f"UPDATE library_tracks SET {set_clause}")
        else:
            return 0
        return cur.rowcount
