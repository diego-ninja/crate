from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


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
        text(
            """
            INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
            VALUES (:source_id, :target_id, :relation_type, :weight)
            ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
            SET weight = EXCLUDED.weight
            """
        ),
        {
            "source_id": source_row["id"],
            "target_id": target_row["id"],
            "relation_type": relation_type,
            "weight": edge_weight,
        },
    )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return True


__all__ = ["upsert_genre_taxonomy_edge"]
