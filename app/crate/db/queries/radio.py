"""Read-side queries for the shaped radio engine."""

from __future__ import annotations

import random

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_seed(track_ref: str) -> tuple[list[float], str] | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    bliss_vector,
                    title,
                    artist
                FROM library_tracks
                WHERE bliss_vector IS NOT NULL
                  AND (
                    CAST(id AS text) = :track_ref
                    OR (storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref)
                    OR path = :track_ref
                    OR path LIKE ('%/' || :track_ref)
                  )
                ORDER BY
                  CASE
                    WHEN CAST(id AS text) = :track_ref THEN 0
                    WHEN storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref THEN 1
                    WHEN path = :track_ref THEN 2
                    ELSE 3
                  END
                LIMIT 1
                """
            ),
            {"track_ref": track_ref},
        ).mappings().first()
    if not row:
        return None
    return list(row["bliss_vector"]), f"{row['title']} — {row['artist']}"


def get_track_path_by_id(track_id: int) -> str | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT path FROM library_tracks WHERE id = :track_id LIMIT 1"),
            {"track_id": track_id},
        ).mappings().first()
    return str(row["path"]) if row and row.get("path") else None


def get_track_path_by_pattern(path: str, escaped_like: str) -> str | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT path
                FROM library_tracks
                WHERE path = :path
                   OR path ILIKE ('%/' || :escaped_like) ESCAPE '\\'
                ORDER BY CASE WHEN path = :path THEN 0 ELSE 1 END, path
                LIMIT 1
                """
            ),
            {"path": path, "escaped_like": escaped_like},
        ).mappings().first()
    return str(row["path"]) if row and row.get("path") else None


def get_album_for_radio(album_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, artist, name
                FROM library_albums
                WHERE id = :album_id
                LIMIT 1
                """
            ),
            {"album_id": album_id},
        ).mappings().first()
    return dict(row) if row else None


def get_playlist_for_radio(playlist_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, name, scope, user_id, is_active
                FROM playlists
                WHERE id = :playlist_id
                LIMIT 1
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().first()
    return dict(row) if row else None


def get_playlist_seed(playlist_id: int, limit: int = 30) -> tuple[list[list[float]], str] | None:
    with read_scope() as session:
        playlist = session.execute(
            text("SELECT name FROM playlists WHERE id = :playlist_id"),
            {"playlist_id": playlist_id},
        ).mappings().first()
        if not playlist:
            return None

        rows = session.execute(
            text(
                """
                SELECT lt.bliss_vector
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT lt.bliss_vector
                    FROM library_tracks lt
                    WHERE lt.bliss_vector IS NOT NULL
                      AND (
                        (pt.track_id IS NOT NULL AND lt.id = pt.track_id)
                        OR lt.path = pt.track_path
                        OR lt.path LIKE ('%/' || pt.track_path)
                      )
                    ORDER BY
                      CASE
                        WHEN pt.track_id IS NOT NULL AND lt.id = pt.track_id THEN 0
                        WHEN lt.path = pt.track_path THEN 1
                        ELSE 2
                      END
                    LIMIT 1
                ) lt ON TRUE
                WHERE pt.playlist_id = :playlist_id
                  AND lt.bliss_vector IS NOT NULL
                ORDER BY pt.position
                LIMIT :limit
                """
            ),
            {"playlist_id": playlist_id, "limit": limit},
        ).mappings().all()

    vectors = [list(row["bliss_vector"]) for row in rows]
    if not vectors:
        return None
    return vectors, str(playlist["name"])


def get_home_playlist_seed(user_id: int, playlist_id: str, limit: int = 30) -> tuple[list[list[float]], str] | None:
    from crate.db.home import get_home_playlist

    playlist = get_home_playlist(user_id, playlist_id, limit=max(limit, 40))
    if not playlist:
        return None

    vectors: list[list[float]] = []
    for track in playlist.get("tracks") or []:
        track_ref = (
            str(track.get("track_id"))
            if track.get("track_id") is not None
            else str(track.get("track_storage_id") or track.get("track_path") or "")
        )
        if not track_ref:
            continue
        resolved = get_track_seed(track_ref)
        if not resolved:
            continue
        vector, _label = resolved
        vectors.append(vector)
        if len(vectors) >= limit:
            break

    if not vectors:
        return None
    return vectors, str(playlist.get("name") or playlist_id)


def get_recent_liked_vectors(user_id: int, limit: int = 10) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.bliss_vector
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
    return [list(row["bliss_vector"]) for row in rows]


def get_followed_artist_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT t.bliss_vector
                FROM user_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(row["bliss_vector"]) for row in rows]


def get_saved_album_vectors(user_id: int, limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.bliss_vector
                FROM user_saved_albums sa
                JOIN library_tracks t ON t.album_id = sa.album_id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(row["bliss_vector"]) for row in rows]


def get_recent_play_vectors(user_id: int, limit: int = 20) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.bliss_vector
                FROM user_play_events pe
                LEFT JOIN library_tracks t ON t.id = pe.track_id
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY pe.ended_at DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [list(row["bliss_vector"]) for row in rows]


def get_random_library_vectors(limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.bliss_vector
                FROM library_tracks t
                WHERE t.bliss_vector IS NOT NULL
                ORDER BY RANDOM()
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [list(row["bliss_vector"]) for row in rows]


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


def get_track_bliss_vector(track_id: int) -> list[float] | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
            {"id": track_id},
        ).mappings().first()
    return list(row["bliss_vector"]) if row else None


def load_feedback_history(user_id: int, max_age_days: int = 90) -> tuple[list[list[float]], list[list[float]]]:
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
        if age > 30 and random.random() > 0.25:
            continue
        if age > 7 and random.random() > 0.5:
            continue
        if row["action"] == "like":
            liked.append(vec)
        elif row["action"] == "dislike":
            disliked.append(vec)
    return liked, disliked
