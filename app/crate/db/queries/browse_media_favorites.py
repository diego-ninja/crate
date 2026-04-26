from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def list_favorites() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("SELECT item_type, item_id, created_at FROM favorites ORDER BY created_at DESC")).mappings().all()
        return [dict(row) for row in rows]


def add_favorite(item_type: str, item_id: str, created_at: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO favorites (item_type, item_id, created_at) VALUES (:item_type, :item_id, :created_at) ON CONFLICT DO NOTHING"),
            {"item_type": item_type, "item_id": item_id, "created_at": created_at},
        )


def remove_favorite(item_type: str, item_id: str) -> None:
    with transaction_scope() as session:
        session.execute(text("DELETE FROM favorites WHERE item_id = :item_id AND item_type = :item_type"), {"item_id": item_id, "item_type": item_type})


__all__ = [
    "add_favorite",
    "list_favorites",
    "remove_favorite",
]
