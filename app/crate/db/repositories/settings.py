"""Settings repository — the first ORM-backed repository in Crate.

Replaces the raw-SQL ``get_setting`` / ``set_setting`` functions with
typed Session-based operations. The pattern established here applies
to every future repository:

  1. Functions accept a ``Session`` (from ``transaction_scope()``).
  2. They return Pydantic models (from ``db/models/``), not dicts.
  3. Writes go through the ORM model (from ``db/orm/``).
  4. The caller controls the transaction boundary.

For backward compatibility, each function also works standalone
(opens its own session if none is passed). This lets us migrate
callers one by one without a big bang.
"""

from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from crate.db.tx import transaction_scope


def get_setting(key: str, default: str | None = None, *, session: Session | None = None) -> str | None:
    """Read a setting value by key. Returns ``default`` if not found."""
    def _impl(s: Session) -> str | None:
        row = s.execute(
            text("SELECT value FROM settings WHERE key = :key"),
            {"key": key},
        ).mappings().first()
        return row["value"] if row else default

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)


def set_setting(key: str, value: str | None, *, session: Session | None = None) -> None:
    """Upsert a setting. Passing ``value=None`` stores NULL."""
    def _impl(s: Session) -> None:
        s.execute(
            text(
                "INSERT INTO settings (key, value) VALUES (:key, :value) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
            ),
            {"key": key, "value": value},
        )

    if session is not None:
        _impl(session)
    else:
        with transaction_scope() as s:
            _impl(s)


def get_all_settings(*, session: Session | None = None) -> dict[str, str | None]:
    """Return all settings as a {key: value} dict."""
    def _impl(s: Session) -> dict[str, str | None]:
        rows = s.execute(text("SELECT key, value FROM settings")).mappings().all()
        return {row["key"]: row["value"] for row in rows}

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)
