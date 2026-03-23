"""Cache layer: L1 in-memory (process-local) + L2 Redis."""

import json
import os
import time
import logging
from typing import Any

log = logging.getLogger(__name__)

# ── L1: In-memory cache with TTL ──────────────────────────────────

_mem_cache: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)
_MEM_TTL = 60  # seconds for L1
_MEM_MAX_SIZE = 2000  # evict oldest when exceeded


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
        from musicdock.db.core import get_db_ctx
        from datetime import datetime, timezone
        with get_db_ctx() as cur:
            cur.execute("SELECT value_json, updated_at FROM cache WHERE key = %s", (key,))
            row = cur.fetchone()
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
        from musicdock.db.core import get_db_ctx
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with get_db_ctx() as cur:
            cur.execute(
                "INSERT INTO cache (key, value_json, updated_at) VALUES (%s, %s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at",
                (key, json.dumps(value, default=str), now),
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
        from musicdock.db.core import get_db_ctx
        with get_db_ctx() as cur:
            cur.execute("DELETE FROM cache WHERE key = %s", (key,))
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
        from musicdock.db.core import get_db_ctx
        with get_db_ctx() as cur:
            cur.execute("DELETE FROM cache WHERE key LIKE %s", (prefix + "%",))
    except Exception:
        pass


# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
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
        from musicdock.db.core import get_db_ctx
        with get_db_ctx() as cur:
            cur.execute("SELECT value_json FROM mb_cache WHERE key = %s", (key,))
            row = cur.fetchone()
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
        from musicdock.db.core import get_db_ctx
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with get_db_ctx() as cur:
            cur.execute(
                "INSERT INTO mb_cache (key, value_json, created_at) VALUES (%s, %s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json",
                (key, json.dumps(value, default=str), now),
            )
    except Exception:
        pass


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("SELECT mtime, data_json FROM dir_mtimes WHERE path = %s", (path,))
        row = cur.fetchone()
    if not row:
        return None
    data = row["data_json"]
    if isinstance(data, str):
        data = json.loads(data)
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        data_json = json.dumps(data) if data is not None else None
        cur.execute(
            "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (%s, %s, %s) "
            "ON CONFLICT(path) DO UPDATE SET mtime = EXCLUDED.mtime, data_json = EXCLUDED.data_json",
            (path, mtime, data_json),
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        if prefix:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE %s", (prefix + "%",))
        else:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes")
        rows = cur.fetchall()
    result = {}
    for row in rows:
        data = row["data_json"]
        if isinstance(data, str):
            data = json.loads(data)
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    from musicdock.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM dir_mtimes WHERE path = %s", (path,))


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
