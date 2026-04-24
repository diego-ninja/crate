"""Generic cache storage helpers backed by L1, Redis, and PostgreSQL."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.cache_runtime import _get_redis, _mem_cache, _mem_delete, _mem_get, _mem_set
from crate.db.tx import read_scope, transaction_scope


def get_cache(key: str, max_age_seconds: int | None = None) -> Any | None:
    val = _mem_get(key)
    if val is not None:
        return val

    redis_client = _get_redis()
    if redis_client:
        try:
            raw = redis_client.get(f"cache:{key}")
            if raw is not None:
                val = json.loads(raw)
                _mem_set(key, val)
                return val
        except Exception:
            pass

    try:
        with read_scope() as session:
            row = session.execute(
                text("SELECT value_json, updated_at FROM cache WHERE key = :key"),
                {"key": key},
            ).mappings().first()
            if not row:
                return None
            if max_age_seconds is not None:
                try:
                    updated = row["updated_at"]
                    if isinstance(updated, str):
                        updated = datetime.fromisoformat(updated)
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    age = (datetime.now(timezone.utc) - updated).total_seconds()
                    if age > max_age_seconds:
                        return None
                except (ValueError, TypeError):
                    return None
            val = row["value_json"]
            if redis_client and val is not None:
                try:
                    redis_ttl = max_age_seconds or 86400
                    redis_client.setex(f"cache:{key}", redis_ttl, json.dumps(val))
                except Exception:
                    pass
            _mem_set(key, val)
            return val
    except Exception:
        return None


def set_cache(key: str, value: Any, ttl: int | None = None) -> None:
    _mem_set(key, value, min(ttl or 86400, 300))

    redis_client = _get_redis()
    if redis_client:
        try:
            redis_ttl = ttl or 86400
            redis_client.setex(f"cache:{key}", redis_ttl, json.dumps(value, default=str))
            return
        except Exception:
            pass

    try:
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO cache (key, value_json, updated_at) VALUES (:key, :value_json, :updated_at) "
                    "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at"
                ),
                {"key": key, "value_json": json.dumps(value, default=str), "updated_at": now},
            )
    except Exception:
        pass


def delete_cache(key: str) -> None:
    _mem_delete(key)

    redis_client = _get_redis()
    if redis_client:
        try:
            redis_client.delete(f"cache:{key}")
        except Exception:
            pass

    try:
        with transaction_scope() as session:
            session.execute(text("DELETE FROM cache WHERE key = :key"), {"key": key})
    except Exception:
        pass


def delete_cache_prefix(prefix: str) -> None:
    to_delete = [key for key in _mem_cache if key.startswith(prefix)]
    for key in to_delete:
        del _mem_cache[key]

    redis_client = _get_redis()
    if redis_client:
        try:
            cursor = 0
            while True:
                cursor, keys = redis_client.scan(cursor, match=f"cache:{prefix}*", count=100)
                if keys:
                    redis_client.delete(*keys)
                if cursor == 0:
                    break
        except Exception:
            pass

    try:
        with transaction_scope() as session:
            session.execute(text("DELETE FROM cache WHERE key LIKE :prefix"), {"prefix": prefix + "%"})
    except Exception:
        pass


def get_cache_stats() -> dict:
    stats = {"l1_size": len(_mem_cache)}
    redis_client = _get_redis()
    if redis_client:
        try:
            info = redis_client.info("memory")
            stats["redis_used_memory"] = info.get("used_memory_human", "?")
            stats["redis_keys"] = redis_client.dbsize()
            stats["redis_connected"] = True
        except Exception:
            stats["redis_connected"] = False
    else:
        stats["redis_connected"] = False
    return stats


def clear_all_cache_tables() -> None:
    with transaction_scope() as session:
        session.execute(text("DELETE FROM cache"))
        session.execute(text("DELETE FROM mb_cache"))


__all__ = [
    "clear_all_cache_tables",
    "delete_cache",
    "delete_cache_prefix",
    "get_cache",
    "get_cache_stats",
    "set_cache",
]
