"""Radio engine — seeded and discovery radio with live shaping.

Sessions are ephemeral (Redis, TTL 24h). The engine reuses Music Paths
hybrid scoring (bliss + artist affinity + genre overlap + shared members)
but without a destination — it radiates outward from a seed, shaped
in real time by like/dislike feedback.
"""

import json
import logging
import time
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
from crate.db.paths_similarity import _artist_affinity, _genre_overlap
from crate.db.queries.radio import (
    count_user_radio_signals,
    get_followed_artist_seed_rows,
    get_home_playlist_seed_context,
    get_playlist_seed_context,
    get_random_library_seed_rows,
    get_recent_liked_seed_rows,
    get_recent_play_seed_rows,
    get_saved_album_seed_rows,
    get_track_seed_context,
    get_track_bliss_vector,
    load_feedback_history,
)
from crate.db.queries.paths import load_artist_radio_graphs
from crate.db.repositories.radio import (
    persist_radio_feedback,
)

log = logging.getLogger(__name__)

_SESSION_TTL = 86400  # 24 hours
_DISLIKE_PENALTY_RADIUS = 0.10
_BATCH_SIZE = 20
_RADIO_CANDIDATE_POOL_SIZE = 60
_MAX_GENERATION_ATTEMPT_MULTIPLIER = 4
_SEED_ANCHOR_BLEND = 0.02
_GRAPH_CACHE_TTL_SECONDS = 3600
_DB_EXCLUDE_ID_LIMIT = 200

_graph_cache: tuple[float, dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, set[str]]] | None = None


def _redis():
    """Get the Redis connection used for radio sessions."""
    from crate.db.cache_runtime import _get_redis
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


def _seed_context_from_rows(rows: list[dict]) -> dict:
    artists: list[str] = []
    track_ids: list[int] = []
    seen_artists: set[str] = set()
    seen_tracks: set[int] = set()

    for row in rows:
        artist = (row.get("artist") or "").strip()
        artist_key = artist.lower()
        if artist and artist_key not in seen_artists:
            seen_artists.add(artist_key)
            artists.append(artist)

        track_id = row.get("track_id")
        if track_id is None:
            track_id = row.get("id")
        if track_id is None:
            continue
        track_id = int(track_id)
        if track_id not in seen_tracks:
            seen_tracks.add(track_id)
            track_ids.append(track_id)

    return {"seed_artists": artists[:24], "seed_genres": [], "seed_track_ids": track_ids[:80]}


def _context_for_seed(seed_type: str, seed_value: str, seed_label: str) -> dict:
    if seed_type == "artist":
        return {"seed_artists": [seed_label], "seed_genres": [], "seed_track_ids": []}
    if seed_type == "genre":
        return {"seed_artists": [], "seed_genres": [seed_value or seed_label], "seed_track_ids": []}
    if " — " in seed_label:
        artist = seed_label.rsplit(" — ", 1)[-1].strip()
        if artist:
            return {"seed_artists": [artist], "seed_genres": [], "seed_track_ids": []}
    return {"seed_artists": [], "seed_genres": [], "seed_track_ids": []}


def _vectors_from_rows(rows: list[dict]) -> list[list[float]]:
    return [list(row["bliss_vector"]) for row in rows if row.get("bliss_vector") is not None]


def _seed_result_from_rows(rows: list[dict], label: str, *, minimum: int = 1) -> tuple[list[float], str, dict] | None:
    vectors = _vectors_from_rows(rows)
    if len(vectors) < minimum:
        return None
    return _centroid(vectors), label, _seed_context_from_rows(rows)


def clear_radio_graph_cache() -> None:
    global _graph_cache
    _graph_cache = None


def _load_radio_graphs() -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, set[str]]]:
    global _graph_cache
    now = time.monotonic()
    if _graph_cache and now - _graph_cache[0] < _GRAPH_CACHE_TTL_SECONDS:
        return _graph_cache[1], _graph_cache[2], _graph_cache[3]

    try:
        sim_graph, genre_map, member_graph = load_artist_radio_graphs()
    except Exception:
        log.warning("Falling back to split radio graph loaders", exc_info=True)
        sim_graph = _load_artist_similarity_graph()
        genre_map = _load_artist_genres()
        member_graph = _load_shared_members_graph()
    _graph_cache = (now, sim_graph, genre_map, member_graph)
    return sim_graph, genre_map, member_graph


def resolve_discovery_seed(user_id: int) -> tuple[list[float], str, dict] | None:
    """Resolve a seed for discovery radio from user behavior."""
    # 1. Recent liked tracks
    liked = get_recent_liked_seed_rows(user_id, limit=10)
    resolved = _seed_result_from_rows(liked, "Your recent likes", minimum=5)
    if resolved:
        return resolved

    # 2. Followed artists
    follows = get_followed_artist_seed_rows(user_id, limit=30)
    resolved = _seed_result_from_rows(follows, "Artists you follow", minimum=5)
    if resolved:
        return resolved

    # 2b. Saved albums
    saved = get_saved_album_seed_rows(user_id, limit=30)
    resolved = _seed_result_from_rows(saved, "Your saved albums", minimum=5)
    if resolved:
        return resolved

    # 3. Recent plays
    plays = get_recent_play_seed_rows(user_id, limit=20)
    resolved = _seed_result_from_rows(plays, "Your recent plays", minimum=10)
    if resolved:
        return resolved

    # 4. Library mix (fallback)
    trending = get_random_library_seed_rows(limit=30)
    resolved = _seed_result_from_rows(trending, "Library mix")
    if resolved:
        return resolved

    return None


def has_enough_data(user_id: int) -> bool:
    """Check if a user has enough data for discovery radio."""
    counts = count_user_radio_signals(user_id)
    return (int(counts["likes"]) >= 3
            or int(counts["follows"]) >= 1
            or int(counts["saved_albums"]) >= 1)


# ── Radio start ───────────────────────────────────────────────────


def _resolve_seed(user_id: int, seed_type: str, seed_value: str) -> tuple[list[float], str, dict] | None:
    if seed_type == "track":
        return get_track_seed_context(seed_value)

    if seed_type == "playlist":
        try:
            playlist_id = int(seed_value)
        except (TypeError, ValueError):
            return None
        resolved = get_playlist_seed_context(playlist_id)
        if not resolved:
            return None
        vectors, label, context = resolved
        return _centroid(vectors), label, context

    if seed_type == "home-playlist":
        resolved = get_home_playlist_seed_context(user_id, seed_value)
        if not resolved:
            return None
        vectors, label, context = resolved
        return _centroid(vectors), label, context

    seed_vec = resolve_bliss_centroid(seed_type, seed_value)
    if not seed_vec:
        return None
    seed_label = resolve_endpoint_label(seed_type, seed_value)
    return seed_vec, seed_label, _context_for_seed(seed_type, seed_value, seed_label)


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
        seed_vec, seed_label, seed_context = resolved_seed
    elif mode == "discovery":
        result = resolve_discovery_seed(user_id)
        if not result:
            return None
        seed_vec, seed_label, seed_context = result
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
        "seed_vector": seed_vec,
        "seed_artists": seed_context.get("seed_artists") or [],
        "seed_genres": seed_context.get("seed_genres") or [],
        "seed_track_ids": seed_context.get("seed_track_ids") or [],
        "initial_target": initial_target,
        "current_target": initial_target,
        "liked_vectors": [],
        "disliked_vectors": hist_disliked[:10],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
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


def _too_close_to_disliked(candidate: dict, disliked_vecs: list[list[float]]) -> bool:
    cand_vec = candidate.get("bliss_vector") or []
    if not cand_vec or not disliked_vecs:
        return False
    for disliked_vec in disliked_vecs:
        if not disliked_vec or len(disliked_vec) != len(cand_vec):
            continue
        distance = sum((cand_vec[d] - disliked_vec[d]) ** 2 for d in range(len(cand_vec))) ** 0.5
        if distance < _DISLIKE_PENALTY_RADIUS:
            return True
    return False


def _recent_track_context(candidate: dict) -> dict:
    return {
        "track_id": candidate.get("id"),
        "artist": candidate.get("artist"),
        "title": candidate.get("title"),
        "bpm": candidate.get("bpm"),
        "audio_key": candidate.get("audio_key"),
        "audio_scale": candidate.get("audio_scale"),
        "energy": candidate.get("energy"),
        "year": candidate.get("year"),
    }


def _db_exclude_ids(used_track_ids: list[int]) -> set[int]:
    return set(used_track_ids[-_DB_EXCLUDE_ID_LIMIT:])


def _generate_batch(session: dict, count: int = _BATCH_SIZE) -> list[dict]:
    """Generate a batch of tracks for the radio session."""
    sim_graph, genre_map, member_graph = _load_radio_graphs()

    target = session["current_target"]
    used_track_ids = list(session["used_track_ids"])
    used_ids = set(used_track_ids)
    used_titles = set(session["used_titles"])
    recent_artists = list(session["recent_artists"])
    recent_tracks = list(session.get("recent_tracks") or [])
    disliked_vecs = session["disliked_vectors"]

    target_artists = list(session.get("seed_artists") or [])
    if not target_artists and session.get("seed_type") == "artist":
        target_artists = [session["seed_label"]]
    seed_genres = [genre for genre in (session.get("seed_genres") or []) if genre]
    if seed_genres:
        genre_map = dict(genre_map)
        genre_context_key = "__radio_seed_genres__"
        genre_map[genre_context_key] = {genre: 1.0 for genre in seed_genres}
        target_artists.append(genre_context_key)

    tracks: list[dict] = []
    max_attempts = max(count + 5, count * _MAX_GENERATION_ATTEMPT_MULTIPLIER)
    attempts = 0

    while len(tracks) < count and attempts < max_attempts:
        attempts += 1
        import random
        drift = [target[d] + random.gauss(0, 0.02) for d in range(len(target))]

        candidate = _find_best_candidate(
            drift, _db_exclude_ids(used_track_ids), used_titles, recent_artists,
            sim_graph, genre_map, member_graph, target_artists,
            artist_affinity=_artist_affinity,
            genre_overlap=_genre_overlap,
            candidate_pool_size=_RADIO_CANDIDATE_POOL_SIZE,
            recent_tracks=recent_tracks,
        )

        if not candidate:
            break

        if _too_close_to_disliked(candidate, disliked_vecs):
            disliked_id = candidate["id"]
            if disliked_id not in used_ids:
                used_ids.add(disliked_id)
                used_track_ids.append(disliked_id)
            continue

        track_id = candidate["id"]
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        if track_id not in used_ids:
            used_ids.add(track_id)
            used_track_ids.append(track_id)
        used_titles.add(title_key)
        recent_artists.append(artist)
        if len(recent_artists) > 3:
            recent_artists.pop(0)
        recent_tracks.append(_recent_track_context(candidate))
        if len(recent_tracks) > 5:
            recent_tracks.pop(0)

        cand_vec = candidate.get("bliss_vector")
        if cand_vec:
            target = _lerp(target, cand_vec, 0.15)
            seed_vector = session.get("seed_vector")
            if seed_vector:
                target = _lerp(target, seed_vector, _SEED_ANCHOR_BLEND)

        tracks.append({
            "track_id": track_id,
            "entity_uid": str(candidate["entity_uid"]) if candidate.get("entity_uid") else None,
            "title": title,
            "artist": artist,
            "album": candidate.get("album"),
            "album_id": candidate.get("album_id"),
            "bpm": candidate.get("bpm"),
            "audio_key": candidate.get("audio_key"),
            "audio_scale": candidate.get("audio_scale"),
            "energy": candidate.get("energy"),
            "danceability": candidate.get("danceability"),
            "valence": candidate.get("valence"),
            "duration": candidate.get("duration"),
            "year": candidate.get("year"),
            "bliss_vector": list(cand_vec) if cand_vec else None,
            "distance": round(candidate["distance"], 6),
        })

    # Update session state
    session["used_track_ids"] = used_track_ids
    session["used_titles"] = list(used_titles)
    session["recent_artists"] = recent_artists
    session["recent_tracks"] = recent_tracks[-5:]
    session["current_target"] = target

    return tracks
