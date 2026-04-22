"""Music Paths — acoustic route planning through bliss vector space."""

import logging
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope, read_scope

log = logging.getLogger(__name__)


# ── Bliss vector math ──────────────────────────────────────────────


def _centroid(vectors: list[list[float]]) -> list[float]:
    """Average of N bliss vectors (element-wise mean)."""
    if not vectors:
        return []
    n = len(vectors)
    dims = len(vectors[0])
    return [sum(v[d] for v in vectors) / n for d in range(dims)]


def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    """Linear interpolation between two vectors. t=0 → a, t=1 → b."""
    return [a[d] + (b[d] - a[d]) * t for d in range(len(a))]


def _vector_to_pg_array(vec: list[float]) -> str:
    """Format a float list as a PostgreSQL array literal."""
    return "ARRAY[" + ",".join(f"{v:.8f}" for v in vec) + "]::float8[]"


# ── Resolve endpoints to bliss centroids ──────────────────────────


def resolve_bliss_centroid(endpoint_type: str, value: str) -> list[float] | None:
    """Resolve an endpoint (track/album/artist/genre) to a bliss centroid vector."""
    log.info("resolve_bliss_centroid: type=%s value=%s", endpoint_type, value)
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
                {"id": int(value)},
            ).mappings().first()
            return list(row["bliss_vector"]) if row else None

        if endpoint_type == "album":
            rows = session.execute(
                text("""
                    SELECT bliss_vector FROM library_tracks
                    WHERE album_id = :id AND bliss_vector IS NOT NULL
                """),
                {"id": int(value)},
            ).mappings().all()
            vectors = [list(r["bliss_vector"]) for r in rows]
            return _centroid(vectors) if vectors else None

        if endpoint_type == "artist":
            rows = session.execute(
                text("""
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE a.artist = (
                        SELECT name FROM library_artists WHERE id = :id
                    )
                    AND t.bliss_vector IS NOT NULL
                    LIMIT 20
                """),
                {"id": int(value)},
            ).mappings().all()
            vectors = [list(r["bliss_vector"]) for r in rows]
            log.info("resolve artist id=%s: found %d vectors", value, len(vectors))
            return _centroid(vectors) if vectors else None

        if endpoint_type == "genre":
            rows = session.execute(
                text("""
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    JOIN artist_genres ag ON ag.artist_name = a.artist
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug AND t.bliss_vector IS NOT NULL
                    ORDER BY ag.weight DESC
                    LIMIT 30
                """),
                {"slug": value},
            ).mappings().all()
            vectors = [list(r["bliss_vector"]) for r in rows]
            return _centroid(vectors) if vectors else None

    return None


def resolve_endpoint_label(endpoint_type: str, value: str) -> str:
    """Get a human-readable label for an endpoint."""
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT title, artist FROM library_tracks WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['title']} — {row['artist']}" if row else value

        if endpoint_type == "album":
            row = session.execute(
                text("SELECT name, artist_name FROM library_albums WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['name']} — {row['artist_name']}" if row else value

        if endpoint_type == "artist":
            row = session.execute(
                text("SELECT name FROM library_artists WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return row["name"] if row else value

        if endpoint_type == "genre":
            row = session.execute(
                text("SELECT name FROM genres WHERE slug = :slug"),
                {"slug": value},
            ).mappings().first()
            return row["name"] if row else value

    return value


# ── Path computation ──────────────────────────────────────────────


def compute_path(
    origin_vec: list[float],
    dest_vec: list[float],
    step_count: int = 20,
    waypoint_vecs: list[list[float]] | None = None,
) -> list[dict]:
    """Compute a music path by interpolating through bliss vector space.

    Returns a list of track dicts with step, progress, distance, and track metadata.
    """
    # Build segment chain: origin → wp1 → wp2 → ... → dest
    chain = [origin_vec]
    if waypoint_vecs:
        chain.extend(waypoint_vecs)
    chain.append(dest_vec)

    num_segments = len(chain) - 1
    steps_per_segment = max(2, step_count // num_segments)

    used_ids: set[int] = set()
    path_tracks: list[dict] = []
    global_step = 0

    for seg_idx in range(num_segments):
        seg_start = chain[seg_idx]
        seg_end = chain[seg_idx + 1]
        seg_steps = steps_per_segment if seg_idx < num_segments - 1 else step_count - global_step

        for local_step in range(seg_steps):
            t = local_step / max(1, seg_steps - 1)
            target = _lerp(seg_start, seg_end, t)
            global_progress = global_step / max(1, step_count - 1)

            track = _find_nearest_track(target, used_ids)
            if track:
                used_ids.add(track["id"])
                path_tracks.append({
                    "step": global_step,
                    "progress": round(global_progress, 4),
                    "track_id": track["id"],
                    "storage_id": track.get("storage_id"),
                    "title": track["title"],
                    "artist": track["artist"],
                    "album": track.get("album"),
                    "album_id": track.get("album_id"),
                    "distance": round(track["distance"], 6),
                })

            global_step += 1

    return path_tracks


def _find_nearest_track(target: list[float], exclude: set[int]) -> dict | None:
    """Find the track with the closest bliss vector to target, excluding already-used tracks."""
    pg_array = _vector_to_pg_array(target)

    pg_array = _vector_to_pg_array(target)

    exclude_clause = ""
    params: dict = {}
    if exclude:
        exclude_clause = "AND t.id != ALL(:exclude)"
        params["exclude"] = list(exclude)

    with read_scope() as session:
        row = session.execute(
            text(f"""
                SELECT t.id, t.storage_id, t.title, a.artist AS artist,
                       a.name AS album, t.album_id,
                       (t.bliss_vector <-> {pg_array}) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_vector IS NOT NULL
                {exclude_clause}
                ORDER BY t.bliss_vector <-> {pg_array}
                LIMIT 1
            """),
            params,
        ).mappings().first()

    if not row:
        return None
    return dict(row)


# ── CRUD ──────────────────────────────────────────────────────────


def create_music_path(
    user_id: int,
    name: str,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    """Create a music path, compute it, and persist."""
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)

    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs = []
    resolved_waypoints = []
    for wp in (waypoints or []):
        wp_vec = resolve_bliss_centroid(wp["type"], wp["value"])
        if wp_vec:
            waypoint_vecs.append(wp_vec)
            resolved_waypoints.append({
                **wp,
                "label": resolve_endpoint_label(wp["type"], wp["value"]),
            })

    tracks = compute_path(origin_vec, dest_vec, step_count, waypoint_vecs or None)

    import json
    with transaction_scope() as session:
        row = session.execute(
            text("""
                INSERT INTO music_paths
                    (user_id, name, origin_type, origin_value, origin_label,
                     dest_type, dest_value, dest_label, waypoints, step_count, tracks)
                VALUES
                    (:user_id, :name, :origin_type, :origin_value, :origin_label,
                     :dest_type, :dest_value, :dest_label, :waypoints::jsonb, :step_count, :tracks::jsonb)
                RETURNING id, created_at
            """),
            {
                "user_id": user_id,
                "name": name,
                "origin_type": origin_type,
                "origin_value": origin_value,
                "origin_label": origin_label,
                "dest_type": dest_type,
                "dest_value": dest_value,
                "dest_label": dest_label,
                "waypoints": json.dumps(resolved_waypoints),
                "step_count": step_count,
                "tracks": json.dumps(tracks),
            },
        ).mappings().first()

    if not row:
        return None

    return {
        "id": row["id"],
        "name": name,
        "origin": {"type": origin_type, "value": origin_value, "label": origin_label},
        "destination": {"type": dest_type, "value": dest_value, "label": dest_label},
        "waypoints": resolved_waypoints,
        "step_count": step_count,
        "tracks": tracks,
        "created_at": str(row["created_at"]),
    }


def get_music_path(path_id: int, user_id: int) -> dict | None:
    """Get a single music path by ID."""
    import json
    with read_scope() as session:
        row = session.execute(
            text("""
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       tracks, created_at, updated_at
                FROM music_paths
                WHERE id = :id AND user_id = :user_id
            """),
            {"id": path_id, "user_id": user_id},
        ).mappings().first()

    if not row:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "origin": {"type": row["origin_type"], "value": row["origin_value"], "label": row["origin_label"]},
        "destination": {"type": row["dest_type"], "value": row["dest_value"], "label": row["dest_label"]},
        "waypoints": row["waypoints"] or [],
        "step_count": row["step_count"],
        "tracks": row["tracks"] or [],
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def list_music_paths(user_id: int) -> list[dict]:
    """List all paths for a user (without full track lists)."""
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       jsonb_array_length(tracks) AS track_count,
                       created_at, updated_at
                FROM music_paths
                WHERE user_id = :user_id
                ORDER BY created_at DESC
            """),
            {"user_id": user_id},
        ).mappings().all()

    return [
        {
            "id": r["id"],
            "name": r["name"],
            "origin": {"type": r["origin_type"], "value": r["origin_value"], "label": r["origin_label"]},
            "destination": {"type": r["dest_type"], "value": r["dest_value"], "label": r["dest_label"]},
            "waypoints": r["waypoints"] or [],
            "step_count": r["step_count"],
            "track_count": r["track_count"],
            "created_at": str(r["created_at"]),
            "updated_at": str(r["updated_at"]),
        }
        for r in rows
    ]


def delete_music_path(path_id: int, user_id: int) -> bool:
    """Delete a path."""
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM music_paths WHERE id = :id AND user_id = :user_id"),
            {"id": path_id, "user_id": user_id},
        )
        return result.rowcount > 0


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    """Recompute a path with fresh tracks."""
    import json
    path = get_music_path(path_id, user_id)
    if not path:
        return None

    origin_vec = resolve_bliss_centroid(path["origin"]["type"], path["origin"]["value"])
    dest_vec = resolve_bliss_centroid(path["destination"]["type"], path["destination"]["value"])
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs = []
    for wp in path["waypoints"]:
        wp_vec = resolve_bliss_centroid(wp["type"], wp["value"])
        if wp_vec:
            waypoint_vecs.append(wp_vec)

    tracks = compute_path(origin_vec, dest_vec, path["step_count"], waypoint_vecs or None)

    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE music_paths
                SET tracks = :tracks::jsonb, updated_at = :now
                WHERE id = :id AND user_id = :user_id
            """),
            {
                "id": path_id,
                "user_id": user_id,
                "tracks": json.dumps(tracks),
                "now": datetime.now(timezone.utc),
            },
        )

    path["tracks"] = tracks
    return path


def preview_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    """Compute a path without persisting. Returns the same shape as create."""
    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    waypoint_vecs = []
    resolved_waypoints = []
    for wp in (waypoints or []):
        wp_vec = resolve_bliss_centroid(wp["type"], wp["value"])
        if wp_vec:
            waypoint_vecs.append(wp_vec)
            resolved_waypoints.append({
                **wp,
                "label": resolve_endpoint_label(wp["type"], wp["value"]),
            })

    tracks = compute_path(origin_vec, dest_vec, step_count, waypoint_vecs or None)

    return {
        "name": f"{origin_label} → {dest_label}",
        "origin": {"type": origin_type, "value": origin_value, "label": origin_label},
        "destination": {"type": dest_type, "value": dest_value, "label": dest_label},
        "waypoints": resolved_waypoints,
        "step_count": step_count,
        "tracks": tracks,
    }
