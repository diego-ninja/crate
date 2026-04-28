from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_relationship_state(viewer_user_id: int, target_user_id: int) -> dict:
    if viewer_user_id == target_user_id:
        return {
            "following": False,
            "followed_by": False,
            "is_friend": False,
        }
    with read_scope() as session:
        row = dict(
            session.execute(
                text(
                    """
                    SELECT
                        EXISTS(
                            SELECT 1 FROM user_relationships
                            WHERE follower_user_id = :viewer AND followed_user_id = :target
                        ) AS following,
                        EXISTS(
                            SELECT 1 FROM user_relationships
                            WHERE follower_user_id = :target AND followed_user_id = :viewer
                        ) AS followed_by
                    """
                ),
                {"viewer": viewer_user_id, "target": target_user_id},
            ).mappings().first()
            or {}
        )
    row["is_friend"] = bool(row.get("following") and row.get("followed_by"))
    return row


__all__ = ["get_relationship_state"]
