"""Explicit transaction boundaries for the Crate data layer.

Today every helper in ``db/*.py`` opens its own ``get_db_ctx()`` context,
which means each function is its own transaction. That works when
operations are independent, but breaks down the moment you need two
writes to either both commit or both roll back (e.g. "create user then
create session").

``transaction_scope()`` is the entry point for new code that wants an
explicit transaction. Right now it delegates to ``get_db_ctx()`` (which
already provides commit-on-exit / rollback-on-exception). The value of
going through ``transaction_scope()`` rather than ``get_db_ctx()``
directly is:

  1. **Signal of intent** — callers document "this is a transaction
     boundary" rather than "I need a cursor".
  2. **Single refactor target** — when SQLAlchemy replaces the pool,
     only this function changes. Call sites stay the same.
  3. **Composability prep** — helpers that accept ``cur`` as a
     parameter can be called inside one ``transaction_scope()`` block
     for a single commit.

For migration convenience, helpers that today call ``get_db_ctx()``
internally can be given an optional ``cur`` parameter::

    def create_user(email, password, *, cur=None):
        if cur is None:
            with transaction_scope() as cur:
                return _create_user_impl(cur, email, password)
        return _create_user_impl(cur, email, password)

This lets callers compose without breaking existing call sites.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from crate.db.core import get_db_ctx


@contextmanager
def transaction_scope() -> Generator:
    """Open a single DB transaction.

    Yields a ``psycopg2.extras.RealDictCursor``. Commits on clean exit,
    rolls back on exception. Identical to ``get_db_ctx()`` today but
    with stronger semantic guarantees going forward.

    Usage::

        with transaction_scope() as cur:
            cur.execute("INSERT INTO ...", (...,))
            cur.execute("UPDATE ...", (...,))
            # auto-committed here
    """
    with get_db_ctx() as cur:
        yield cur
