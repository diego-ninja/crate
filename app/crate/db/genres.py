from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_taxonomy import (
    get_genre_description,
    get_genre_display_name,
    get_top_level_slug,
    invalidate_runtime_taxonomy_cache_after_commit,
    resolve_genre_slug,
    slugify_genre,
)

# ── Genres ────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    return slugify_genre(name)


def _invalid_genre_taxonomy_reason(slug: str) -> str | None:
    normalized = (slug or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"wikidata", "other-databases"}:
        return "external-section-marker"
    if normalized.startswith(("http-", "https-")):
        return "external-url"
    if normalized.startswith("q") and normalized[1:].isdigit():
        return "wikidata-entity-id"
    return None


def get_or_create_genre(name: str, *, session=None) -> int:
    name = name.strip().lower()
    slug = _slugify(name)
    if not slug:
        return -1
    if session is None:
        with transaction_scope() as s:
            return get_or_create_genre(name, session=s)
    row = session.execute(
        text("SELECT id FROM genres WHERE slug = :slug"),
        {"slug": slug},
    ).mappings().first()
    if row:
        return row["id"]
    row = session.execute(
        text("INSERT INTO genres (name, slug) VALUES (:name, :slug) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id"),
        {"name": name, "slug": slug},
    ).mappings().first()
    return row["id"]


def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]], *, session=None):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    if session is None:
        with transaction_scope() as s:
            return set_artist_genres(artist_name, genres, session=s)
    session.execute(
        text("DELETE FROM artist_genres WHERE artist_name = :artist_name"),
        {"artist_name": artist_name},
    )
    for name, weight, source in genres:
        genre_id = get_or_create_genre(name, session=session)
        if genre_id < 0:
            continue
        session.execute(
            text(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (:artist_name, :genre_id, :weight, :source) "
                "ON CONFLICT DO NOTHING"
            ),
            {"artist_name": artist_name, "genre_id": genre_id, "weight": weight, "source": source},
        )


def set_album_genres(album_id: int, genres: list[tuple[str, float, str]], *, session=None):
    """Set genres for an album. genres: [(name, weight, source), ...]"""
    if session is None:
        with transaction_scope() as s:
            return set_album_genres(album_id, genres, session=s)
    session.execute(
        text("DELETE FROM album_genres WHERE album_id = :album_id"),
        {"album_id": album_id},
    )
    for name, weight, source in genres:
        genre_id = get_or_create_genre(name, session=session)
        if genre_id < 0:
            continue
        session.execute(
            text(
                "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (:album_id, :genre_id, :weight, :source) "
                "ON CONFLICT DO NOTHING"
            ),
            {"album_id": album_id, "genre_id": genre_id, "weight": weight, "source": source},
        )


def _annotate_genre_mapping(items: list[dict]) -> list[dict]:
    for item in items:
        canonical_slug = item.get("canonical_slug")
        item["mapped"] = canonical_slug is not None
        if canonical_slug:
            top_level_slug = get_top_level_slug(canonical_slug) or canonical_slug
            item["top_level_slug"] = top_level_slug
            item["top_level_name"] = get_genre_display_name(top_level_slug)
            item["top_level_description"] = get_genre_description(top_level_slug)
            item["description"] = item.get("canonical_description") or get_genre_description(canonical_slug)
        else:
            item["top_level_slug"] = None
            item["top_level_name"] = None
            item["top_level_description"] = None
            item["description"] = None
            item["external_description"] = None
            item["external_description_source"] = None
            item["musicbrainz_mbid"] = None
            item["wikidata_entity_id"] = None
            item["wikidata_url"] = None
    return items


def get_all_genres() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                g.id,
                g.name,
                g.slug,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
                tn.slug AS canonical_slug,
                tn.name AS canonical_name,
                tn.description AS canonical_description,
                tn.external_description,
                tn.external_description_source,
                tn.musicbrainz_mbid,
                tn.wikidata_entity_id,
                tn.wikidata_url
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
            GROUP BY g.id, g.name, g.slug, tn.slug, tn.name, tn.description, tn.external_description, tn.external_description_source, tn.musicbrainz_mbid, tn.wikidata_entity_id, tn.wikidata_url
            HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC
        """)).mappings().all()
        return _annotate_genre_mapping([dict(r) for r in rows])


def get_unmapped_genres(limit: int = 24) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                g.id,
                g.name,
                g.slug,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            WHERE gta.alias_slug IS NULL
            GROUP BY g.id, g.name, g.slug
            HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC, COUNT(DISTINCT alg.album_id) DESC, g.name ASC
            LIMIT :lim
            """),
            {"lim": limit},
        ).mappings().all()
    items = [dict(row) for row in rows]
    for item in items:
        item["mapped"] = False
        item["canonical_slug"] = None
        item["canonical_name"] = None
        item["canonical_description"] = None
        item["top_level_slug"] = None
        item["top_level_name"] = None
        item["top_level_description"] = None
        item["description"] = None
        item["external_description"] = None
        item["external_description_source"] = None
        item["musicbrainz_mbid"] = None
        item["wikidata_entity_id"] = None
        item["wikidata_url"] = None
    return items


def _get_genre_summary_by_slug(session, slug: str) -> dict | None:
    row = session.execute(
        text("""
        SELECT
            g.id,
            g.name,
            g.slug,
            COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
            COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
            tn.slug AS canonical_slug,
            tn.name AS canonical_name,
            tn.description AS canonical_description,
            tn.external_description,
            tn.external_description_source,
            tn.musicbrainz_mbid,
            tn.wikidata_entity_id,
            tn.wikidata_url,
            tn.eq_gains AS canonical_eq_gains,
            tn.eq_reasoning
        FROM genres g
        LEFT JOIN artist_genres ag ON g.id = ag.genre_id
        LEFT JOIN album_genres alg ON g.id = alg.genre_id
        LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
        LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
        WHERE g.slug = :slug
        GROUP BY g.id, g.name, g.slug, tn.slug, tn.name, tn.description, tn.external_description, tn.external_description_source, tn.musicbrainz_mbid, tn.wikidata_entity_id, tn.wikidata_url, tn.eq_gains, tn.eq_reasoning
        """),
        {"slug": slug},
    ).mappings().first()
    if not row:
        return None
    annotated = _annotate_genre_mapping([dict(row)])[0]
    _annotate_eq_preset(annotated)
    return annotated


def _annotate_eq_preset(item: dict) -> None:
    """Attach eq_gains + resolved preset info so the admin UI can show
    the current state of the genre (direct / inherited / none)."""
    from crate.genre_taxonomy import resolve_genre_eq_preset

    canonical_gains = item.pop("canonical_eq_gains", None)
    canonical_slug = item.get("canonical_slug")

    item["eq_gains"] = [float(v) for v in canonical_gains] if canonical_gains is not None else None

    if canonical_slug:
        resolved = resolve_genre_eq_preset(canonical_slug)
        item["eq_preset_resolved"] = resolved
    else:
        item["eq_preset_resolved"] = None


def get_genre_detail(slug: str) -> dict | None:
    with transaction_scope() as session:
        genre = _get_genre_summary_by_slug(session, slug)
        if not genre:
            return None
        if not genre.get("description") and not genre.get("mapped"):
            genre["description"] = "raw library tag detected in your collection but not yet linked into the curated taxonomy."

        rows = session.execute(text("""
            SELECT
                ag.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                ag.weight,
                ag.source,
                la.album_count,
                la.track_count,
                la.has_photo,
                la.spotify_popularity,
                la.listeners
            FROM artist_genres ag
            JOIN library_artists la ON ag.artist_name = la.name
            WHERE ag.genre_id = :genre_id
            ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
        """), {"genre_id": genre["id"]}).mappings().all()
        genre["artists"] = [dict(r) for r in rows]

        rows = session.execute(text("""
            SELECT DISTINCT ON (a.id)
                a.id AS album_id,
                a.slug AS album_slug,
                a.artist,
                ar.id AS artist_id,
                ar.slug AS artist_slug,
                a.name,
                a.year,
                a.track_count,
                a.has_cover,
                COALESCE(alg.weight, ag.weight, 0.5) AS weight
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = :genre_id
            LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = :genre_id
            WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
            ORDER BY a.id, a.year DESC NULLS LAST
        """), {"genre_id": genre["id"]}).mappings().all()
        genre["albums"] = [dict(r) for r in rows]

        return genre


def _get_taxonomy_node_stats(session, slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    rows = session.execute(
        text("""
        SELECT
            n.slug,
            n.name,
            n.description,
            n.external_description,
            n.is_top_level,
            COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
            COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
        FROM genre_taxonomy_nodes n
        LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
        LEFT JOIN genres g ON g.slug = gta.alias_slug
        LEFT JOIN artist_genres ag ON ag.genre_id = g.id
        LEFT JOIN album_genres alg ON alg.genre_id = g.id
        WHERE n.slug = ANY(:slugs)
        GROUP BY n.id, n.slug, n.name, n.description, n.external_description, n.is_top_level
        """),
        {"slugs": slugs},
    ).mappings().all()
    stats = {row["slug"]: dict(row) for row in rows}

    rows = session.execute(
        text("""
        WITH alias_counts AS (
            SELECT
                n.slug AS taxonomy_slug,
                g.slug AS genre_slug,
                g.name AS genre_name,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
            LEFT JOIN genres g ON g.slug = gta.alias_slug
            LEFT JOIN artist_genres ag ON ag.genre_id = g.id
            LEFT JOIN album_genres alg ON alg.genre_id = g.id
            WHERE n.slug = ANY(:slugs)
            GROUP BY n.id, n.slug, g.id, g.slug, g.name
        )
        SELECT DISTINCT ON (taxonomy_slug)
            taxonomy_slug,
            genre_slug,
            genre_name
        FROM alias_counts
        WHERE genre_slug IS NOT NULL
        ORDER BY taxonomy_slug, artist_count DESC, album_count DESC, genre_slug ASC
        """),
        {"slugs": slugs},
    ).mappings().all()
    for row in rows:
        bucket = stats.get(row["taxonomy_slug"])
        if not bucket:
            continue
        bucket["page_slug"] = row["genre_slug"]
        bucket["page_name"] = row["genre_name"]

    for slug in slugs:
        bucket = stats.setdefault(
            slug,
            {
                "slug": slug,
                "name": get_genre_display_name(slug),
                "description": get_genre_description(slug),
                "external_description": "",
                "is_top_level": False,
                "artist_count": 0,
                "album_count": 0,
            },
        )
        bucket.setdefault("page_slug", None)
        bucket.setdefault("page_name", None)
    return stats


def get_genre_graph(slug: str) -> dict | None:
    with transaction_scope() as session:
        genre = _get_genre_summary_by_slug(session, slug)
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

        edge_rows = [dict(row) for row in session.execute(
            text("""
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
            """),
            {"canonical_slug": canonical_slug},
        ).mappings().all()]

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

        taxonomy_stats = _get_taxonomy_node_stats(session, list(dict.fromkeys(taxonomy_slugs)))
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
                "page_slug": center_taxonomy_stats.get("page_slug") or (genre["slug"] if genre and genre["slug"] == canonical_slug else None),
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
            "mapping": genre or {
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


def list_invalid_genre_taxonomy_nodes(*, session=None) -> list[dict]:
    if session is None:
        with transaction_scope() as s:
            return list_invalid_genre_taxonomy_nodes(session=s)

    rows = session.execute(
        text("""
        SELECT
            n.id,
            n.slug,
            n.name,
            COUNT(DISTINCT a.alias_slug)::INTEGER AS alias_count,
            COUNT(DISTINCT (e.source_genre_id, e.target_genre_id, e.relation_type))::INTEGER AS edge_count
        FROM genre_taxonomy_nodes n
        LEFT JOIN genre_taxonomy_aliases a ON a.genre_id = n.id
        LEFT JOIN genre_taxonomy_edges e
          ON e.source_genre_id = n.id
          OR e.target_genre_id = n.id
        GROUP BY n.id, n.slug, n.name
        ORDER BY n.slug ASC
        """)
    ).mappings().all()

    invalid_items: list[dict] = []
    for row in rows:
        item = dict(row)
        reason = _invalid_genre_taxonomy_reason(item["slug"])
        if not reason:
            continue
        item["reason"] = reason
        invalid_items.append(item)
    return invalid_items


def cleanup_invalid_genre_taxonomy_nodes(*, dry_run: bool = True, session=None) -> dict:
    if session is None:
        with transaction_scope() as s:
            return cleanup_invalid_genre_taxonomy_nodes(dry_run=dry_run, session=s)

    invalid_items = list_invalid_genre_taxonomy_nodes(session=session)
    summary = {
        "dry_run": dry_run,
        "invalid_count": len(invalid_items),
        "deleted_count": 0,
        "alias_count": sum(int(item.get("alias_count") or 0) for item in invalid_items),
        "edge_count": sum(int(item.get("edge_count") or 0) for item in invalid_items),
        "items": invalid_items,
    }
    if dry_run or not invalid_items:
        return summary

    for item in invalid_items:
        session.execute(
            text("DELETE FROM genre_taxonomy_nodes WHERE id = :node_id"),
            {"node_id": item["id"]},
        )
    invalidate_runtime_taxonomy_cache_after_commit(session)
    summary["deleted_count"] = len(invalid_items)
    return summary


def list_genre_taxonomy_nodes_for_external_enrichment(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
    only_missing_external: bool = True,
) -> list[dict]:
    with transaction_scope() as session:
        query = """
            SELECT
                slug,
                name,
                description,
                external_description,
                external_description_source,
                musicbrainz_mbid,
                wikidata_entity_id,
                wikidata_url,
                is_top_level
            FROM genre_taxonomy_nodes
            WHERE 1=1
        """
        params: dict = {}
        if focus_slug:
            query += " AND slug = :focus_slug"
            params["focus_slug"] = (focus_slug or "").strip().lower()
        if only_missing_external:
            query += " AND (external_description IS NULL OR external_description = '')"
        query += " ORDER BY is_top_level DESC, slug ASC LIMIT :lim"
        params["lim"] = max(1, min(int(limit or 100), 500))
        rows = session.execute(text(query), params).mappings().all()
        return [dict(row) for row in rows]


def list_genre_taxonomy_nodes_for_musicbrainz_sync(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
) -> list[dict]:
    resolved_focus = resolve_genre_slug(focus_slug or "") if focus_slug else None
    with transaction_scope() as session:
        query = """
            SELECT
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.external_description_source,
                n.musicbrainz_mbid,
                n.wikidata_entity_id,
                n.wikidata_url,
                n.is_top_level,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
            LEFT JOIN genres g ON g.slug = gta.alias_slug
            LEFT JOIN artist_genres ag ON ag.genre_id = g.id
            LEFT JOIN album_genres alg ON alg.genre_id = g.id
            WHERE 1=1
        """
        params: dict = {}
        if resolved_focus:
            query += " AND n.slug = :focus_slug"
            params["focus_slug"] = resolved_focus
        query += """
            GROUP BY
                n.id,
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.external_description_source,
                n.musicbrainz_mbid,
                n.wikidata_entity_id,
                n.wikidata_url,
                n.is_top_level
            ORDER BY
                CASE WHEN n.musicbrainz_mbid IS NULL OR n.musicbrainz_mbid = '' THEN 0 ELSE 1 END,
                COUNT(DISTINCT ag.artist_name) DESC,
                COUNT(DISTINCT alg.album_id) DESC,
                n.is_top_level DESC,
                n.name ASC
            LIMIT :lim
        """
        params["lim"] = max(1, min(int(limit or 100), 500))
        rows = session.execute(text(query), params).mappings().all()
        return [dict(row) for row in rows]


def upsert_genre_taxonomy_node(
    slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    is_top_level: bool = False,
    musicbrainz_mbid: str | None = None,
    session=None,
) -> dict | None:
    import re

    candidate_slug = _slugify(slug or name or "")
    candidate_name = re.sub(r"\s+", " ", (name or slug or "").strip().lower()).strip()
    candidate_description = re.sub(r"\s+", " ", (description or "").strip().lower()).strip()
    mbid = (musicbrainz_mbid or "").strip() or None
    if not candidate_slug:
        return None
    if not candidate_name:
        candidate_name = candidate_slug.replace("-", " ")

    if session is None:
        with transaction_scope() as s:
            return upsert_genre_taxonomy_node(slug, name=name, description=description,
                                               is_top_level=is_top_level,
                                               musicbrainz_mbid=musicbrainz_mbid, session=s)
    row = None
    if mbid:
        row = session.execute(
            text("SELECT id, slug, name, description, is_top_level, musicbrainz_mbid FROM genre_taxonomy_nodes WHERE musicbrainz_mbid = :mbid"),
            {"mbid": mbid},
        ).mappings().first()
    if not row:
        row = session.execute(
            text("SELECT id, slug, name, description, is_top_level, musicbrainz_mbid FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": candidate_slug},
        ).mappings().first()

    if row:
        row = dict(row)
        update_fields: list[str] = []
        values: dict = {"node_id": row["id"]}
        idx = 0
        current_name = (row.get("name") or "").strip().lower()
        generic_name = row["slug"].replace("-", " ")
        if candidate_name and (not current_name or current_name == generic_name):
            update_fields.append(f"name = :u{idx}")
            values[f"u{idx}"] = candidate_name
            idx += 1
        if candidate_description and not (row.get("description") or "").strip():
            update_fields.append(f"description = :u{idx}")
            values[f"u{idx}"] = candidate_description
            idx += 1
        if is_top_level and not row.get("is_top_level"):
            update_fields.append("is_top_level = TRUE")
        if mbid and not (row.get("musicbrainz_mbid") or "").strip():
            update_fields.append(f"musicbrainz_mbid = :u{idx}")
            values[f"u{idx}"] = mbid
            idx += 1
        if update_fields:
            row = dict(session.execute(
                text(f"""
                UPDATE genre_taxonomy_nodes
                SET {', '.join(update_fields)}
                WHERE id = :node_id
                RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
                """),
                values,
            ).mappings().first())
    else:
        row = dict(session.execute(
            text("""
            INSERT INTO genre_taxonomy_nodes (slug, name, description, is_top_level, musicbrainz_mbid)
            VALUES (:slug, :name, :description, :is_top_level, :mbid)
            RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
            """),
            {"slug": candidate_slug, "name": candidate_name,
             "description": candidate_description, "is_top_level": bool(is_top_level),
             "mbid": mbid},
        ).mappings().first())

    alias_entries: list[tuple[str, str]] = []
    seen_alias_slugs: set[str] = set()
    for candidate_alias in (row["slug"].replace("-", " "), row["name"], candidate_name):
        alias_name = re.sub(r"\s+", " ", (candidate_alias or "").strip().lower()).strip()
        alias_slug = _slugify(alias_name)
        if not alias_name or not alias_slug or alias_slug in seen_alias_slugs:
            continue
        seen_alias_slugs.add(alias_slug)
        alias_entries.append((alias_slug, alias_name))
    for alias_slug, alias_name in alias_entries:
        session.execute(
            text("DELETE FROM genre_taxonomy_aliases WHERE alias_name = :alias_name AND alias_slug != :alias_slug"),
            {"alias_name": alias_name, "alias_slug": alias_slug},
        )
        session.execute(
            text("""
            INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
            VALUES (:alias_slug, :alias_name, :genre_id)
            ON CONFLICT (alias_slug) DO UPDATE
            SET alias_name = EXCLUDED.alias_name,
                genre_id = EXCLUDED.genre_id
            """),
            {"alias_slug": alias_slug, "alias_name": alias_name, "genre_id": row["id"]},
        )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return row


def upsert_genre_taxonomy_edge(
    source_slug: str,
    target_slug: str,
    *,
    relation_type: str,
    weight: float | None = None,
    session=None,
) -> bool:
    source_slug = (source_slug or "").strip().lower()
    target_slug = (target_slug or "").strip().lower()
    relation_type = (relation_type or "").strip().lower()
    if not source_slug or not target_slug or source_slug == target_slug:
        return False
    if relation_type not in {"parent", "related", "influenced_by", "fusion_of"}:
        return False
    edge_weight = weight if weight is not None else (0.7 if relation_type == "related" else 1.0)

    if session is None:
        with transaction_scope() as s:
            return upsert_genre_taxonomy_edge(source_slug, target_slug,
                                               relation_type=relation_type,
                                               weight=weight, session=s)
    source_row = session.execute(
        text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
        {"slug": source_slug},
    ).mappings().first()
    target_row = session.execute(
        text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
        {"slug": target_slug},
    ).mappings().first()
    if not source_row or not target_row:
        return False
    session.execute(
        text("""
        INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
        VALUES (:source_id, :target_id, :relation_type, :weight)
        ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
        SET weight = EXCLUDED.weight
        """),
        {"source_id": source_row["id"], "target_id": target_row["id"],
         "relation_type": relation_type, "weight": edge_weight},
    )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return True


def get_genre_taxonomy_node_id(slug: str) -> int | None:
    """Return the id of a genre_taxonomy_nodes row by slug, or None."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": slug},
        ).mappings().first()
    return row["id"] if row else None


def set_genre_eq_gains(slug: str, gains: list[float] | None, *, reasoning: str | None = None, session=None) -> None:
    """Set eq_gains (and optionally eq_reasoning) for a genre taxonomy node."""
    if session is None:
        with transaction_scope() as s:
            return set_genre_eq_gains(slug, gains, reasoning=reasoning, session=s)
    if reasoning is not None:
        session.execute(
            text("UPDATE genre_taxonomy_nodes SET eq_gains = :gains, eq_reasoning = :reasoning WHERE slug = :slug"),
            {"gains": gains, "reasoning": reasoning, "slug": slug},
        )
    else:
        session.execute(
            text("UPDATE genre_taxonomy_nodes SET eq_gains = :gains WHERE slug = :slug"),
            {"gains": gains, "slug": slug},
        )


def update_genre_external_metadata(
    slug: str,
    *,
    musicbrainz_mbid: str | None = None,
    wikidata_entity_id: str | None = None,
    wikidata_url: str | None = None,
    external_description: str | None = None,
    external_description_source: str | None = None,
    session=None,
) -> bool:
    slug = (slug or "").strip().lower()
    if not slug:
        return False

    fields: list[str] = []
    params: dict = {"slug": slug}
    idx = 0
    if musicbrainz_mbid is not None:
        fields.append(f"musicbrainz_mbid = :v{idx}")
        params[f"v{idx}"] = (musicbrainz_mbid or "").strip() or None
        idx += 1
    if wikidata_entity_id is not None:
        fields.append(f"wikidata_entity_id = :v{idx}")
        params[f"v{idx}"] = (wikidata_entity_id or "").strip() or None
        idx += 1
    if wikidata_url is not None:
        fields.append(f"wikidata_url = :v{idx}")
        params[f"v{idx}"] = (wikidata_url or "").strip() or None
        idx += 1
    if external_description is not None:
        fields.append(f"external_description = :v{idx}")
        params[f"v{idx}"] = (external_description or "").strip()
        idx += 1
    if external_description_source is not None:
        fields.append(f"external_description_source = :v{idx}")
        params[f"v{idx}"] = (external_description_source or "").strip()
        idx += 1
    if not fields:
        return False

    if session is None:
        with transaction_scope() as s:
            return update_genre_external_metadata(
                slug, musicbrainz_mbid=musicbrainz_mbid, wikidata_entity_id=wikidata_entity_id,
                wikidata_url=wikidata_url, external_description=external_description,
                external_description_source=external_description_source, session=s,
            )
    result = session.execute(
        text(f"UPDATE genre_taxonomy_nodes SET {', '.join(fields)} WHERE slug = :slug"),
        params,
    )
    changed = result.rowcount > 0
    if changed:
        invalidate_runtime_taxonomy_cache_after_commit(session)
    return changed


# ── Genre indexer queries ─────────────────────────────────────────

def get_artists_with_tags() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, tags_json FROM library_artists WHERE tags_json IS NOT NULL")
        ).mappings().all()
    return [dict(r) for r in rows]


def get_albums_with_genres() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT a.id, a.artist, a.name, a.genre,
                   array_agg(DISTINCT t.genre) FILTER (WHERE t.genre IS NOT NULL AND t.genre != '') AS track_genres
            FROM library_albums a
            LEFT JOIN library_tracks t ON t.album_id = a.id
            GROUP BY a.id, a.artist, a.name, a.genre
        """)).mappings().all()
    return [dict(r) for r in rows]


def get_artists_missing_genre_mapping() -> list[str]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT DISTINCT a.artist AS name
            FROM library_albums a
            JOIN album_genres ag ON ag.album_id = a.id
            WHERE a.artist NOT IN (SELECT artist_name FROM artist_genres)
        """)).mappings().all()
    return [r["name"] for r in rows]


def get_artist_album_genres(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT g.name, COUNT(*) AS cnt
            FROM album_genres ag
            JOIN genres g ON ag.genre_id = g.id
            JOIN library_albums a ON ag.album_id = a.id
            WHERE a.artist = :artist
            GROUP BY g.name
            ORDER BY cnt DESC
        """), {"artist": artist_name}).mappings().all()
    return [dict(r) for r in rows]


def get_total_genre_count() -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) as cnt FROM genres")
        ).mappings().first()
    return int(row["cnt"]) if row else 0


# ── Genre taxonomy inference queries ─────────────────────────────

def list_unmapped_genres_for_inference(
    limit: int,
    focus_slug: str | None = None,
) -> list[dict]:
    with transaction_scope() as session:
        items: list[dict] = []
        if focus_slug:
            row = session.execute(
                text("""
                SELECT
                    g.id,
                    g.name,
                    g.slug,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                WHERE gta.alias_slug IS NULL
                  AND g.slug = :focus_slug
                GROUP BY g.id, g.name, g.slug
                """),
                {"focus_slug": focus_slug},
            ).mappings().first()
            if row:
                items.append(dict(row))

        remaining_limit = max(limit - len(items), 0)
        if remaining_limit > 0:
            rows = session.execute(
                text("""
                SELECT
                    g.id,
                    g.name,
                    g.slug,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                WHERE gta.alias_slug IS NULL
                  AND (:focus_slug IS NULL OR g.slug <> :focus_slug)
                GROUP BY g.id, g.name, g.slug
                HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
                ORDER BY COUNT(DISTINCT ag.artist_name) DESC, COUNT(DISTINCT alg.album_id) DESC, g.name ASC
                LIMIT :remaining_limit
                """),
                {"focus_slug": focus_slug, "remaining_limit": remaining_limit},
            ).mappings().all()
            items.extend(dict(row) for row in rows)
    return items


def get_unmapped_genre_count() -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT COUNT(*)::INTEGER AS cnt
            FROM genres g
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            WHERE gta.alias_slug IS NULL
            """)
        ).mappings().first()
    return int(row["cnt"] or 0) if row else 0


# ── Genre descriptions queries ────────────────────────────────────

def get_remaining_without_external_description() -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes WHERE external_description IS NULL OR external_description = ''")
        ).mappings().first()
    return int(row["cnt"] or 0) if row else 0


def get_genre_seed_artists(genre_slug: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_artist_slugs(genre_slug: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_album_slugs(genre_slug: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]
