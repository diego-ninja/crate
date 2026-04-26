from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


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
    "set_genre_eq_gains",
    "update_genre_external_metadata",
]
