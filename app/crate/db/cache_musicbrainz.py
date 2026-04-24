"""MusicBrainz cache helpers backed by L1, Redis, and PostgreSQL."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.cache_runtime import _get_redis, _mem_get, _mem_set
from crate.db.tx import read_scope, transaction_scope


def get_mb_cache(key: str) -> Any | None:
    cache_key = f"mb:{key}"
    val = _mem_get(cache_key)
    if val is not None:
        return val

    redis_client = _get_redis()
    if redis_client:
        try:
            raw = redis_client.get(cache_key)
            if raw is not None:
                val = json.loads(raw)
                _mem_set(cache_key, val, ttl=3600)
                return val
        except Exception:
            pass

    try:
        with read_scope() as session:
            row = session.execute(text("SELECT value_json FROM mb_cache WHERE key = :key"), {"key": key}).mappings().first()
            if row:
                val = row["value_json"]
                if isinstance(val, str):
                    val = json.loads(val)
                if redis_client:
                    try:
                        redis_client.set(cache_key, json.dumps(val, default=str))
                    except Exception:
                        pass
                _mem_set(cache_key, val, ttl=3600)
                return val
    except Exception:
        pass
    return None


def set_mb_cache(key: str, value: Any) -> None:
    cache_key = f"mb:{key}"
    _mem_set(cache_key, value, ttl=3600)

    redis_client = _get_redis()
    if redis_client:
        try:
            redis_client.set(cache_key, json.dumps(value, default=str))
            return
        except Exception:
            pass

    try:
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO mb_cache (key, value_json, created_at) VALUES (:key, :value_json, :created_at) "
                    "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json"
                ),
                {"key": key, "value_json": json.dumps(value, default=str), "created_at": now},
            )
    except Exception:
        pass


__all__ = ["get_mb_cache", "set_mb_cache"]
