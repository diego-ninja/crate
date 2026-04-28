"""In-memory cache for session and user lookups in the auth middleware.

Eliminates 2-3 DB queries per request. TTL-based, invalidated on
logout/session revoke/user update. Thread-safe via GIL (single
dict operations are atomic in CPython).
"""

import time

_SESSION_TTL = 10  # seconds
_USER_TTL = 10     # seconds
_TOUCH_INTERVAL = 60  # seconds — batch session touch writes

# {session_id: (monotonic_time, session_dict)}
_session_cache: dict[str, tuple[float, dict]] = {}
# {user_id: (monotonic_time, user_dict)}
_user_cache: dict[int, tuple[float, dict]] = {}
# {session_id: monotonic_time} — last time we wrote touch_session to DB
_touch_buffer: dict[str, float] = {}


def get_cached_session(session_id: str) -> dict | None:
    """Get session from cache or DB. Returns None if not found."""
    entry = _session_cache.get(session_id)
    now = time.monotonic()
    if entry and (now - entry[0]) < _SESSION_TTL:
        return entry[1]

    from crate.db.repositories.auth import get_session
    session = get_session(session_id)
    if session:
        _session_cache[session_id] = (now, session)
    return session


def get_cached_user(user_id: int) -> dict | None:
    """Get user from cache or DB. Returns None if not found."""
    entry = _user_cache.get(user_id)
    now = time.monotonic()
    if entry and (now - entry[0]) < _USER_TTL:
        return entry[1]

    from crate.db.repositories.auth import get_user_by_id
    user = get_user_by_id(user_id)
    if user:
        _user_cache[user_id] = (now, user)
    return user


def should_touch_session(session_id: str) -> bool:
    """Return True if enough time has passed to write a touch update."""
    now = time.monotonic()
    last = _touch_buffer.get(session_id, 0)
    if (now - last) > _TOUCH_INTERVAL:
        _touch_buffer[session_id] = now
        return True
    return False


def invalidate_session(session_id: str):
    """Call on logout/revoke to clear the cache immediately."""
    _session_cache.pop(session_id, None)
    _touch_buffer.pop(session_id, None)


def invalidate_user(user_id: int):
    """Call on user update to clear the cache immediately."""
    _user_cache.pop(user_id, None)
