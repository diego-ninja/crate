"""Database queries for analysis_daemon — background analysis state management.

Uses FOR UPDATE SKIP LOCKED for atomic claim queries — keep exactly as-is.
"""

from datetime import datetime, timezone

from crate.db.tx import transaction_scope
from sqlalchemy import text


def claim_track(state_column: str) -> dict | None:
    """Atomically claim the next pending track for processing.
    Uses FOR UPDATE SKIP LOCKED to avoid race conditions.
    Quick-checks pending count first to avoid expensive lock query when idle."""
    col = _validate_state_column(state_column)
    with transaction_scope() as session:
        # Fast path: skip the FOR UPDATE if nothing is pending
        pending = session.execute(
            text(f"SELECT EXISTS(SELECT 1 FROM library_tracks WHERE {col} = 'pending' AND path IS NOT NULL)")
        ).scalar()
        if not pending:
            return None
        row = session.execute(text(f"""
            UPDATE library_tracks
            SET {col} = 'analyzing'
            WHERE id = (
                SELECT id FROM library_tracks
                WHERE {col} = 'pending' AND path IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, path, title, artist, album
        """)).mappings().first()
        return dict(row) if row else None


_ALLOWED_STATE_COLUMNS = frozenset({"analysis_state", "bliss_state"})


def _validate_state_column(state_column: str) -> str:
    if state_column not in _ALLOWED_STATE_COLUMNS:
        raise ValueError(f"Invalid state column: {state_column!r}")
    return state_column


def mark_done(track_id: int, state_column: str):
    col = _validate_state_column(state_column)
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'done', updated_at = :now WHERE id = :id"),
            {"now": now, "id": track_id},
        )


def mark_failed(track_id: int, state_column: str):
    col = _validate_state_column(state_column)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'failed' WHERE id = :id"),
            {"id": track_id},
        )


def reset_stale_claims(state_column: str) -> int:
    """On startup, reset any tracks stuck in 'analyzing' state from a previous crash.
    Returns the number of rows reset."""
    col = _validate_state_column(state_column)
    with transaction_scope() as session:
        result = session.execute(
            text(f"UPDATE library_tracks SET {col} = 'pending' WHERE {col} = 'analyzing'")
        )
        return result.rowcount


def get_pending_count(state_column: str) -> int:
    col = _validate_state_column(state_column)
    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT COUNT(*) as cnt FROM library_tracks WHERE {col} = 'pending'")
        ).mappings().first()
        return row["cnt"]


def store_bliss_vector(track_id: int, vector: list[float]):
    """Store a bliss vector and mark as done in one update."""
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET bliss_vector = :vector, bliss_state = 'done' "
                 "WHERE id = :id"),
            {"vector": vector, "id": track_id},
        )


def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    with transaction_scope() as session:
        row = session.execute(text("""
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
        """)).mappings().first()
        return dict(row) if row else {}


# ── Worker handler queries ───────────────────────────────────────


def get_artists_needing_analysis() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(text(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bpm IS NULL OR t.energy IS NULL "
            "GROUP BY al.artist"
        )).mappings().all()
        return {row["artist"] for row in rows}


def get_artists_needing_bliss() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(text(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bliss_vector IS NULL "
            "GROUP BY al.artist"
        )).mappings().all()
        return {row["artist"] for row in rows}


def get_albums_needing_popularity(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, name, tag_album FROM library_albums "
                 "WHERE artist = :artist AND lastfm_listeners IS NULL"),
            {"artist": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                 "WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def get_tracks_needing_popularity(artist_name: str, limit: int = 50) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT t.id, t.title FROM library_tracks t "
                 "JOIN library_albums a ON t.album_id = a.id "
                 "WHERE a.artist = :artist AND t.lastfm_listeners IS NULL "
                 "AND t.title IS NOT NULL AND t.title != '' LIMIT :lim"),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                 "WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def requeue_tracks(set_clause: str, track_id: int | None = None,
                   album_id: int | None = None, artist: str | None = None,
                   album_name: str | None = None, scope: str | None = None) -> int:
    with transaction_scope() as session:
        if track_id:
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause} WHERE id = :id"), {"id": track_id})
        elif album_id:
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause} WHERE album_id = :album_id"), {"album_id": album_id})
        elif artist and album_name:
            result = session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                     "(SELECT id FROM library_albums WHERE artist = :artist AND name = :album_name)"),
                {"artist": artist, "album_name": album_name},
            )
        elif artist:
            result = session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                     "(SELECT id FROM library_albums WHERE artist = :artist)"),
                {"artist": artist},
            )
        elif scope == "all":
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause}"))
        else:
            return 0
        return result.rowcount
