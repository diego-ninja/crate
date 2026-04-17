"""Cache layer: L1 in-memory (process-local) + L2 Redis."""

import json
import os
import time
import logging
from typing import Any

log = logging.getLogger(__name__)

# ── L1: In-memory cache with TTL ──────────────────────────────────

_mem_cache: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)
_MEM_TTL = 300  # seconds for L1
_MEM_MAX_SIZE = 10000  # evict oldest when exceeded


def _mem_get(key: str) -> Any | None:
    entry = _mem_cache.get(key)
    if entry and entry[0] > time.time():
        return entry[1]
    if entry:
        del _mem_cache[key]
    return None


def _mem_set(key: str, value: Any, ttl: int = _MEM_TTL):
    if len(_mem_cache) >= _MEM_MAX_SIZE:
        # Evict oldest 20%
        sorted_keys = sorted(_mem_cache, key=lambda k: _mem_cache[k][0])
        for k in sorted_keys[:_MEM_MAX_SIZE // 5]:
            del _mem_cache[k]
    _mem_cache[key] = (time.time() + ttl, value)


def _mem_delete(key: str):
    _mem_cache.pop(key, None)


# ── L2: Redis ─────────────────────────────────────────────────────

_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis as _redis
        url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            _redis_client = _redis.from_url(url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)
            _redis_client.ping()
            log.info("Redis connected: %s", url)
        except Exception as e:
            log.warning("Redis not available (%s), falling back to PostgreSQL: %s", url, e)
            _redis_client = None
    return _redis_client


# ── Public API (same interface as before) ─────────────────────────

def get_cache(key: str, max_age_seconds: int | None = None) -> Any | None:
    """Get cached value. Returns None if not found or expired."""
    # L1
    val = _mem_get(key)
    if val is not None:
        return val

    # L2: Redis
    r = _get_redis()
    if r:
        try:
            raw = r.get(f"cache:{key}")
            if raw is not None:
                val = json.loads(raw)
                _mem_set(key, val)
                return val
        except Exception:
            log.debug("Redis get failed for %s", key)

    # L3: PostgreSQL fallback (for migration period)
    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone
        with transaction_scope() as session:
            row = session.execute(text("SELECT value_json, updated_at FROM cache WHERE key = :key"), {"key": key}).mappings().first()
            if not row:
                return None
            if max_age_seconds is not None:
                try:
                    updated = datetime.fromisoformat(row["updated_at"])
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    age = (datetime.now(timezone.utc) - updated).total_seconds()
                    if age > max_age_seconds:
                        return None
                except (ValueError, TypeError):
                    return None
            val = row["value_json"]
            # Promote to Redis
            if r and val is not None:
                try:
                    ttl = max_age_seconds or 86400
                    r.setex(f"cache:{key}", ttl, json.dumps(val))
                except Exception:
                    pass
            _mem_set(key, val)
            return val
    except Exception:
        return None


def set_cache(key: str, value: Any, ttl: int | None = None):
    """Set cached value with optional TTL in seconds."""
    # L1
    _mem_set(key, value, min(ttl or 86400, 300))  # L1 max 5 min

    # L2: Redis (with TTL)
    r = _get_redis()
    if r:
        try:
            redis_ttl = ttl or 86400  # default 24h
            r.setex(f"cache:{key}", redis_ttl, json.dumps(value, default=str))
            return
        except Exception:
            log.debug("Redis set failed for %s", key)

    # Fallback: PostgreSQL
    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text("INSERT INTO cache (key, value_json, updated_at) VALUES (:key, :value_json, :updated_at) "
                     "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at"),
                {"key": key, "value_json": json.dumps(value, default=str), "updated_at": now},
            )
    except Exception:
        log.debug("Cache set failed for %s", key)


def delete_cache(key: str):
    """Delete a cached value."""
    _mem_delete(key)

    r = _get_redis()
    if r:
        try:
            r.delete(f"cache:{key}")
        except Exception:
            pass

    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        with transaction_scope() as session:
            session.execute(text("DELETE FROM cache WHERE key = :key"), {"key": key})
    except Exception:
        pass


def delete_cache_prefix(prefix: str):
    """Delete all cached values matching a prefix."""
    # Clear L1
    to_delete = [k for k in _mem_cache if k.startswith(prefix)]
    for k in to_delete:
        del _mem_cache[k]

    # Redis: use SCAN to find matching keys
    r = _get_redis()
    if r:
        try:
            cursor = 0
            while True:
                cursor, keys = r.scan(cursor, match=f"cache:{prefix}*", count=100)
                if keys:
                    r.delete(*keys)
                if cursor == 0:
                    break
        except Exception:
            pass

    # PostgreSQL fallback
    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        with transaction_scope() as session:
            session.execute(text("DELETE FROM cache WHERE key LIKE :prefix"), {"prefix": prefix + "%"})
    except Exception:
        pass


# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        row = session.execute(text("SELECT value FROM settings WHERE key = :key"), {"key": key}).mappings().first()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value"),
            {"key": key, "value": value},
        )


# ── MB Cache (also migrate to Redis) ─────────────────────────────

def get_mb_cache(key: str) -> Any | None:
    """Get MusicBrainz cache (no TTL — eternal)."""
    val = _mem_get(f"mb:{key}")
    if val is not None:
        return val

    r = _get_redis()
    if r:
        try:
            raw = r.get(f"mb:{key}")
            if raw is not None:
                val = json.loads(raw)
                _mem_set(f"mb:{key}", val, ttl=3600)
                return val
        except Exception:
            pass

    # PostgreSQL fallback
    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        with transaction_scope() as session:
            row = session.execute(text("SELECT value_json FROM mb_cache WHERE key = :key"), {"key": key}).mappings().first()
            if row:
                val = row["value_json"]
                if isinstance(val, str):
                    val = json.loads(val)
                if r:
                    try: r.set(f"mb:{key}", json.dumps(val, default=str))
                    except Exception: pass
                _mem_set(f"mb:{key}", val, ttl=3600)
                return val
    except Exception:
        pass
    return None


def set_mb_cache(key: str, value: Any):
    """Set MusicBrainz cache (eternal in Redis, no TTL)."""
    _mem_set(f"mb:{key}", value, ttl=3600)

    r = _get_redis()
    if r:
        try:
            r.set(f"mb:{key}", json.dumps(value, default=str))
            return
        except Exception:
            pass

    try:
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text("INSERT INTO mb_cache (key, value_json, created_at) VALUES (:key, :value_json, :created_at) "
                     "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json"),
                {"key": key, "value_json": json.dumps(value, default=str), "created_at": now},
            )
    except Exception:
        pass


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        row = session.execute(text("SELECT mtime, data_json FROM dir_mtimes WHERE path = :path"), {"path": path}).mappings().first()
    if not row:
        return None
    data = row["data_json"]
    if isinstance(data, str):
        data = json.loads(data)
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        data_json = json.dumps(data) if data is not None else None
        session.execute(
            text("INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (:path, :mtime, :data_json) "
                 "ON CONFLICT(path) DO UPDATE SET mtime = EXCLUDED.mtime, data_json = EXCLUDED.data_json"),
            {"path": path, "mtime": mtime, "data_json": data_json},
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        if prefix:
            rows = session.execute(
                text("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE :prefix"),
                {"prefix": prefix + "%"},
            ).mappings().all()
        else:
            rows = session.execute(text("SELECT path, mtime, data_json FROM dir_mtimes")).mappings().all()
    result = {}
    for row in rows:
        data = row["data_json"]
        if isinstance(data, str):
            data = json.loads(data)
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        session.execute(text("DELETE FROM dir_mtimes WHERE path = :path"), {"path": path})


# ── Cache stats ───────────────────────────────────────────────────

def get_cache_stats() -> dict:
    """Get cache statistics."""
    stats = {"l1_size": len(_mem_cache)}
    r = _get_redis()
    if r:
        try:
            info = r.info("memory")
            stats["redis_used_memory"] = info.get("used_memory_human", "?")
            stats["redis_keys"] = r.dbsize()
            stats["redis_connected"] = True
        except Exception:
            stats["redis_connected"] = False
    else:
        stats["redis_connected"] = False
    return stats


def clear_all_cache_tables():
    """Delete all rows from cache and mb_cache tables."""
    from crate.db.tx import transaction_scope
    from sqlalchemy import text
    with transaction_scope() as session:
        session.execute(text("DELETE FROM cache"))
        session.execute(text("DELETE FROM mb_cache"))
