"""User-signal and feedback queries for the shaped radio engine."""

from __future__ import annotations

import random

from sqlalchemy import text

from crate.db.tx import read_scope


def _vectors_from_rows(rows) -> list[list[float]]:
    return [list(row["bliss_vector"]) for row in rows]


def get_recent_liked_seed_rows(user_id: int, limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_liked_tracks lt
                JOIN library_tracks t ON t.id = lt.track_id
                WHERE lt.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY lt.created_at DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_recent_liked_vectors(user_id: int, limit: int = 10) -> list[list[float]]:
    return _vectors_from_rows(get_recent_liked_seed_rows(user_id, limit))


def get_followed_artist_seed_rows(user_id: int, limit: int = 30) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT ON (t.id) t.id AS track_id, t.artist, t.bliss_vector
                FROM user_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY t.id
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_followed_artist_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    return _vectors_from_rows(get_followed_artist_seed_rows(user_id, limit))


def get_saved_album_seed_rows(user_id: int, limit: int = 30) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_saved_albums sa
                JOIN library_tracks t ON t.album_id = sa.album_id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_saved_album_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    return _vectors_from_rows(get_saved_album_seed_rows(user_id, limit))


def get_recent_play_seed_rows(user_id: int, limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_play_events pe
                LEFT JOIN library_tracks t
                  ON t.id = pe.track_id
                  OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL AND t.entity_uid = pe.track_entity_uid)
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY pe.ended_at DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_recent_play_vectors(user_id: int, limit: int = 20) -> list[list[float]]:
    return _vectors_from_rows(get_recent_play_seed_rows(user_id, limit))


def count_user_radio_signals(user_id: int) -> dict:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    (SELECT count(*) FROM user_liked_tracks WHERE user_id = :uid) AS likes,
                    (SELECT count(*) FROM user_follows WHERE user_id = :uid) AS follows,
                    (SELECT count(*) FROM user_saved_albums WHERE user_id = :uid) AS saved_albums
                """
            ),
            {"uid": user_id},
        ).mappings().first()
    return dict(row) if row else {"likes": 0, "follows": 0, "saved_albums": 0}


def load_feedback_history(user_id: int, max_age_days: int = 90) -> tuple[list[list[float]], list[list[float]]]:
    rng = random.Random(f"radio-feedback:{user_id}:{max_age_days}")
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT action, bliss_vector,
                       EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
                FROM radio_feedback
                WHERE user_id = :user_id
                  AND bliss_vector IS NOT NULL
                  AND created_at > now() - INTERVAL '{max_age_days} days'
                ORDER BY created_at DESC
                """
            ),
            {"user_id": user_id},
        ).mappings().all()

    liked: list[list[float]] = []
    disliked: list[list[float]] = []
    for row in rows:
        vec = list(row["bliss_vector"])
        age = float(row["age_days"])
        if age > 30 and rng.random() > 0.25:
            continue
        if age > 7 and rng.random() > 0.5:
            continue
        if row["action"] == "like":
            liked.append(vec)
        elif row["action"] == "dislike":
            disliked.append(vec)
    return liked, disliked


__all__ = [
    "count_user_radio_signals",
    "get_followed_artist_seed_rows",
    "get_followed_artist_vectors",
    "get_recent_liked_seed_rows",
    "get_recent_liked_vectors",
    "get_recent_play_seed_rows",
    "get_recent_play_vectors",
    "get_saved_album_seed_rows",
    "get_saved_album_vectors",
    "load_feedback_history",
]
