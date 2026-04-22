from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def upsert_similarity(artist_name: str, similar_name: str, score: float, source: str = "lastfm") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(text("""
            INSERT INTO artist_similarities (artist_name, similar_name, score, source, updated_at)
            VALUES (:artist_name, :similar_name, :score, :source, :updated_at)
            ON CONFLICT (artist_name, similar_name) DO UPDATE SET
                score = EXCLUDED.score,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
        """), {"artist_name": artist_name, "similar_name": similar_name,
               "score": score, "source": source, "updated_at": now})


def bulk_upsert_similarities(artist_name: str, similarities: list[dict]) -> None:
    """Batch upsert similar artists for a given artist.

    Each dict in similarities must have 'name' and optionally 'score' and 'source'.
    """
    if not similarities:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "artist_name": artist_name,
            "similar_name": s["name"],
            "score": float(s.get("score") or s.get("match") or 0.0),
            "source": s.get("source", "lastfm"),
            "updated_at": now,
        }
        for s in similarities
        if s.get("name")
    ]
    if not rows:
        return
    with transaction_scope() as session:
        # Use a single executemany-style call for batch efficiency
        # (one round-trip instead of N)
        stmt = text("""
            INSERT INTO artist_similarities (artist_name, similar_name, score, source, updated_at)
            VALUES (:artist_name, :similar_name, :score, :source, :updated_at)
            ON CONFLICT (artist_name, similar_name) DO UPDATE SET
                score = EXCLUDED.score,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
        """)
        session.execute(stmt, rows)


def get_similar_artists(artist_name: str, limit: int = 30) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT similar_name, score, source, in_library
            FROM artist_similarities
            WHERE artist_name = :artist_name
            ORDER BY score DESC
            LIMIT :lim
        """), {"artist_name": artist_name, "lim": limit}).mappings().all()
    return [dict(r) for r in rows]


def get_artist_network(artist_name: str, depth: int = 2, limit_per_level: int = 15) -> dict:
    """Return {nodes, links} for ForceGraph2D.

    depth=1: center + direct similar
    depth=2: center + direct similar + similar-of-similar
    """
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    seen_links: set[tuple[str, str]] = set()

    def _key(name: str) -> str:
        return name.lower()

    def _link_key(a: str, b: str) -> tuple[str, str]:
        la, lb = _key(a), _key(b)
        return (min(la, lb), max(la, lb))

    nodes[_key(artist_name)] = {"id": artist_name, "group": 0, "in_library": True, "score": 1.0}

    with transaction_scope() as session:
        level1 = session.execute(text("""
            SELECT similar_name, score, in_library
            FROM artist_similarities
            WHERE artist_name = :artist_name
            ORDER BY score DESC
            LIMIT :lim
        """), {"artist_name": artist_name, "lim": limit_per_level}).mappings().all()

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
        with transaction_scope() as session:
            level2_rows = session.execute(text("""
                SELECT artist_name, similar_name, score, in_library
                FROM artist_similarities
                WHERE artist_name = ANY(:names)
                   OR similar_name = ANY(:names)
                ORDER BY score DESC
            """), {"names": level1_names}).mappings().all()

        per_parent: dict[str, int] = {}
        for row in level2_rows:
            src = row["artist_name"]
            dst = row["similar_name"]
            score = float(row["score"])
            sk, dk = _key(src), _key(dst)

            if sk == _key(artist_name) or dk == _key(artist_name):
                other = dst if sk == _key(artist_name) else src
                ok = _key(other)
                if ok in nodes:
                    lk = _link_key(artist_name, other)
                    if lk not in seen_links:
                        seen_links.add(lk)
                        links.append({"source": nodes[_key(artist_name)]["id"], "target": nodes[ok]["id"], "value": score})
                continue

            if sk in nodes and dk in nodes:
                lk = _link_key(src, dst)
                if lk not in seen_links:
                    seen_links.add(lk)
                    links.append({"source": nodes[sk]["id"], "target": nodes[dk]["id"], "value": score})
                continue

            if dk in nodes and sk not in nodes:
                src, dst = dst, src
                sk, dk = dk, sk

            if sk not in nodes:
                continue

            if dk in nodes:
                lk = _link_key(src, dst)
                if lk not in seen_links:
                    seen_links.add(lk)
                    links.append({"source": nodes[sk]["id"], "target": nodes[dk]["id"], "value": score})
                continue

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

    # Live lookup: check ALL nodes against library_artists (the static
    # in_library flag in artist_similarities can be stale)
    all_node_names = [node["id"].lower() for node in nodes.values()]
    refs_by_name: dict[str, dict] = {}
    if all_node_names:
        with transaction_scope() as session:
            rows = session.execute(
                text("""
                SELECT id, slug, name
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                """),
                {"names": all_node_names},
            ).mappings().all()
            refs_by_name = {
                row["name"].lower(): {"artist_id": row["id"], "artist_slug": row["slug"]}
                for row in rows
            }

    for node in nodes.values():
        # Override stale in_library flag with live data
        if node["id"].lower() in refs_by_name:
            node["in_library"] = True
        ref = refs_by_name.get(node["id"].lower())
        if ref:
            node.update(ref)

    return {"nodes": list(nodes.values()), "links": links}


def mark_library_status() -> int:
    """Update in_library flag based on current library_artists table. Returns updated row count."""
    with transaction_scope() as session:
        result = session.execute(text("""
            UPDATE artist_similarities
            SET in_library = EXISTS (
                SELECT 1 FROM library_artists
                WHERE LOWER(name) = LOWER(artist_similarities.similar_name)
            )
        """))
        return result.rowcount
