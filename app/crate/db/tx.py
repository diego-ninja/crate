"""Explicit transaction boundaries for the Crate data layer.

``transaction_scope()`` is the canonical way for runtime code to talk
to PostgreSQL. It yields a SQLAlchemy ``Session`` with automatic
commit/rollback semantics:

    with transaction_scope() as session:
        session.execute(text("INSERT INTO ..."), {...})
        # auto-committed here

Legacy psycopg2 bootstrap still lives in ``db.core``, but this module
no longer exposes a cursor-based compatibility wrapper. New runtime
code should always compose around ``Session``.
"""

import logging
from collections.abc import Callable
from contextlib import contextmanager

from sqlalchemy import event

from crate.db.engine import get_session_factory

log = logging.getLogger(__name__)

_AFTER_COMMIT_CALLBACKS_KEY = "_after_commit_callbacks"
_AFTER_COMMIT_HOOKS_KEY = "_after_commit_hooks_registered"


def _run_after_commit_callbacks(session) -> None:
    callbacks = session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, [])
    for callback in callbacks:
        try:
            callback()
        except Exception:
            log.exception("Post-commit callback failed")


def _clear_after_commit_callbacks(session, *_args) -> None:
    session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, None)


def register_after_commit(session, callback: Callable[[], None]) -> None:
    """Register a callback that runs only after this Session commits.

    The callback is discarded on rollback. This keeps side effects like
    task dispatch aligned with the transaction that created the row.
    """
    callbacks = session.info.setdefault(_AFTER_COMMIT_CALLBACKS_KEY, [])
    callbacks.append(callback)

    if session.info.get(_AFTER_COMMIT_HOOKS_KEY):
        return

    # propagate=False keeps the listener on this session instance only.
    # The listener fires once per session lifecycle and is discarded
    # when the session is garbage-collected, preventing accumulation.
    event.listen(session, "after_commit", _run_after_commit_callbacks, propagate=False)
    event.listen(session, "after_rollback", _clear_after_commit_callbacks, propagate=False)
    event.listen(session, "after_soft_rollback", _clear_after_commit_callbacks, propagate=False)
    session.info[_AFTER_COMMIT_HOOKS_KEY] = True


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
def optional_scope(session=None):
    """Reuse a caller's session when provided, otherwise open a new one.

    This is the composability primitive: functions that accept an
    optional ``session`` keyword use this to avoid opening a redundant
    transaction when a caller already has one open.

    Usage::

        def my_function(arg, *, session=None):
            with optional_scope(session) as s:
                s.execute(text("..."))
    """
    if session is not None:
        yield session
        return
    with transaction_scope() as managed:
        yield managed


@contextmanager
def read_scope():
    """Open a read-only Session that rolls back on exit.

    Use for SELECT queries that don't need a commit. This avoids
    holding a write-transaction lock for the duration of the block,
    reducing contention under concurrent load.

    Usage::

        with read_scope() as session:
            rows = session.execute(text("SELECT ...")).mappings().all()
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
