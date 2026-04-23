"""Music Paths — acoustic route planning through bliss vector space."""

import logging
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
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


def _array_distance_sql(vector_expr: str) -> str:
    """Return SQL for L2 distance between a bliss array column and a probe array."""
    return f"""
        SQRT(COALESCE((
            SELECT SUM(POWER(tv.val - pv.val, 2))
            FROM UNNEST({vector_expr}) WITH ORDINALITY AS tv(val, idx)
            JOIN UNNEST(CAST(:probe_array AS double precision[])) WITH ORDINALITY AS pv(val, idx)
              USING (idx)
        ), 0.0))
    """


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
                text("SELECT name, artist FROM library_albums WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['name']} — {row['artist']}" if row else value

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


_MAX_CONSECUTIVE_SAME_ARTIST = 2
_ARTIST_REPEAT_PENALTY = 2.0
_CANDIDATE_POOL_SIZE = 15

# Scoring weights for hybrid distance
_W_BLISS = 0.40
_W_ARTIST_AFFINITY = 0.35
_W_GENRE_OVERLAP = 0.25


# ── Affinity caches (loaded once per path computation) ─────────

def _load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    """Load the full artist similarity graph into memory.
    Returns {artist_name_lower: {similar_name_lower: score}}."""
    graph: dict[str, dict[str, float]] = {}
    with read_scope() as session:
        rows = session.execute(
            text("SELECT artist_name, similar_name, score FROM artist_similarities")
        ).mappings().all()
    for r in rows:
        a = r["artist_name"].lower()
        s = r["similar_name"].lower()
        score = float(r["score"])
        graph.setdefault(a, {})[s] = score
        # Make bidirectional (if A→B exists, B→A should too)
        graph.setdefault(s, {})[a] = score
    return graph


def _load_shared_members_graph() -> dict[str, set[str]]:
    """Build a graph of artists connected by shared band members.
    Returns {artist_name_lower: {connected_artist_name_lower, ...}}."""
    # First, build member→bands mapping
    member_to_bands: dict[str, list[str]] = {}
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT a.name AS artist, m->>'name' AS member
                FROM library_artists a, jsonb_array_elements(a.members_json) AS m
                WHERE a.members_json IS NOT NULL
                  AND a.members_json != 'null'
                  AND a.members_json != '[]'
            """)
        ).mappings().all()
    for r in rows:
        member = r["member"].lower().strip()
        artist = r["artist"].lower().strip()
        member_to_bands.setdefault(member, []).append(artist)

    # Now build artist→artist connections via shared members
    graph: dict[str, set[str]] = {}
    for member, bands in member_to_bands.items():
        if len(bands) < 2:
            continue
        for i, a in enumerate(bands):
            for b in bands[i + 1:]:
                if a != b:
                    graph.setdefault(a, set()).add(b)
                    graph.setdefault(b, set()).add(a)

    log.info("Shared members graph: %d artists connected", len(graph))
    return graph


def _load_artist_genres() -> dict[str, dict[str, float]]:
    """Load genre weights per artist.
    Returns {artist_name_lower: {genre_name_lower: weight}}."""
    result: dict[str, dict[str, float]] = {}
    with read_scope() as session:
        rows = session.execute(
            text("""
                SELECT ag.artist_name, g.name, ag.weight
                FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
            """)
        ).mappings().all()
    for r in rows:
        a = r["artist_name"].lower()
        g = r["name"].lower()
        result.setdefault(a, {})[g] = float(r["weight"])
    return result


def _artist_affinity(
    candidate_artist: str,
    context_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
) -> float:
    """How connected is candidate_artist to the recent context artists?
    Returns 0.0 (no connection) to 1.0 (direct strong match).

    Signals (strongest first):
    1. Shared band member (0.95) — same person played in both bands
    2. Direct Last.fm similarity (up to 1.0)
    3. 2nd degree similarity (shared similar artists, discounted 50%)
    """
    c = candidate_artist.lower()
    if not context_artists:
        return 0.0

    best = 0.0
    for ctx in context_artists:
        ctx_l = ctx.lower()

        # Shared band member — strongest signal
        member_connections = member_graph.get(ctx_l, set())
        if c in member_connections:
            return 0.95  # almost certain match, return immediately

        # Direct Last.fm similarity
        direct = sim_graph.get(ctx_l, {}).get(c, 0.0)
        if direct > best:
            best = direct

        # 2nd degree: shared similar artists
        if best < 0.5:
            ctx_sims = sim_graph.get(ctx_l, {})
            cand_sims = sim_graph.get(c, {})
            shared = set(ctx_sims.keys()) & set(cand_sims.keys())
            if shared:
                second = max(
                    min(ctx_sims[s], cand_sims[s]) for s in shared
                ) * 0.5
                if second > best:
                    best = second

    return min(best, 1.0)


def _genre_overlap(
    candidate_artist: str,
    target_artists: list[str],
    genre_map: dict[str, dict[str, float]],
) -> float:
    """Weighted Jaccard-like genre overlap between candidate and target artists.
    Returns 0.0 (no overlap) to 1.0 (identical genre profile)."""
    c_genres = genre_map.get(candidate_artist.lower(), {})
    if not c_genres or not target_artists:
        return 0.0

    best = 0.0
    for ta in target_artists:
        t_genres = genre_map.get(ta.lower(), {})
        if not t_genres:
            continue
        shared_keys = set(c_genres.keys()) & set(t_genres.keys())
        if not shared_keys:
            continue
        intersection = sum(min(c_genres[k], t_genres[k]) for k in shared_keys)
        union = sum(max(c_genres.get(k, 0), t_genres.get(k, 0))
                    for k in set(c_genres.keys()) | set(t_genres.keys()))
        jaccard = intersection / union if union > 0 else 0.0
        if jaccard > best:
            best = jaccard
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
    """Compute a music path through bliss vector space.

    Rules:
    1. First track MUST belong to the origin (artist/album/genre)
    2. Last track MUST belong to the destination
    3. No duplicate titles from the same artist (filters live/remix variants)
    4. Max 2 consecutive tracks from the same artist
    5. Blends previous track's actual vector with the lerp target for
       smoother transitions
    """
    # Load affinity data once for the entire path computation
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

    # Build target artist list for genre overlap (origin + destination)
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)
    segment_target_artists = [origin_label, dest_label]

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

    # ── Step 0: anchor to origin ──
    first = _find_anchor_track(origin_type, origin_value, origin_vec, set())
    if first:
        path_tracks.append(_make_entry(first, 0, 0.0))
        last_actual_vec = list(first["bliss_vector"]) if first.get("bliss_vector") else origin_vec
    else:
        last_actual_vec = origin_vec

    # ── Steps 1..N-2: interpolation ──
    global_step = 1
    for seg_idx in range(num_segments):
        seg_start = chain[seg_idx]
        seg_end = chain[seg_idx + 1]
        seg_steps = steps_per_segment if seg_idx < num_segments - 1 else inner_steps - (global_step - 1)

        for local_step in range(seg_steps):
            t = (local_step + 1) / (seg_steps + 1)  # avoid 0.0 and 1.0 (those are anchors)
            lerp_target = _lerp(seg_start, seg_end, t)

            # Blend with last actual vector for smoother flow
            search_target = _lerp(last_actual_vec, lerp_target, 0.55)
            global_progress = global_step / max(1, step_count - 1)

            track = _find_best_candidate(
                search_target, used_ids, used_titles, recent_artists,
                sim_graph, genre_map, member_graph, segment_target_artists,
            )
            if track:
                path_tracks.append(_make_entry(track, global_step, global_progress))
                last_actual_vec = list(track["bliss_vector"]) if track.get("bliss_vector") else last_actual_vec

            global_step += 1

    # ── Last step: anchor to destination ──
    last = _find_anchor_track(dest_type, dest_value, dest_vec, used_ids)
    if last:
        path_tracks.append(_make_entry(last, step_count - 1, 1.0))

    return path_tracks


def _find_anchor_track(
    endpoint_type: str, endpoint_value: str,
    target_vec: list[float], exclude: set[int],
) -> dict | None:
    """Find the best track that belongs to the endpoint (artist/album/genre).

    For track endpoints, returns that specific track.
    For artist/album/genre, finds the closest track within that scope.
    """
    probe_vector = to_pgvector_literal(target_vec)
    probe_array = list(target_vec)
    exclude_clause = "AND t.id != ALL(:exclude)" if exclude else ""
    params: dict = {"probe_vector": probe_vector, "probe_array": probe_array}
    if exclude:
        params["exclude"] = list(exclude)

    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("""
                    SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                           t.album_id, t.bliss_vector, 0.0 AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.id = :track_id AND t.bliss_vector IS NOT NULL
                """),
                {"track_id": int(endpoint_value)},
            ).mappings().first()
            if row:
                d = dict(row)
                d["bliss_vector"] = list(d["bliss_vector"]) if d.get("bliss_vector") else None
                return d
            return None

        if endpoint_type == "artist":
            scope_clause = "AND a.artist = (SELECT name FROM library_artists WHERE id = :scope_id)"
            params["scope_id"] = int(endpoint_value)
        elif endpoint_type == "album":
            scope_clause = "AND t.album_id = :scope_id"
            params["scope_id"] = int(endpoint_value)
        elif endpoint_type == "genre":
            scope_clause = """AND a.artist IN (
                SELECT ag.artist_name FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE g.slug = :scope_slug
            )"""
            params["scope_slug"] = endpoint_value
        else:
            scope_clause = ""

        row = session.execute(
            text(f"""
                SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                       t.album_id, t.bliss_vector,
                       (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_embedding IS NOT NULL
                {scope_clause}
                {exclude_clause}
                ORDER BY t.bliss_embedding <-> CAST(:probe_vector AS vector(20))
                LIMIT 1
            """),
            params,
        ).mappings().first()

        if not row:
            fallback_distance = _array_distance_sql("t.bliss_vector")
            row = session.execute(
                text(f"""
                    SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                           t.album_id, t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.bliss_vector IS NOT NULL
                    {scope_clause}
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT 1
                """),
                params,
            ).mappings().first()

    if not row:
        return None
    d = dict(row)
    d["bliss_vector"] = list(d["bliss_vector"]) if d.get("bliss_vector") else None
    return d


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
    """Find the best track near target using hybrid scoring.

    Score = bliss_distance × 0.4 + (1 - artist_affinity) × 0.35 + (1 - genre_overlap) × 0.25

    - Fetches a pool of candidates by bliss proximity
    - Skips title+artist dupes (live/remix variants)
    - Hard-blocks >2 consecutive same-artist tracks
    - Boosts tracks from artists in the similarity graph neighborhood
    - Boosts tracks from artists sharing genres with the path context
    """
    probe_vector = to_pgvector_literal(target)
    probe_array = list(target)

    exclude_clause = ""
    params: dict = {"probe_vector": probe_vector, "probe_array": probe_array}
    if exclude_ids:
        exclude_clause = "AND t.id != ALL(:exclude)"
        params["exclude"] = list(exclude_ids)

    with read_scope() as session:
        rows = session.execute(
            text(f"""
                SELECT t.id, t.storage_id, t.title, a.artist,
                       a.name AS album, t.album_id, t.bliss_vector,
                       (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_embedding IS NOT NULL
                {exclude_clause}
                ORDER BY t.bliss_embedding <-> CAST(:probe_vector AS vector(20))
                LIMIT {_CANDIDATE_POOL_SIZE}
            """),
            params,
        ).mappings().all()

        if not rows:
            fallback_distance = _array_distance_sql("t.bliss_vector")
            rows = session.execute(
                text(f"""
                    SELECT t.id, t.storage_id, t.title, a.artist,
                           a.name AS album, t.album_id, t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.bliss_vector IS NOT NULL
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT {_CANDIDATE_POOL_SIZE}
                """),
                params,
            ).mappings().all()

    if not rows:
        return None

    # Normalize bliss distances to 0-1 range for fair weighting
    max_dist = max(float(r["distance"]) for r in rows) or 1.0

    best: dict | None = None
    best_score = float("inf")

    for row in rows:
        candidate = dict(row)
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        if title_key in exclude_titles:
            continue

        # Hard block consecutive same-artist
        if recent_artists:
            consecutive = sum(1 for a in reversed(recent_artists) if a == artist)
            if consecutive >= _MAX_CONSECUTIVE_SAME_ARTIST:
                continue

        # Hybrid scoring
        bliss_norm = float(candidate["distance"]) / max_dist

        affinity = _artist_affinity(artist, recent_artists + target_artists, sim_graph, member_graph)
        genre_ov = _genre_overlap(artist, target_artists, genre_map)

        score = (
            _W_BLISS * bliss_norm
            + _W_ARTIST_AFFINITY * (1.0 - affinity)
            + _W_GENRE_OVERLAP * (1.0 - genre_ov)
        )

        # Additional penalty for recent artist repeat (softer than before)
        if artist in [a for a in recent_artists[-2:]]:
            score *= _ARTIST_REPEAT_PENALTY

        if score < best_score:
            best_score = score
            best = candidate

    if best:
        best["bliss_vector"] = list(best["bliss_vector"]) if best.get("bliss_vector") else None

    return best


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

    tracks = compute_path(origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec, step_count, waypoint_vecs or None)

    import json
    with transaction_scope() as session:
        row = session.execute(
            text("""
                INSERT INTO music_paths
                    (user_id, name, origin_type, origin_value, origin_label,
                     dest_type, dest_value, dest_label, waypoints, step_count, tracks)
                VALUES
                    (:user_id, :name, :origin_type, :origin_value, :origin_label,
                     :dest_type, :dest_value, :dest_label, CAST(:waypoints AS jsonb), :step_count, CAST(:tracks AS jsonb))
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

    origin_type = path["origin"]["type"]
    origin_value = path["origin"]["value"]
    dest_type = path["destination"]["type"]
    dest_value = path["destination"]["value"]

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs = []
    for wp in path["waypoints"]:
        wp_vec = resolve_bliss_centroid(wp["type"], wp["value"])
        if wp_vec:
            waypoint_vecs.append(wp_vec)

    tracks = compute_path(origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec, path["step_count"], waypoint_vecs or None)

    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE music_paths
                SET tracks = CAST(:tracks AS jsonb), updated_at = :now
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

    tracks = compute_path(origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec, step_count, waypoint_vecs or None)

    return {
        "name": f"{origin_label} → {dest_label}",
        "origin": {"type": origin_type, "value": origin_value, "label": origin_label},
        "destination": {"type": dest_type, "value": dest_value, "label": dest_label},
        "waypoints": resolved_waypoints,
        "step_count": step_count,
        "tracks": tracks,
    }
