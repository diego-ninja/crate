from sqlalchemy import text

from crate.db.tx import transaction_scope


def _key(name: str) -> str:
    return name.lower()


def _link_key(a: str, b: str) -> tuple[str, str]:
    left, right = _key(a), _key(b)
    return (min(left, right), max(left, right))


def _append_unique_link(
    *,
    links: list[dict],
    seen_links: set[tuple[str, str]],
    source: str,
    target: str,
    score: float,
) -> None:
    key = _link_key(source, target)
    if key in seen_links:
        return
    seen_links.add(key)
    links.append({"source": source, "target": target, "value": score})


def _lookup_artist_refs(nodes: dict[str, dict]) -> dict[str, dict]:
    all_node_names = [node["id"].lower() for node in nodes.values()]
    if not all_node_names:
        return {}

    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, slug, name
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                """
            ),
            {"names": all_node_names},
        ).mappings().all()
    return {
        row["name"].lower(): {"artist_id": row["id"], "artist_slug": row["slug"]}
        for row in rows
    }


def get_artist_network(artist_name: str, depth: int = 2, limit_per_level: int = 15) -> dict:
    """Return {nodes, links} for ForceGraph2D.

    depth=1: center + direct similar
    depth=2: center + direct similar + similar-of-similar
    """
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    seen_links: set[tuple[str, str]] = set()

    center_key = _key(artist_name)
    nodes[center_key] = {"id": artist_name, "group": 0, "in_library": True, "score": 1.0}

    with transaction_scope() as session:
        level1 = session.execute(
            text(
                """
                SELECT similar_name, score, in_library
                FROM artist_similarities
                WHERE artist_name = :artist_name
                ORDER BY score DESC
                LIMIT :lim
                """
            ),
            {"artist_name": artist_name, "lim": limit_per_level},
        ).mappings().all()

    level1_names: list[str] = []
    for row in level1:
        name = row["similar_name"]
        node_key = _key(name)
        if node_key not in nodes:
            nodes[node_key] = {
                "id": name,
                "group": 1,
                "in_library": bool(row["in_library"]),
                "score": float(row["score"]),
            }
        level1_names.append(name)
        _append_unique_link(
            links=links,
            seen_links=seen_links,
            source=artist_name,
            target=name,
            score=float(row["score"]),
        )

    if depth >= 2 and level1_names:
        with transaction_scope() as session:
            level2_rows = session.execute(
                text(
                    """
                    SELECT artist_name, similar_name, score, in_library
                    FROM artist_similarities
                    WHERE artist_name = ANY(:names)
                       OR similar_name = ANY(:names)
                    ORDER BY score DESC
                    """
                ),
                {"names": level1_names},
            ).mappings().all()

        per_parent: dict[str, int] = {}
        for row in level2_rows:
            source = row["artist_name"]
            target = row["similar_name"]
            score = float(row["score"])
            source_key, target_key = _key(source), _key(target)

            if source_key == center_key or target_key == center_key:
                other = target if source_key == center_key else source
                other_key = _key(other)
                if other_key in nodes:
                    _append_unique_link(
                        links=links,
                        seen_links=seen_links,
                        source=nodes[center_key]["id"],
                        target=nodes[other_key]["id"],
                        score=score,
                    )
                continue

            if source_key in nodes and target_key in nodes:
                _append_unique_link(
                    links=links,
                    seen_links=seen_links,
                    source=nodes[source_key]["id"],
                    target=nodes[target_key]["id"],
                    score=score,
                )
                continue

            if target_key in nodes and source_key not in nodes:
                source, target = target, source
                source_key, target_key = target_key, source_key

            if source_key not in nodes:
                continue

            if target_key in nodes:
                _append_unique_link(
                    links=links,
                    seen_links=seen_links,
                    source=nodes[source_key]["id"],
                    target=nodes[target_key]["id"],
                    score=score,
                )
                continue

            count = per_parent.get(source_key, 0)
            if count >= limit_per_level:
                continue
            per_parent[source_key] = count + 1

            nodes[target_key] = {
                "id": target,
                "group": 2,
                "in_library": bool(row["in_library"]),
                "score": score,
            }
            _append_unique_link(
                links=links,
                seen_links=seen_links,
                source=nodes[source_key]["id"],
                target=target,
                score=score,
            )

    refs_by_name = _lookup_artist_refs(nodes)
    for node in nodes.values():
        if node["id"].lower() in refs_by_name:
            node["in_library"] = True
        ref = refs_by_name.get(node["id"].lower())
        if ref:
            node.update(ref)

    return {"nodes": list(nodes.values()), "links": links}


__all__ = [
    "get_artist_network",
]
