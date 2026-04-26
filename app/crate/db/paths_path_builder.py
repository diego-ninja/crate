"""Path-building helpers for Music Paths."""

from __future__ import annotations

from crate.db.paths_candidates import _find_anchor_track, _find_best_candidate
from crate.db.paths_similarity import (
    _artist_affinity,
    _genre_overlap,
    _load_artist_genres,
    _load_artist_similarity_graph,
    _load_shared_members_graph,
)
from crate.db.paths_vectors import _lerp, resolve_endpoint_label


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

    def make_entry(track: dict, step: int, progress: float) -> dict:
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
        path_tracks.append(make_entry(first, 0, 0.0))
        last_actual_vec = list(first["bliss_vector"]) if first.get("bliss_vector") else origin_vec
    else:
        last_actual_vec = origin_vec

    global_step = 1
    for segment_index in range(num_segments):
        segment_start = chain[segment_index]
        segment_end = chain[segment_index + 1]
        segment_steps = steps_per_segment if segment_index < num_segments - 1 else inner_steps - (global_step - 1)

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
                artist_affinity=_artist_affinity,
                genre_overlap=_genre_overlap,
            )
            if track:
                path_tracks.append(make_entry(track, global_step, global_progress))
                last_actual_vec = list(track["bliss_vector"]) if track.get("bliss_vector") else last_actual_vec

            global_step += 1

    last = _find_anchor_track(dest_type, dest_value, dest_vec, used_ids)
    if last:
        path_tracks.append(make_entry(last, step_count - 1, 1.0))

    return path_tracks


__all__ = ["compute_path"]
