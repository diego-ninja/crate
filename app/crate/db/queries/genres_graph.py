from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import get_genre_summary_by_slug, get_taxonomy_node_stats
from crate.db.tx import read_scope
from crate.genre_taxonomy import get_genre_description, get_genre_display_name, get_top_level_slug, resolve_genre_slug


def get_genre_graph(slug: str) -> dict | None:
    with read_scope() as session:
        genre = get_genre_summary_by_slug(session, slug)
        canonical_slug = genre.get("canonical_slug") if genre else None
        if canonical_slug is None:
            resolved = resolve_genre_slug(slug)
            taxonomy_row = session.execute(
                text("SELECT slug, name, is_top_level FROM genre_taxonomy_nodes WHERE slug = :slug"),
                {"slug": resolved},
            ).mappings().first()
            canonical_slug = taxonomy_row["slug"] if taxonomy_row else None

        nodes: list[dict] = []
        links: list[dict] = []

        if not canonical_slug:
            if not genre:
                return None
            nodes.append(
                {
                    "id": f"library:{genre['slug']}",
                    "slug": genre["slug"],
                    "label": genre["name"],
                    "kind": "unmapped",
                    "mapped": False,
                    "artist_count": genre["artist_count"],
                    "album_count": genre["album_count"],
                    "description": genre.get("description")
                    or "raw library tag detected in your collection but not yet linked into the curated taxonomy.",
                    "page_slug": genre["slug"],
                    "is_center": True,
                    "is_top_level": False,
                }
            )
            return {"nodes": nodes, "links": links, "mapping": genre}

        edge_rows = [
            dict(row)
            for row in session.execute(
                text(
                    """
                    WITH RECURSIVE reachable(slug, depth) AS (
                        SELECT CAST(:canonical_slug AS TEXT), 0
                        UNION
                        SELECT
                            CASE WHEN r.slug = source.slug THEN target.slug ELSE source.slug END,
                            r.depth + 1
                        FROM reachable r
                        JOIN genre_taxonomy_nodes n ON n.slug = r.slug
                        JOIN genre_taxonomy_edges edge
                          ON edge.source_genre_id = n.id OR edge.target_genre_id = n.id
                        JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                        JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                        WHERE r.depth < 2
                          AND edge.relation_type IN ('parent', 'related', 'influenced_by', 'fusion_of')
                    )
                    SELECT DISTINCT
                        source.slug AS source_slug,
                        source.name AS source_name,
                        source.is_top_level AS source_is_top_level,
                        target.slug AS target_slug,
                        target.name AS target_name,
                        target.is_top_level AS target_is_top_level,
                        edge.relation_type
                    FROM genre_taxonomy_edges edge
                    JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                    JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                    WHERE edge.relation_type IN ('parent', 'related', 'influenced_by', 'fusion_of')
                      AND (source.slug IN (SELECT slug FROM reachable)
                        OR target.slug IN (SELECT slug FROM reachable))
                    """
                ),
                {"canonical_slug": canonical_slug},
            ).mappings().all()
        ]

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

        taxonomy_stats = get_taxonomy_node_stats(session, list(dict.fromkeys(taxonomy_slugs)))
        center_taxonomy_stats = taxonomy_stats.get(canonical_slug, {})

        direct_nodes: set[str] = set()
        if genre and genre["slug"] != canonical_slug:
            nodes.append(
                {
                    "id": f"library:{genre['slug']}",
                    "slug": genre["slug"],
                    "label": genre["name"],
                    "kind": "library",
                    "mapped": True,
                    "artist_count": genre["artist_count"],
                    "album_count": genre["album_count"],
                    "description": genre.get("description") or center_taxonomy_stats.get("description") or "",
                    "page_slug": genre["slug"],
                    "is_center": True,
                    "is_top_level": False,
                    "canonical_slug": canonical_slug,
                }
            )
            links.append(
                {
                    "source": f"library:{genre['slug']}",
                    "target": f"taxonomy:{canonical_slug}",
                    "relation_type": "alias",
                    "weight": 1,
                }
            )
        nodes.append(
            {
                "id": f"taxonomy:{canonical_slug}",
                "slug": canonical_slug,
                "label": get_genre_display_name(canonical_slug),
                "kind": "top-level" if center_taxonomy_stats.get("is_top_level") else "taxonomy",
                "mapped": True,
                "artist_count": center_taxonomy_stats.get("artist_count", 0),
                "album_count": center_taxonomy_stats.get("album_count", 0),
                "description": center_taxonomy_stats.get("description") or "",
                "page_slug": center_taxonomy_stats.get("page_slug")
                or (genre["slug"] if genre and genre["slug"] == canonical_slug else None),
                "is_center": genre is None or genre["slug"] == canonical_slug,
                "is_top_level": bool(center_taxonomy_stats.get("is_top_level")),
            }
        )
        direct_nodes.add(canonical_slug)

        for neighbor_slug in list(dict.fromkeys(slug for slug in taxonomy_slugs if slug and slug != canonical_slug)):
            neighbor_stats = taxonomy_stats.get(neighbor_slug, {})
            if neighbor_slug in direct_nodes:
                continue
            nodes.append(
                {
                    "id": f"taxonomy:{neighbor_slug}",
                    "slug": neighbor_slug,
                    "label": get_genre_display_name(neighbor_slug),
                    "kind": "top-level" if neighbor_stats.get("is_top_level") else "taxonomy",
                    "mapped": True,
                    "artist_count": neighbor_stats.get("artist_count", 0),
                    "album_count": neighbor_stats.get("album_count", 0),
                    "description": neighbor_stats.get("description") or "",
                    "page_slug": neighbor_stats.get("page_slug"),
                    "is_center": False,
                    "is_top_level": bool(neighbor_stats.get("is_top_level")),
                }
            )
            direct_nodes.add(neighbor_slug)

        seen_links: set[tuple[str, str, str]] = set()
        for link in hierarchy_links + direct_relation_links:
            key = (link["source"], link["target"], link["relation_type"])
            if key in seen_links:
                continue
            seen_links.add(key)
            links.append(link)

        return {
            "nodes": nodes,
            "links": links,
            "mapping": genre
            or {
                "slug": canonical_slug,
                "name": get_genre_display_name(canonical_slug),
                "description": get_genre_description(canonical_slug),
                "external_description": center_taxonomy_stats.get("external_description") or "",
                "external_description_source": "",
                "musicbrainz_mbid": None,
                "wikidata_entity_id": None,
                "wikidata_url": None,
                "mapped": True,
                "canonical_slug": canonical_slug,
                "canonical_name": get_genre_display_name(canonical_slug),
                "canonical_description": get_genre_description(canonical_slug),
                "top_level_slug": get_top_level_slug(canonical_slug) or canonical_slug,
                "top_level_name": get_genre_display_name(get_top_level_slug(canonical_slug) or canonical_slug),
                "top_level_description": get_genre_description(get_top_level_slug(canonical_slug) or canonical_slug),
            },
        }


def get_genre_seed_artists(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_artists AS (
                    SELECT DISTINCT ag.artist_name
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug
                    UNION
                    SELECT DISTINCT a.artist AS artist_name
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    JOIN library_albums a ON a.id = alg.album_id
                    WHERE g.slug = :slug
                )
                SELECT
                    ag.artist_name,
                    MAX(ag.weight)::DOUBLE PRECISION AS weight,
                    MAX(COALESCE(la.listeners, 0))::INTEGER AS listeners
                FROM seed_artists sa
                JOIN artist_genres ag ON ag.artist_name = sa.artist_name
                LEFT JOIN library_artists la ON la.name = ag.artist_name
                GROUP BY ag.artist_name
                ORDER BY MAX(ag.weight) DESC, MAX(COALESCE(la.listeners, 0)) DESC, ag.artist_name ASC
                LIMIT 8
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_artist_slugs(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_artists AS (
                    SELECT DISTINCT ag.artist_name
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug
                    UNION
                    SELECT DISTINCT a.artist AS artist_name
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    JOIN library_albums a ON a.id = alg.album_id
                    WHERE g.slug = :slug
                )
                SELECT
                    tn.slug AS canonical_slug,
                    SUM(ag.weight)::DOUBLE PRECISION AS score,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS hits
                FROM seed_artists sa
                JOIN artist_genres ag ON ag.artist_name = sa.artist_name
                JOIN genres g ON g.id = ag.genre_id
                JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                WHERE g.slug <> :slug
                GROUP BY tn.slug
                ORDER BY SUM(ag.weight) DESC, COUNT(DISTINCT ag.artist_name) DESC, tn.slug ASC
                LIMIT 24
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_album_slugs(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_albums AS (
                    SELECT DISTINCT alg.album_id
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    WHERE g.slug = :slug
                )
                SELECT
                    tn.slug AS canonical_slug,
                    SUM(alg.weight)::DOUBLE PRECISION AS score,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS hits
                FROM seed_albums sa
                JOIN album_genres alg ON alg.album_id = sa.album_id
                JOIN genres g ON g.id = alg.genre_id
                JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                WHERE g.slug <> :slug
                GROUP BY tn.slug
                ORDER BY SUM(alg.weight) DESC, COUNT(DISTINCT alg.album_id) DESC, tn.slug ASC
                LIMIT 24
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


__all__ = [
    "get_genre_cooccurring_album_slugs",
    "get_genre_cooccurring_artist_slugs",
    "get_genre_graph",
    "get_genre_seed_artists",
]
