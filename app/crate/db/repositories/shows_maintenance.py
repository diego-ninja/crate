from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def delete_past_shows(days_old: int = 30) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).date()
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM shows WHERE date < :cutoff"),
            {"cutoff": cutoff},
        )
    return int(result.rowcount or 0)


__all__ = ["delete_past_shows"]
