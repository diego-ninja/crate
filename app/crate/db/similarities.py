from datetime import datetime, timezone

from crate.db.core import get_db_ctx


def upsert_similarity(artist_name: str, similar_name: str, score: float, source: str = "lastfm") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO artist_similarities (artist_name, similar_name, score, source, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (artist_name, similar_name) DO UPDATE SET
                score = EXCLUDED.score,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
        """, (artist_name, similar_name, score, source, now))


def bulk_upsert_similarities(artist_name: str, similarities: list[dict]) -> None:
    """Batch upsert similar artists for a given artist.

    Each dict in similarities must have 'name' and optionally 'score' and 'source'.
    """
    if not similarities:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        (artist_name, s["name"], float(s.get("score") or s.get("match") or 0.0), s.get("source", "lastfm"), now)
        for s in similarities
        if s.get("name")
    ]
    if not rows:
        return
    with get_db_ctx() as cur:
        cur.executemany("""
            INSERT INTO artist_similarities (artist_name, similar_name, score, source, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (artist_name, similar_name) DO UPDATE SET
                score = EXCLUDED.score,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
        """, rows)


def get_similar_artists(artist_name: str, limit: int = 30) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT similar_name, score, source, in_library
            FROM artist_similarities
            WHERE artist_name = %s
            ORDER BY score DESC
            LIMIT %s
        """, (artist_name, limit))
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_artist_network(artist_name: str, depth: int = 2, limit_per_level: int = 15) -> dict:
    """Return {nodes, links} for ForceGraph2D.

    depth=1: center + direct similar
    depth=2: center + direct similar + similar-of-similar
    """
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    seen_links: set[tuple[str, str]] = set()

    nodes[artist_name] = {"id": artist_name, "group": 0, "in_library": True, "score": 1.0}

    with get_db_ctx() as cur:
        # Level 1: direct similar
        cur.execute("""
            SELECT similar_name, score, in_library
            FROM artist_similarities
            WHERE artist_name = %s
            ORDER BY score DESC
            LIMIT %s
        """, (artist_name, limit_per_level))
        level1 = cur.fetchall()

    level1_names: list[str] = []
    for row in level1:
        name = row["similar_name"]
        if name not in nodes:
            nodes[name] = {"id": name, "group": 1, "in_library": bool(row["in_library"]), "score": float(row["score"])}
        level1_names.append(name)
        key = (min(artist_name, name), max(artist_name, name))
        if key not in seen_links:
            seen_links.add(key)
            links.append({"source": artist_name, "target": name, "value": float(row["score"])})

    if depth >= 2 and level1_names:
        with get_db_ctx() as cur:
            placeholders = ",".join(["%s"] * len(level1_names))
            cur.execute(f"""
                SELECT artist_name, similar_name, score, in_library
                FROM artist_similarities
                WHERE artist_name IN ({placeholders})
                ORDER BY score DESC
            """, level1_names)
            level2_rows = cur.fetchall()

        # Track how many depth-2 nodes per level-1 parent to respect limit
        per_parent: dict[str, int] = {}
        for row in level2_rows:
            parent = row["artist_name"]
            name = row["similar_name"]
            if name == artist_name:
                continue

            # Cross-link between two level-1 nodes (both already in graph)
            if name in nodes:
                key = (min(parent, name), max(parent, name))
                if key not in seen_links:
                    seen_links.add(key)
                    links.append({"source": parent, "target": name, "value": float(row["score"])})
                continue

            # New depth-2 node
            count = per_parent.get(parent, 0)
            if count >= limit_per_level:
                continue
            per_parent[parent] = count + 1
            nodes[name] = {"id": name, "group": 2, "in_library": bool(row["in_library"]), "score": float(row["score"])}
            key = (min(parent, name), max(parent, name))
            if key not in seen_links:
                seen_links.add(key)
                links.append({"source": parent, "target": name, "value": float(row["score"])})

    return {"nodes": list(nodes.values()), "links": links}


def mark_library_status() -> int:
    """Update in_library flag based on current library_artists table. Returns updated row count."""
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE artist_similarities
            SET in_library = EXISTS (
                SELECT 1 FROM library_artists
                WHERE LOWER(name) = LOWER(artist_similarities.similar_name)
            )
        """)
        return cur.rowcount
