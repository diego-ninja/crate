from __future__ import annotations

from crate.genre_taxonomy import get_genre_description, get_genre_display_name, get_top_level_slug


def build_genre_graph_payload(
    *,
    genre: dict | None,
    canonical_slug: str,
    taxonomy_slugs: list[str],
    taxonomy_stats: dict[str, dict],
    hierarchy_links: list[dict],
    direct_relation_links: list[dict],
) -> dict:
    nodes: list[dict] = []
    links: list[dict] = []
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


__all__ = ["build_genre_graph_payload"]
