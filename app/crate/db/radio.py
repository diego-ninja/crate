"""Database functions for the shaped radio engine."""

import logging

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope

log = logging.getLogger(__name__)


def get_recent_liked_vectors(user_id: int, limit: int = 10) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM user_liked_tracks lt
                JOIN library_tracks t ON t.id = lt.track_id
                WHERE lt.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY lt.created_at DESC
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(r["bliss_vector"]) for r in rows]


def get_followed_artist_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT DISTINCT t.bliss_vector
                FROM user_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(r["bliss_vector"]) for r in rows]


def get_saved_album_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM user_saved_albums sa
                JOIN library_tracks t ON t.album_id = sa.album_id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(r["bliss_vector"]) for r in rows]


def get_recent_play_vectors(user_id: int, limit: int = 20) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM user_play_events pe
                LEFT JOIN library_tracks t ON t.id = pe.track_id
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY pe.ended_at DESC
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(r["bliss_vector"]) for r in rows]


def get_random_library_vectors(limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM library_tracks t
                WHERE t.bliss_vector IS NOT NULL
                ORDER BY RANDOM()
                LIMIT :limit
            """),
            {"limit": limit},
        ).mappings().all()
    return [list(r["bliss_vector"]) for r in rows]


def count_user_radio_signals(user_id: int) -> dict:
    with read_scope() as session:
        row = session.execute(
            text("""
                SELECT
                    (SELECT count(*) FROM user_liked_tracks WHERE user_id = :uid) AS likes,
                    (SELECT count(*) FROM user_follows WHERE user_id = :uid) AS follows,
                    (SELECT count(*) FROM user_saved_albums WHERE user_id = :uid) AS saved_albums
            """),
            {"uid": user_id},
        ).mappings().first()
    return dict(row) if row else {"likes": 0, "follows": 0, "saved_albums": 0}


def get_track_bliss_vector(track_id: int) -> list[float] | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
            {"id": track_id},
        ).mappings().first()
    return list(row["bliss_vector"]) if row else None


def persist_radio_feedback(
    user_id: int, track_id: int, action: str,
    bliss_vector: list[float], session_seed: str,
) -> None:
    try:
        with transaction_scope() as db:
            db.execute(
                text("""
                    INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, session_seed)
                    VALUES (:user_id, :track_id, :action, :bliss_vector, :session_seed)
                    ON CONFLICT ON CONSTRAINT uq_radio_feedback_user_track DO UPDATE
                    SET action = :action, bliss_vector = :bliss_vector,
                        session_seed = :session_seed, created_at = now()
                """),
                {
                    "user_id": user_id,
                    "track_id": track_id,
                    "action": action,
                    "bliss_vector": bliss_vector,
                    "session_seed": session_seed,
                },
            )
    except Exception:
        try:
            with transaction_scope() as db:
                db.execute(
                    text("""
                        INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, session_seed)
                        VALUES (:user_id, :track_id, :action, :bliss_vector, :session_seed)
                    """),
                    {
                        "user_id": user_id,
                        "track_id": track_id,
                        "action": action,
                        "bliss_vector": bliss_vector,
                        "session_seed": session_seed,
                    },
                )
        except Exception:
            log.debug("Failed to persist radio feedback", exc_info=True)


def load_feedback_history(user_id: int, max_age_days: int = 90) -> tuple[list[list[float]], list[list[float]]]:
    import random
    with read_scope() as session:
        rows = session.execute(
            text(f"""
                SELECT action, bliss_vector,
                       EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
                FROM radio_feedback
                WHERE user_id = :user_id
                  AND bliss_vector IS NOT NULL
                  AND created_at > now() - INTERVAL '{max_age_days} days'
                ORDER BY created_at DESC
            """),
            {"user_id": user_id},
        ).mappings().all()

    liked: list[list[float]] = []
    disliked: list[list[float]] = []
    for r in rows:
        vec = list(r["bliss_vector"])
        age = float(r["age_days"])
        if age > 30 and random.random() > 0.25:
            continue
        if age > 7 and random.random() > 0.5:
            continue
        if r["action"] == "like":
            liked.append(vec)
        elif r["action"] == "dislike":
            disliked.append(vec)
    return liked, disliked
