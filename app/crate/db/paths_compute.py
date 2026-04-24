"""Music Paths computation and scoring primitives."""

from __future__ import annotations

import logging

from crate.db.queries.paths import (
    fetch_bliss_vectors_for_endpoint,
    find_anchor_track_row,
    find_candidate_rows,
    load_artist_genres,
    load_artist_similarity_graph,
    load_shared_members_graph,
    resolve_endpoint_label as _resolve_endpoint_label,
)

log = logging.getLogger(__name__)

_MAX_CONSECUTIVE_SAME_ARTIST = 2
_ARTIST_REPEAT_PENALTY = 2.0
_CANDIDATE_POOL_SIZE = 15

_W_BLISS = 0.40
_W_ARTIST_AFFINITY = 0.35
_W_GENRE_OVERLAP = 0.25


def _centroid(vectors: list[list[float]]) -> list[float]:
    """Average of N bliss vectors (element-wise mean)."""
    if not vectors:
        return []
    n = len(vectors)
    dims = len(vectors[0])
    return [sum(v[d] for v in vectors) / n for d in range(dims)]


def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    """Linear interpolation between two vectors. t=0 -> a, t=1 -> b."""
    return [a[d] + (b[d] - a[d]) * t for d in range(len(a))]


def resolve_bliss_centroid(endpoint_type: str, value: str) -> list[float] | None:
    """Resolve an endpoint (track/album/artist/genre) to a bliss centroid vector."""
    log.info("resolve_bliss_centroid: type=%s value=%s", endpoint_type, value)
    vectors = fetch_bliss_vectors_for_endpoint(endpoint_type, value)
    if endpoint_type == "artist":
        log.info("resolve artist id=%s: found %d vectors", value, len(vectors))
    return _centroid(vectors) if vectors else None


def resolve_endpoint_label(endpoint_type: str, value: str) -> str:
    return _resolve_endpoint_label(endpoint_type, value)


def _load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    return load_artist_similarity_graph()


def _load_shared_members_graph() -> dict[str, set[str]]:
    graph = load_shared_members_graph()
    log.info("Shared members graph: %d artists connected", len(graph))
    return graph


def _load_artist_genres() -> dict[str, dict[str, float]]:
    return load_artist_genres()


def _artist_affinity(
    candidate_artist: str,
    context_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
) -> float:
    """Return how connected ``candidate_artist`` is to the recent context artists."""
    candidate_lower = candidate_artist.lower()
    if not context_artists:
        return 0.0

    best = 0.0
    for context_artist in context_artists:
        context_lower = context_artist.lower()

        if candidate_lower in member_graph.get(context_lower, set()):
            return 0.95

        direct = sim_graph.get(context_lower, {}).get(candidate_lower, 0.0)
        if direct > best:
            best = direct

        if best < 0.5:
            context_sims = sim_graph.get(context_lower, {})
            candidate_sims = sim_graph.get(candidate_lower, {})
            shared = set(context_sims.keys()) & set(candidate_sims.keys())
            if shared:
                second_degree = max(min(context_sims[item], candidate_sims[item]) for item in shared) * 0.5
                if second_degree > best:
                    best = second_degree

    return min(best, 1.0)


def _genre_overlap(
    candidate_artist: str,
    target_artists: list[str],
    genre_map: dict[str, dict[str, float]],
) -> float:
    """Weighted Jaccard-like genre overlap between candidate and target artists."""
    candidate_genres = genre_map.get(candidate_artist.lower(), {})
    if not candidate_genres or not target_artists:
        return 0.0

    best = 0.0
    for target_artist in target_artists:
        target_genres = genre_map.get(target_artist.lower(), {})
        if not target_genres:
            continue
        shared_keys = set(candidate_genres.keys()) & set(target_genres.keys())
        if not shared_keys:
            continue
        intersection = sum(min(candidate_genres[key], target_genres[key]) for key in shared_keys)
        union = sum(
            max(candidate_genres.get(key, 0), target_genres.get(key, 0))
            for key in set(candidate_genres.keys()) | set(target_genres.keys())
        )
        jaccard = intersection / union if union > 0 else 0.0
        if jaccard > best:
            best = jaccard
    return best


def _find_anchor_track(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
) -> dict | None:
    """Find the best track that belongs to the endpoint (artist/album/genre)."""
    return find_anchor_track_row(endpoint_type, endpoint_value, target_vec, exclude)


def _find_best_candidate(
    target: list[float],
    exclude_ids: set[int],
    exclude_titles: set[str],
    recent_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
    target_artists: list[str],
) -> dict | None:
    """Find the best track near ``target`` using hybrid bliss/affinity scoring."""
    rows = find_candidate_rows(target, exclude_ids, limit=_CANDIDATE_POOL_SIZE)
    if not rows:
        return None

    max_dist = max(float(row["distance"]) for row in rows) or 1.0
    best: dict | None = None
    best_score = float("inf")

    for row in rows:
        candidate = dict(row)
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        if title_key in exclude_titles:
            continue

        if recent_artists:
            consecutive = sum(1 for recent_artist in reversed(recent_artists) if recent_artist == artist)
            if consecutive >= _MAX_CONSECUTIVE_SAME_ARTIST:
                continue

        bliss_norm = float(candidate["distance"]) / max_dist
        affinity = _artist_affinity(artist, recent_artists + target_artists, sim_graph, member_graph)
        genre_overlap = _genre_overlap(artist, target_artists, genre_map)

        score = (
            _W_BLISS * bliss_norm
            + _W_ARTIST_AFFINITY * (1.0 - affinity)
            + _W_GENRE_OVERLAP * (1.0 - genre_overlap)
        )

        if artist in [recent_artist for recent_artist in recent_artists[-2:]]:
            score *= _ARTIST_REPEAT_PENALTY

        if score < best_score:
            best_score = score
            best = candidate

    if best:
        best["bliss_vector"] = list(best["bliss_vector"]) if best.get("bliss_vector") else None

    return best


def compute_path(
    origin_type: str,
    origin_value: str,
    origin_vec: list[float],
    dest_type: str,
    dest_value: str,
    dest_vec: list[float],
    step_count: int = 20,
    waypoint_vecs: list[list[float]] | None = None,
) -> list[dict]:
    """Compute a music path through bliss vector space."""
    sim_graph = _load_artist_similarity_graph()
    genre_map = _load_artist_genres()
    member_graph = _load_shared_members_graph()

    chain = [origin_vec]
    if waypoint_vecs:
        chain.extend(waypoint_vecs)
    chain.append(dest_vec)

    num_segments = len(chain) - 1
    inner_steps = max(1, step_count - 2)
    steps_per_segment = max(1, inner_steps // num_segments)

    used_ids: set[int] = set()
    used_titles: set[str] = set()
    recent_artists: list[str] = []

    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)
    target_artists = [origin_label, dest_label]

    def _make_entry(track: dict, step: int, progress: float) -> dict:
        title_key = f"{track['artist']}::{track['title']}"
        used_ids.add(track["id"])
        used_titles.add(title_key.lower())
        recent_artists.append(track["artist"])
        if len(recent_artists) > 3:
            recent_artists.pop(0)
        return {
            "step": step,
            "progress": round(progress, 4),
            "track_id": track["id"],
            "storage_id": str(track["storage_id"]) if track.get("storage_id") else None,
            "title": track["title"],
            "artist": track["artist"],
            "album": track.get("album"),
            "album_id": track.get("album_id"),
            "distance": round(track["distance"], 6),
        }

    path_tracks: list[dict] = []
    first = _find_anchor_track(origin_type, origin_value, origin_vec, set())
    if first:
        path_tracks.append(_make_entry(first, 0, 0.0))
        last_actual_vec = list(first["bliss_vector"]) if first.get("bliss_vector") else origin_vec
    else:
        last_actual_vec = origin_vec

    global_step = 1
    for segment_index in range(num_segments):
        segment_start = chain[segment_index]
        segment_end = chain[segment_index + 1]
        segment_steps = (
            steps_per_segment if segment_index < num_segments - 1 else inner_steps - (global_step - 1)
        )

        for local_step in range(segment_steps):
            t = (local_step + 1) / (segment_steps + 1)
            lerp_target = _lerp(segment_start, segment_end, t)
            search_target = _lerp(last_actual_vec, lerp_target, 0.55)
            global_progress = global_step / max(1, step_count - 1)

            track = _find_best_candidate(
                search_target,
                used_ids,
                used_titles,
                recent_artists,
                sim_graph,
                genre_map,
                member_graph,
                target_artists,
            )
            if track:
                path_tracks.append(_make_entry(track, global_step, global_progress))
                last_actual_vec = list(track["bliss_vector"]) if track.get("bliss_vector") else last_actual_vec

            global_step += 1

    last = _find_anchor_track(dest_type, dest_value, dest_vec, used_ids)
    if last:
        path_tracks.append(_make_entry(last, step_count - 1, 1.0))

    return path_tracks


__all__ = [
    "_centroid",
    "_find_anchor_track",
    "_find_best_candidate",
    "_lerp",
    "_load_artist_genres",
    "_load_artist_similarity_graph",
    "_load_shared_members_graph",
    "compute_path",
    "resolve_bliss_centroid",
    "resolve_endpoint_label",
]
