from __future__ import annotations


def build_genre_graph_relationships(edge_rows: list[dict], canonical_slug: str) -> dict:
    parent_by_child: dict[str, set[str]] = {}
    child_by_parent: dict[str, set[str]] = {}
    direct_relation_links: list[dict] = []

    for row in edge_rows:
        source_slug = row["source_slug"]
        target_slug = row["target_slug"]
        relation_type = row["relation_type"]
        if relation_type == "parent":
            parent_by_child.setdefault(source_slug, set()).add(target_slug)
            child_by_parent.setdefault(target_slug, set()).add(source_slug)
            continue

        if relation_type == "related":
            if source_slug == canonical_slug:
                direct_relation_links.append(
                    {
                        "source": f"taxonomy:{canonical_slug}",
                        "target": f"taxonomy:{target_slug}",
                        "relation_type": "related",
                        "weight": 0.7,
                    }
                )
            elif target_slug == canonical_slug:
                direct_relation_links.append(
                    {
                        "source": f"taxonomy:{canonical_slug}",
                        "target": f"taxonomy:{source_slug}",
                        "relation_type": "related",
                        "weight": 0.7,
                    }
                )
            continue

        if source_slug == canonical_slug or target_slug == canonical_slug:
            direct_relation_links.append(
                {
                    "source": f"taxonomy:{source_slug}",
                    "target": f"taxonomy:{target_slug}",
                    "relation_type": relation_type,
                    "weight": 1,
                }
            )

    taxonomy_slugs: list[str] = [canonical_slug]
    hierarchy_links: list[dict] = []

    ancestor_seen: set[str] = {canonical_slug}
    ancestor_queue: list[str] = [canonical_slug]
    while ancestor_queue:
        current_slug = ancestor_queue.pop(0)
        for parent_slug in sorted(parent_by_child.get(current_slug, set())):
            taxonomy_slugs.extend([current_slug, parent_slug])
            hierarchy_links.append(
                {
                    "source": f"taxonomy:{parent_slug}",
                    "target": f"taxonomy:{current_slug}",
                    "relation_type": "parent",
                    "weight": 1,
                }
            )
            if parent_slug not in ancestor_seen:
                ancestor_seen.add(parent_slug)
                ancestor_queue.append(parent_slug)

    descendant_seen: set[str] = {canonical_slug}
    descendant_queue: list[tuple[str, int]] = [(canonical_slug, 0)]
    max_descendant_depth = 2
    while descendant_queue:
        current_slug, depth = descendant_queue.pop(0)
        if depth >= max_descendant_depth:
            continue
        for child_slug in sorted(child_by_parent.get(current_slug, set())):
            taxonomy_slugs.extend([current_slug, child_slug])
            hierarchy_links.append(
                {
                    "source": f"taxonomy:{current_slug}",
                    "target": f"taxonomy:{child_slug}",
                    "relation_type": "child",
                    "weight": 1,
                }
            )
            if child_slug not in descendant_seen:
                descendant_seen.add(child_slug)
                descendant_queue.append((child_slug, depth + 1))

    for link in direct_relation_links:
        source_slug = link["source"].replace("taxonomy:", "")
        target_slug = link["target"].replace("taxonomy:", "")
        taxonomy_slugs.extend([source_slug, target_slug])

    return {
        "taxonomy_slugs": taxonomy_slugs,
        "hierarchy_links": hierarchy_links,
        "direct_relation_links": direct_relation_links,
    }


__all__ = ["build_genre_graph_relationships"]
