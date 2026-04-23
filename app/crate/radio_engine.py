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
from crate.db.radio import (
    count_user_radio_signals,
    get_followed_artist_vectors,
    get_home_playlist_seed,
    get_playlist_seed,
    get_random_library_vectors,
    get_recent_liked_vectors,
    get_recent_play_vectors,
    get_saved_album_vectors,
    get_track_seed,
    get_track_bliss_vector,
    load_feedback_history,
    persist_radio_feedback,
)

log = logging.getLogger(__name__)

_SESSION_TTL = 86400  # 24 hours
_DISLIKE_PENALTY_RADIUS = 0.10
_BATCH_SIZE = 20


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
    """Resolve a seed for discovery radio from user behavior."""
    # 1. Recent liked tracks
    liked = get_recent_liked_vectors(user_id, limit=10)
    if len(liked) >= 5:
        return _centroid(liked), "Your recent likes"

    # 2. Followed artists
    follows = get_followed_artist_vectors(user_id, limit=30)
    if len(follows) >= 5:
        return _centroid(follows), "Artists you follow"

    # 2b. Saved albums
    saved = get_saved_album_vectors(user_id, limit=30)
    if len(saved) >= 5:
        return _centroid(saved), "Your saved albums"

    # 3. Recent plays
    plays = get_recent_play_vectors(user_id, limit=20)
    if len(plays) >= 10:
        return _centroid(plays), "Your recent plays"

    # 4. Library mix (fallback)
    trending = get_random_library_vectors(limit=30)
    if trending:
        return _centroid(trending), "Library mix"

    return None


def has_enough_data(user_id: int) -> bool:
    """Check if a user has enough data for discovery radio."""
    counts = count_user_radio_signals(user_id)
    return (int(counts["likes"]) >= 3
            or int(counts["follows"]) >= 1
            or int(counts["saved_albums"]) >= 1)


# ── Radio start ───────────────────────────────────────────────────


def _resolve_seed(user_id: int, seed_type: str, seed_value: str) -> tuple[list[float], str] | None:
    if seed_type == "track":
        return get_track_seed(seed_value)

    if seed_type == "playlist":
        try:
            playlist_id = int(seed_value)
        except (TypeError, ValueError):
            return None
        resolved = get_playlist_seed(playlist_id)
        if not resolved:
            return None
        vectors, label = resolved
        return _centroid(vectors), label

    if seed_type == "home-playlist":
        resolved = get_home_playlist_seed(user_id, seed_value)
        if not resolved:
            return None
        vectors, label = resolved
        return _centroid(vectors), label

    seed_vec = resolve_bliss_centroid(seed_type, seed_value)
    if not seed_vec:
        return None
    return seed_vec, resolve_endpoint_label(seed_type, seed_value)


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
        resolved_seed = _resolve_seed(user_id, seed_type, seed_value)
        if not resolved_seed:
            return None
        seed_vec, seed_label = resolved_seed
    elif mode == "discovery":
        result = resolve_discovery_seed(user_id)
        if not result:
            return None
        seed_vec, seed_label = result
        seed_type = "discovery"
        seed_value = "auto"
    else:
        return None

    # Pre-seed with historical feedback
    hist_liked, hist_disliked = load_feedback_history(user_id)
    log.info("Radio start: %d historical likes, %d dislikes for user %d",
             len(hist_liked), len(hist_disliked), user_id)

    initial_target = seed_vec
    if hist_liked:
        hist_centroid = _centroid(hist_liked)
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
        "disliked_vectors": hist_disliked[:10],
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

    vec = get_track_bliss_vector(track_id)
    if not vec:
        return {"status": "ok", "effect": "none"}

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

    persist_radio_feedback(
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

    target_artists = [session["seed_label"]]

    tracks: list[dict] = []

    for _ in range(count):
        import random
        drift = [target[d] + random.gauss(0, 0.02) for d in range(len(target))]

        candidate = _find_best_candidate(
            drift, used_ids, used_titles, recent_artists,
            sim_graph, genre_map, member_graph, target_artists,
        )

        if not candidate:
            break

        # Dislike exclusion
        if disliked_vecs:
            cand_vec = candidate.get("bliss_vector", [])
            if cand_vec:
                too_close = any(
                    sum((cand_vec[d] - dv[d]) ** 2 for d in range(len(cand_vec))) ** 0.5 < _DISLIKE_PENALTY_RADIUS
                    for dv in disliked_vecs
                )
                if too_close:
                    used_ids.add(candidate["id"])
                    continue

        track_id = candidate["id"]
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        used_ids.add(track_id)
        used_titles.add(title_key)
        recent_artists.append(artist)
        if len(recent_artists) > 3:
            recent_artists.pop(0)

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
