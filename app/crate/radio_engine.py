"""Radio engine — seeded and discovery radio with live shaping.

Sessions are ephemeral (Redis, TTL 24h). The engine reuses Music Paths
hybrid scoring (bliss + artist affinity + genre overlap + shared members)
but without a destination — it radiates outward from a seed, shaped
in real time by like/dislike feedback.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from crate.db.paths import (
    _centroid,
    _find_best_candidate,
    _lerp,
    _load_artist_genres,
    _load_artist_similarity_graph,
    _load_shared_members_graph,
    resolve_bliss_centroid,
    resolve_endpoint_label,
)
from crate.db.tx import read_scope

log = logging.getLogger(__name__)

_SESSION_TTL = 86400  # 24 hours
_DISLIKE_PENALTY_RADIUS = 0.10
_BATCH_SIZE = 5


def _redis():
    """Get the Redis connection used for radio sessions."""
    from crate.db.cache import _get_redis
    return _get_redis()


# ── Session management ─────────────────────────────────────────────


def _session_key(session_id: str) -> str:
    return f"radio:session:{session_id}"


def _save_session(session: dict) -> None:
    r = _redis()
    r.setex(_session_key(session["id"]), _SESSION_TTL, json.dumps(session, default=str))


def _load_session(session_id: str) -> dict | None:
    r = _redis()
    raw = r.get(_session_key(session_id))
    if not raw:
        return None
    return json.loads(raw)


def _delete_session(session_id: str) -> bool:
    r = _redis()
    return r.delete(_session_key(session_id)) > 0


# ── Discovery seed resolution ─────────────────────────────────────


def resolve_discovery_seed(user_id: int) -> tuple[list[float], str] | None:
    """Resolve a seed for discovery radio from user behavior.

    Returns (bliss_vector, label) or None if not enough data.
    Priority: recent likes → followed artists → recent plays → trending.
    """
    from sqlalchemy import text

    with read_scope() as session:
        # 1. Recent liked tracks (last 30 days)
        liked = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM liked_tracks lt
                JOIN library_tracks t ON t.id = lt.track_id
                WHERE lt.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY lt.created_at DESC
                LIMIT 10
            """),
            {"user_id": user_id},
        ).mappings().all()

        if len(liked) >= 5:
            vectors = [list(r["bliss_vector"]) for r in liked]
            return _centroid(vectors), "Your recent likes"

        # 2. Followed artists
        follows = session.execute(
            text("""
                SELECT DISTINCT t.bliss_vector
                FROM artist_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT 30
            """),
            {"user_id": user_id},
        ).mappings().all()

        if len(follows) >= 5:
            vectors = [list(r["bliss_vector"]) for r in follows]
            return _centroid(vectors), "Artists you follow"

        # 2b. Saved albums
        saved = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM saved_albums sa
                JOIN library_tracks t ON t.album_id = sa.album_id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT 30
            """),
            {"user_id": user_id},
        ).mappings().all()

        if len(saved) >= 5:
            vectors = [list(r["bliss_vector"]) for r in saved]
            return _centroid(vectors), "Your saved albums"

        # 3. Recent plays
        plays = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM play_events pe
                JOIN library_tracks t ON t.storage_id = pe.storage_id
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY pe.played_at DESC
                LIMIT 20
            """),
            {"user_id": user_id},
        ).mappings().all()

        if len(plays) >= 10:
            vectors = [list(r["bliss_vector"]) for r in plays]
            return _centroid(vectors), "Your recent plays"

        # 4. Instance trending (most played overall)
        trending = session.execute(
            text("""
                SELECT t.bliss_vector
                FROM library_tracks t
                WHERE t.bliss_vector IS NOT NULL
                ORDER BY RANDOM()
                LIMIT 30
            """),
        ).mappings().all()

        if trending:
            vectors = [list(r["bliss_vector"]) for r in trending]
            return _centroid(vectors), "Library mix"

    return None


def has_enough_data(user_id: int) -> bool:
    """Check if a user has enough data for discovery radio.
    Any signal is enough: 1 follow, 1 saved album, 3 liked tracks, or 5 plays."""
    from sqlalchemy import text
    with read_scope() as session:
        row = session.execute(
            text("""
                SELECT
                    (SELECT count(*) FROM liked_tracks WHERE user_id = :uid) AS likes,
                    (SELECT count(*) FROM artist_follows WHERE user_id = :uid) AS follows,
                    (SELECT count(*) FROM saved_albums WHERE user_id = :uid) AS saved_albums
            """),
            {"uid": user_id},
        ).mappings().first()

    if not row:
        return False
    return (int(row["likes"]) >= 3
            or int(row["follows"]) >= 1
            or int(row["saved_albums"]) >= 1)


# ── Radio start ───────────────────────────────────────────────────


def start_radio(
    user_id: int,
    mode: str = "seeded",
    seed_type: str | None = None,
    seed_value: str | None = None,
) -> dict | None:
    """Start a new radio session. Returns session with first batch of tracks."""
    if mode == "seeded":
        if not seed_type or not seed_value:
            return None
        seed_vec = resolve_bliss_centroid(seed_type, seed_value)
        if not seed_vec:
            return None
        seed_label = resolve_endpoint_label(seed_type, seed_value)
    elif mode == "discovery":
        result = resolve_discovery_seed(user_id)
        if not result:
            return None
        seed_vec, seed_label = result
        seed_type = "discovery"
        seed_value = "auto"
    else:
        return None

    # Pre-seed with historical feedback (persisted likes/dislikes from past sessions)
    hist_liked, hist_disliked = _load_feedback_history(user_id)
    log.info("Radio start: %d historical likes, %d dislikes for user %d",
             len(hist_liked), len(hist_disliked), user_id)

    # Blend historical likes into the initial target for warm start
    initial_target = seed_vec
    if hist_liked:
        hist_centroid = _centroid(hist_liked)
        # Historical influence: 15% max — gentle nudge, not takeover
        blend = min(0.15, 0.03 * len(hist_liked))
        initial_target = _lerp(seed_vec, hist_centroid, blend)

    session_id = str(uuid.uuid4())
    session = {
        "id": session_id,
        "user_id": user_id,
        "mode": mode,
        "seed_type": seed_type,
        "seed_value": seed_value,
        "seed_label": seed_label,
        "initial_target": initial_target,
        "current_target": initial_target,
        "liked_vectors": [],
        "disliked_vectors": hist_disliked[:10],  # pre-load recent dislikes as exclusions
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "track_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    tracks = _generate_batch(session)
    session["track_count"] = len(tracks)
    _save_session(session)

    return {
        "session_id": session_id,
        "mode": mode,
        "seed_label": seed_label,
        "tracks": tracks,
    }


# ── Next batch ────────────────────────────────────────────────────


def next_tracks(session_id: str, count: int = _BATCH_SIZE) -> dict | None:
    """Generate the next batch of tracks for an active radio session."""
    session = _load_session(session_id)
    if not session:
        return None

    tracks = _generate_batch(session, count)
    session["track_count"] += len(tracks)
    _save_session(session)

    return {"session_id": session_id, "tracks": tracks}


# ── Feedback ──────────────────────────────────────────────────────


def radio_feedback(session_id: str, track_id: int, action: str) -> dict | None:
    """Process like/dislike feedback — updates session AND persists to DB."""
    session = _load_session(session_id)
    if not session:
        return None

    from sqlalchemy import text
    with read_scope() as db:
        row = db.execute(
            text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
            {"id": track_id},
        ).mappings().first()

    if not row:
        return {"status": "ok", "effect": "none"}

    vec = list(row["bliss_vector"])

    if action == "like":
        session["liked_vectors"].append(vec)
        liked = session["liked_vectors"]
        like_centroid = _centroid(liked)
        blend = min(0.4, 0.08 * len(liked))
        session["current_target"] = _lerp(session["initial_target"], like_centroid, blend)
        effect = "target_shifted"
    elif action == "dislike":
        session["disliked_vectors"].append(vec)
        effect = "exclusion_added"
    else:
        return {"status": "ok", "effect": "none"}

    _save_session(session)

    # Persist to DB for future sessions
    _persist_feedback(
        user_id=session["user_id"],
        track_id=track_id,
        action=action,
        bliss_vector=vec,
        session_seed=session.get("seed_label", ""),
    )

    return {
        "status": "ok",
        "effect": effect,
        "liked_count": len(session["liked_vectors"]),
        "disliked_count": len(session["disliked_vectors"]),
    }


def _persist_feedback(
    user_id: int, track_id: int, action: str,
    bliss_vector: list[float], session_seed: str,
) -> None:
    """Save feedback to the radio_feedback table for long-term learning."""
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    try:
        with transaction_scope() as db:
            # Upsert: if same user+track exists, update the action
            db.execute(
                text("""
                    INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, session_seed)
                    VALUES (:user_id, :track_id, :action, :bliss_vector, :session_seed)
                    ON CONFLICT (user_id, track_id) DO UPDATE
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
        # ON CONFLICT needs a unique constraint — fall back to simple insert
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


def _load_feedback_history(user_id: int, max_age_days: int = 90) -> tuple[list[list[float]], list[list[float]]]:
    """Load recent radio feedback vectors for a user.

    Returns (liked_vectors, disliked_vectors) with temporal decay:
    recent feedback is included as-is, older feedback is downweighted
    by including fewer vectors.
    """
    from sqlalchemy import text
    with read_scope() as db:
        rows = db.execute(
            text("""
                SELECT action, bliss_vector, created_at,
                       EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
                FROM radio_feedback
                WHERE user_id = :user_id
                  AND bliss_vector IS NOT NULL
                  AND created_at > now() - INTERVAL ':max_age days'
                ORDER BY created_at DESC
            """.replace(":max_age", str(max_age_days))),
            {"user_id": user_id},
        ).mappings().all()

    liked: list[list[float]] = []
    disliked: list[list[float]] = []

    for r in rows:
        vec = list(r["bliss_vector"])
        age = float(r["age_days"])
        # Temporal decay: include all from last 7 days,
        # 50% chance for 7-30 days, 25% for 30-90 days
        import random
        if age > 30 and random.random() > 0.25:
            continue
        if age > 7 and random.random() > 0.5:
            continue

        if r["action"] == "like":
            liked.append(vec)
        elif r["action"] == "dislike":
            disliked.append(vec)

    return liked, disliked


# ── Track generation ──────────────────────────────────────────────


def _generate_batch(session: dict, count: int = _BATCH_SIZE) -> list[dict]:
    """Generate a batch of tracks for the radio session."""
    sim_graph = _load_artist_similarity_graph()
    genre_map = _load_artist_genres()
    member_graph = _load_shared_members_graph()

    target = session["current_target"]
    used_ids = set(session["used_track_ids"])
    used_titles = set(session["used_titles"])
    recent_artists = list(session["recent_artists"])
    disliked_vecs = session["disliked_vectors"]

    # Target artists for genre overlap scoring
    target_artists = [session["seed_label"]]

    tracks: list[dict] = []

    for _ in range(count):
        # Add small random drift to target so we don't get stuck
        import random
        drift = [target[d] + random.gauss(0, 0.02) for d in range(len(target))]

        candidate = _find_best_candidate(
            drift, used_ids, used_titles, recent_artists,
            sim_graph, genre_map, member_graph, target_artists,
        )

        if not candidate:
            break

        # Apply dislike penalty: skip if too close to any disliked track
        if disliked_vecs:
            from crate.db.paths import _vector_to_pg_array
            cand_vec = candidate.get("bliss_vector", [])
            if cand_vec:
                too_close = False
                for dv in disliked_vecs:
                    dist = sum((cand_vec[d] - dv[d]) ** 2 for d in range(len(cand_vec))) ** 0.5
                    if dist < _DISLIKE_PENALTY_RADIUS:
                        too_close = True
                        break
                if too_close:
                    # Try to skip this one — mark as used and continue
                    used_ids.add(candidate["id"])
                    continue

        # Accept the track
        track_id = candidate["id"]
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        used_ids.add(track_id)
        used_titles.add(title_key)
        recent_artists.append(artist)
        if len(recent_artists) > 3:
            recent_artists.pop(0)

        # Blend target toward accepted track for organic drift
        cand_vec = candidate.get("bliss_vector")
        if cand_vec:
            target = _lerp(target, cand_vec, 0.15)

        tracks.append({
            "track_id": track_id,
            "storage_id": str(candidate["storage_id"]) if candidate.get("storage_id") else None,
            "title": title,
            "artist": artist,
            "album": candidate.get("album"),
            "album_id": candidate.get("album_id"),
            "distance": round(candidate["distance"], 6),
        })

    # Update session state
    session["used_track_ids"] = list(used_ids)
    session["used_titles"] = list(used_titles)
    session["recent_artists"] = recent_artists
    session["current_target"] = target

    return tracks
