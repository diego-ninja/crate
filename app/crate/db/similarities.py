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
    # Use lowercase keys for dedup, preserve original casing in id
    nodes: dict[str, dict] = {}  # key = lowercase name
    links: list[dict] = []
    seen_links: set[tuple[str, str]] = set()

    def _key(name: str) -> str:
        return name.lower()

    def _link_key(a: str, b: str) -> tuple[str, str]:
        la, lb = _key(a), _key(b)
        return (min(la, lb), max(la, lb))

    nodes[_key(artist_name)] = {"id": artist_name, "group": 0, "in_library": True, "score": 1.0}

    with get_db_ctx() as cur:
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
        nk = _key(name)
        if nk not in nodes:
            nodes[nk] = {"id": name, "group": 1, "in_library": bool(row["in_library"]), "score": float(row["score"])}
        level1_names.append(name)
        key = _link_key(artist_name, name)
        if key not in seen_links:
            seen_links.add(key)
            links.append({"source": artist_name, "target": name, "value": float(row["score"])})

    if depth >= 2 and level1_names:
        with get_db_ctx() as cur:
            placeholders = ",".join(["%s"] * len(level1_names))
            # Forward: level1 artists as source
            # Reverse: level1 artists as target (bidirectional)
            # Cross-links: any connection between two level1 nodes
            cur.execute(f"""
                SELECT artist_name, similar_name, score, in_library
                FROM artist_similarities
                WHERE artist_name IN ({placeholders})
                   OR similar_name IN ({placeholders})
                ORDER BY score DESC
            """, level1_names + level1_names)
            level2_rows = cur.fetchall()

        # Process level-2 rows (forward + reverse) — all lookups case-insensitive
        per_parent: dict[str, int] = {}
        for row in level2_rows:
            src = row["artist_name"]
            dst = row["similar_name"]
            score = float(row["score"])
            sk, dk = _key(src), _key(dst)

            # Skip self-references back to center
            if sk == _key(artist_name) or dk == _key(artist_name):
                other = dst if sk == _key(artist_name) else src
                ok = _key(other)
                if ok in nodes:
                    lk = _link_key(artist_name, other)
                    if lk not in seen_links:
                        seen_links.add(lk)
                        links.append({"source": nodes[_key(artist_name)]["id"], "target": nodes[ok]["id"], "value": score})
                continue

            # Cross-link between two existing nodes
            if sk in nodes and dk in nodes:
                lk = _link_key(src, dst)
                if lk not in seen_links:
                    seen_links.add(lk)
                    links.append({"source": nodes[sk]["id"], "target": nodes[dk]["id"], "value": score})
                continue

            # Normalize: ensure parent is the node already in graph
            if dk in nodes and sk not in nodes:
                src, dst = dst, src
                sk, dk = dk, sk

            if sk not in nodes:
                continue

            # Skip if target already exists
            if dk in nodes:
                lk = _link_key(src, dst)
                if lk not in seen_links:
                    seen_links.add(lk)
                    links.append({"source": nodes[sk]["id"], "target": nodes[dk]["id"], "value": score})
                continue

            # New depth-2 node
            count = per_parent.get(sk, 0)
            if count >= limit_per_level:
                continue
            per_parent[sk] = count + 1

            in_lib = bool(row["in_library"])
            nodes[dk] = {"id": dst, "group": 2, "in_library": in_lib, "score": score}
            lk = _link_key(src, dst)
            if lk not in seen_links:
                seen_links.add(lk)
                links.append({"source": nodes[sk]["id"], "target": dst, "value": score})

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
