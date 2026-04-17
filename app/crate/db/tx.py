"""Explicit transaction boundaries for the Crate data layer.

``transaction_scope()`` is the canonical way to get a database
connection for new code. It yields a SQLAlchemy ``Session`` with
automatic commit/rollback semantics:

    with transaction_scope() as session:
        session.execute(text("INSERT INTO ..."), {...})
        # auto-committed here

For code that still needs a raw psycopg2 cursor (legacy functions in
``db/*.py`` that haven't been migrated yet), ``legacy_cursor_scope()``
wraps ``get_db_ctx()`` with the same interface contract.

Both are context managers that commit on clean exit and roll back on
exception. The caller never calls ``commit()`` or ``rollback()``
directly.
"""

import logging
from contextlib import contextmanager

from crate.db.engine import get_session_factory
from crate.db.core import get_db_ctx

log = logging.getLogger(__name__)


@contextmanager
def transaction_scope():
    """Open a SQLAlchemy Session with automatic commit/rollback.

    Yields a ``sqlalchemy.orm.Session``. Commits on clean exit, rolls
    back on exception. The session is closed after the block regardless.

    Usage::

        with transaction_scope() as session:
            session.execute(text("UPDATE users SET name = :n WHERE id = :id"), {"n": "X", "id": 1})
            # auto-committed here
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def legacy_cursor_scope():
    """Compat wrapper around ``get_db_ctx()`` for legacy code.

    Yields a raw psycopg2 ``RealDictCursor``. Same commit/rollback
    contract as ``transaction_scope()`` but using the legacy pool.

    Prefer ``transaction_scope()`` for all new code.
    """
    with get_db_ctx() as cur:
        yield cur
