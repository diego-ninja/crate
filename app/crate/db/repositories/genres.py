import re

from sqlalchemy import text

from crate.db.queries.genres import list_invalid_genre_taxonomy_nodes
from crate.db.tx import transaction_scope
from crate.genre_taxonomy import (
    invalidate_runtime_taxonomy_cache_after_commit,
    slugify_genre,
)


def _slugify(name: str) -> str:
    return slugify_genre(name)


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


def upsert_genre_taxonomy_node(
    slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    is_top_level: bool = False,
    musicbrainz_mbid: str | None = None,
    session=None,
) -> dict | None:
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
            return upsert_genre_taxonomy_node(
                slug,
                name=name,
                description=description,
                is_top_level=is_top_level,
                musicbrainz_mbid=musicbrainz_mbid,
                session=s,
            )
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
            {
                "slug": candidate_slug,
                "name": candidate_name,
                "description": candidate_description,
                "is_top_level": bool(is_top_level),
                "mbid": mbid,
            },
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
            return upsert_genre_taxonomy_edge(
                source_slug,
                target_slug,
                relation_type=relation_type,
                weight=weight,
                session=s,
            )
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
        {
            "source_id": source_row["id"],
            "target_id": target_row["id"],
            "relation_type": relation_type,
            "weight": edge_weight,
        },
    )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return True


def set_genre_eq_gains(slug: str, gains: list[float] | None, *, reasoning: str | None = None, session=None) -> None:
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
                slug,
                musicbrainz_mbid=musicbrainz_mbid,
                wikidata_entity_id=wikidata_entity_id,
                wikidata_url=wikidata_url,
                external_description=external_description,
                external_description_source=external_description_source,
                session=s,
            )
    result = session.execute(
        text(f"UPDATE genre_taxonomy_nodes SET {', '.join(fields)} WHERE slug = :slug"),
        params,
    )
    changed = result.rowcount > 0
    if changed:
        invalidate_runtime_taxonomy_cache_after_commit(session)
    return changed


__all__ = [
    "cleanup_invalid_genre_taxonomy_nodes",
    "get_or_create_genre",
    "set_artist_genres",
    "set_album_genres",
    "set_genre_eq_gains",
    "update_genre_external_metadata",
    "upsert_genre_taxonomy_edge",
    "upsert_genre_taxonomy_node",
]
