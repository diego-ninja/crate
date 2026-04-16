from crate.db.core import get_db_ctx
from crate.genre_taxonomy import (
    get_genre_description,
    get_genre_display_name,
    get_top_level_slug,
    invalidate_runtime_taxonomy_cache,
    resolve_genre_slug,
    slugify_genre,
)

# ── Genres ────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    return slugify_genre(name)


def get_or_create_genre(name: str) -> int:
    name = name.strip().lower()
    slug = _slugify(name)
    if not slug:
        return -1
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM genres WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if row:
            return row["id"]
        cur.execute(
            "INSERT INTO genres (name, slug) VALUES (%s, %s) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",
            (name, slug),
        )
        return cur.fetchone()["id"]


def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]]):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM artist_genres WHERE artist_name = %s", (artist_name,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (artist_name, genre_id, weight, source),
            )


def set_album_genres(album_id: int, genres: list[tuple[str, float, str]]):
    """Set genres for an album. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM album_genres WHERE album_id = %s", (album_id,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (album_id, genre_id, weight, source),
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
    with get_db_ctx() as cur:
        cur.execute("""
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
        """)
        return _annotate_genre_mapping([dict(r) for r in cur.fetchall()])


def get_unmapped_genres(limit: int = 24) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
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
            LIMIT %s
            """,
            (limit,),
        )
        items = [dict(row) for row in cur.fetchall()]
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


def _get_genre_summary_by_slug(cur, slug: str) -> dict | None:
    cur.execute(
        """
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
            tn.eq_gains AS canonical_eq_gains
        FROM genres g
        LEFT JOIN artist_genres ag ON g.id = ag.genre_id
        LEFT JOIN album_genres alg ON g.id = alg.genre_id
        LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
        LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
        WHERE g.slug = %s
        GROUP BY g.id, g.name, g.slug, tn.slug, tn.name, tn.description, tn.external_description, tn.external_description_source, tn.musicbrainz_mbid, tn.wikidata_entity_id, tn.wikidata_url, tn.eq_gains
        """,
        (slug,),
    )
    row = cur.fetchone()
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

    # Own gains on the taxonomy node. Null = "inherit from parent".
    item["eq_gains"] = [float(v) for v in canonical_gains] if canonical_gains is not None else None

    # Resolved preset (may inherit from an ancestor). None for non-canonical
    # tags or orphan canonical nodes without any ancestor preset.
    if canonical_slug:
        resolved = resolve_genre_eq_preset(canonical_slug)
        item["eq_preset_resolved"] = resolved
    else:
        item["eq_preset_resolved"] = None


def get_genre_detail(slug: str) -> dict | None:
    with get_db_ctx() as cur:
        genre = _get_genre_summary_by_slug(cur, slug)
        if not genre:
            return None
        if not genre.get("description") and not genre.get("mapped"):
            genre["description"] = "raw library tag detected in your collection but not yet linked into the curated taxonomy."

        # Top artists by weight
        cur.execute("""
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
            WHERE ag.genre_id = %s
            ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
        """, (genre["id"],))
        genre["artists"] = [dict(r) for r in cur.fetchall()]

        # Albums in this genre: from album_genres OR from artists in this genre
        cur.execute("""
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
            LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = %s
            LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = %s
            WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
            ORDER BY a.id, a.year DESC NULLS LAST
        """, (genre["id"], genre["id"]))
        genre["albums"] = [dict(r) for r in cur.fetchall()]

        return genre


def _get_taxonomy_node_stats(cur, slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    cur.execute(
        """
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
        WHERE n.slug = ANY(%s)
        GROUP BY n.id, n.slug, n.name, n.description, n.external_description, n.is_top_level
        """,
        (slugs,),
    )
    stats = {row["slug"]: dict(row) for row in cur.fetchall()}

    cur.execute(
        """
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
            WHERE n.slug = ANY(%s)
            GROUP BY n.id, n.slug, g.id, g.slug, g.name
        )
        SELECT DISTINCT ON (taxonomy_slug)
            taxonomy_slug,
            genre_slug,
            genre_name
        FROM alias_counts
        WHERE genre_slug IS NOT NULL
        ORDER BY taxonomy_slug, artist_count DESC, album_count DESC, genre_slug ASC
        """,
        (slugs,),
    )
    for row in cur.fetchall():
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
    with get_db_ctx() as cur:
        genre = _get_genre_summary_by_slug(cur, slug)
        canonical_slug = genre.get("canonical_slug") if genre else None
        if canonical_slug is None:
            resolved = resolve_genre_slug(slug)
            cur.execute(
                """
                SELECT slug, name, is_top_level
                FROM genre_taxonomy_nodes
                WHERE slug = %s
                """,
                (resolved,),
            )
            taxonomy_row = cur.fetchone()
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

        # Load edges reachable from the canonical node (2 hops for parent
        # chains, 1 hop for other relation types) instead of the full graph.
        cur.execute(
            """
            WITH RECURSIVE reachable(slug, depth) AS (
                SELECT %s::TEXT, 0
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
            """,
            (canonical_slug,),
        )
        edge_rows = [dict(row) for row in cur.fetchall()]

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

        taxonomy_stats = _get_taxonomy_node_stats(cur, list(dict.fromkeys(taxonomy_slugs)))
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


def list_genre_taxonomy_nodes_for_external_enrichment(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
    only_missing_external: bool = True,
) -> list[dict]:
    with get_db_ctx() as cur:
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
        params: list[object] = []
        if focus_slug:
            query += " AND slug = %s"
            params.append((focus_slug or "").strip().lower())
        if only_missing_external:
            query += " AND (external_description IS NULL OR external_description = '')"
        query += " ORDER BY is_top_level DESC, slug ASC LIMIT %s"
        params.append(max(1, min(int(limit or 100), 500)))
        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


def list_genre_taxonomy_nodes_for_musicbrainz_sync(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
) -> list[dict]:
    resolved_focus = resolve_genre_slug(focus_slug or "") if focus_slug else None
    with get_db_ctx() as cur:
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
        params: list[object] = []
        if resolved_focus:
            query += " AND n.slug = %s"
            params.append(resolved_focus)
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
            LIMIT %s
        """
        params.append(max(1, min(int(limit or 100), 500)))
        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


def upsert_genre_taxonomy_node(
    slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    is_top_level: bool = False,
    musicbrainz_mbid: str | None = None,
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

    with get_db_ctx() as cur:
        row = None
        if mbid:
            cur.execute(
                """
                SELECT id, slug, name, description, is_top_level, musicbrainz_mbid
                FROM genre_taxonomy_nodes
                WHERE musicbrainz_mbid = %s
                """,
                (mbid,),
            )
            row = cur.fetchone()
        if not row:
            cur.execute(
                """
                SELECT id, slug, name, description, is_top_level, musicbrainz_mbid
                FROM genre_taxonomy_nodes
                WHERE slug = %s
                """,
                (candidate_slug,),
            )
            row = cur.fetchone()

        if row:
            row = dict(row)
            update_fields: list[str] = []
            values: list[object] = []
            current_name = (row.get("name") or "").strip().lower()
            generic_name = row["slug"].replace("-", " ")
            if candidate_name and (not current_name or current_name == generic_name):
                update_fields.append("name = %s")
                values.append(candidate_name)
            if candidate_description and not (row.get("description") or "").strip():
                update_fields.append("description = %s")
                values.append(candidate_description)
            if is_top_level and not row.get("is_top_level"):
                update_fields.append("is_top_level = TRUE")
            if mbid and not (row.get("musicbrainz_mbid") or "").strip():
                update_fields.append("musicbrainz_mbid = %s")
                values.append(mbid)
            if update_fields:
                values.append(row["id"])
                cur.execute(
                    f"""
                    UPDATE genre_taxonomy_nodes
                    SET {', '.join(update_fields)}
                    WHERE id = %s
                    RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
                    """,
                    values,
                )
                row = dict(cur.fetchone())
        else:
            cur.execute(
                """
                INSERT INTO genre_taxonomy_nodes (slug, name, description, is_top_level, musicbrainz_mbid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
                """,
                (candidate_slug, candidate_name, candidate_description, bool(is_top_level), mbid),
            )
            row = dict(cur.fetchone())

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
            cur.execute(
                "DELETE FROM genre_taxonomy_aliases WHERE alias_name = %s AND alias_slug != %s",
                (alias_name, alias_slug),
            )
            cur.execute(
                """
                INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (alias_slug) DO UPDATE
                SET alias_name = EXCLUDED.alias_name,
                    genre_id = EXCLUDED.genre_id
                """,
                (alias_slug, alias_name, row["id"]),
            )

    invalidate_runtime_taxonomy_cache()
    return row


def upsert_genre_taxonomy_edge(
    source_slug: str,
    target_slug: str,
    *,
    relation_type: str,
    weight: float | None = None,
) -> bool:
    source_slug = (source_slug or "").strip().lower()
    target_slug = (target_slug or "").strip().lower()
    relation_type = (relation_type or "").strip().lower()
    if not source_slug or not target_slug or source_slug == target_slug:
        return False
    if relation_type not in {"parent", "related", "influenced_by", "fusion_of"}:
        return False
    edge_weight = weight if weight is not None else (0.7 if relation_type == "related" else 1.0)

    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM genre_taxonomy_nodes WHERE slug = %s", (source_slug,))
        source_row = cur.fetchone()
        cur.execute("SELECT id FROM genre_taxonomy_nodes WHERE slug = %s", (target_slug,))
        target_row = cur.fetchone()
        if not source_row or not target_row:
            return False
        cur.execute(
            """
            INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
            SET weight = EXCLUDED.weight
            """,
            (source_row["id"], target_row["id"], relation_type, edge_weight),
        )

    invalidate_runtime_taxonomy_cache()
    return True


def update_genre_external_metadata(
    slug: str,
    *,
    musicbrainz_mbid: str | None = None,
    wikidata_entity_id: str | None = None,
    wikidata_url: str | None = None,
    external_description: str | None = None,
    external_description_source: str | None = None,
) -> bool:
    slug = (slug or "").strip().lower()
    if not slug:
        return False

    fields: list[str] = []
    values: list[object] = []
    if musicbrainz_mbid is not None:
        fields.append("musicbrainz_mbid = %s")
        values.append((musicbrainz_mbid or "").strip() or None)
    if wikidata_entity_id is not None:
        fields.append("wikidata_entity_id = %s")
        values.append((wikidata_entity_id or "").strip() or None)
    if wikidata_url is not None:
        fields.append("wikidata_url = %s")
        values.append((wikidata_url or "").strip() or None)
    if external_description is not None:
        fields.append("external_description = %s")
        values.append((external_description or "").strip())
    if external_description_source is not None:
        fields.append("external_description_source = %s")
        values.append((external_description_source or "").strip())
    if not fields:
        return False

    values.append(slug)
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE genre_taxonomy_nodes SET {', '.join(fields)} WHERE slug = %s",
            values,
        )
        changed = cur.rowcount > 0
    if changed:
        invalidate_runtime_taxonomy_cache()
    return changed
