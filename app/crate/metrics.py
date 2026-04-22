"""Metrics collection and query.

Hot path: record() stores samples in Redis hash buckets (minute granularity, 48h TTL).
Cold path: flush_to_postgres() rolls up into hourly/daily aggregates in PostgreSQL.
Query: read from Redis (recent) or PostgreSQL (historical).
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_REDIS_PREFIX = "crate:metrics"
_BUCKET_TTL = 48 * 3600  # 48 hours


def _minute_bucket(ts: float | None = None) -> int:
    """Return the minute-aligned Unix timestamp."""
    t = int(ts or time.time())
    return t - (t % 60)


def _bucket_key(name: str, minute_ts: int) -> str:
    return f"{_REDIS_PREFIX}:{name}:{minute_ts}"


# ── Recording ────────────────────────────────────────────────────

def record(name: str, value: float, tags: dict | None = None):
    """Record a metric sample. Must be fast (<1ms)."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r is None:
            return

        bucket_ts = _minute_bucket()
        key = _bucket_key(name, bucket_ts)

        pipe = r.pipeline(transaction=False)
        pipe.hincrby(key, "count", 1)
        pipe.hincrbyfloat(key, "sum", value)

        # Track min/max via Lua for atomicity
        pipe.eval(
            """
            local key = KEYS[1]
            local val = tonumber(ARGV[1])
            local cur_min = tonumber(redis.call('hget', key, 'min'))
            local cur_max = tonumber(redis.call('hget', key, 'max'))
            if cur_min == nil or val < cur_min then
                redis.call('hset', key, 'min', val)
            end
            if cur_max == nil or val > cur_max then
                redis.call('hset', key, 'max', val)
            end
            """,
            1, key, str(value),
        )
        pipe.expire(key, _BUCKET_TTL)

        # Store tags as JSON if present (once per key)
        if tags:
            tags_key = f"{key}:tags"
            pipe.set(tags_key, json.dumps(tags, separators=(",", ":")), ex=_BUCKET_TTL, nx=True)

        pipe.execute()
    except Exception:
        # Metrics must never break the hot path
        pass


def record_counter(name: str, tags: dict | None = None):
    """Shorthand for counter-style metrics (value=1)."""
    record(name, 1.0, tags)


# ── Querying ─────────────────────────────────────────────────────

def query_recent(name: str, minutes: int = 60) -> list[dict]:
    """Read minute-granularity buckets from Redis for the last N minutes."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r is None:
            return []

        now_bucket = _minute_bucket()
        results = []
        pipe = r.pipeline(transaction=False)
        buckets = [now_bucket - i * 60 for i in range(minutes)]

        for bucket_ts in reversed(buckets):
            pipe.hgetall(_bucket_key(name, bucket_ts))

        raw_results = pipe.execute()
        for i, data in enumerate(raw_results):
            if not data:
                continue
            bucket_ts = buckets[len(buckets) - 1 - i]
            count = int(data.get(b"count", data.get("count", 0)))
            total = float(data.get(b"sum", data.get("sum", 0)))
            results.append({
                "timestamp": datetime.fromtimestamp(bucket_ts, tz=timezone.utc).isoformat(),
                "count": count,
                "avg": round(total / count, 2) if count > 0 else 0,
                "min": round(float(data.get(b"min", data.get("min", 0))), 2),
                "max": round(float(data.get(b"max", data.get("max", 0))), 2),
                "sum": round(total, 2),
            })
        return results
    except Exception:
        log.debug("Failed to query recent metrics", exc_info=True)
        return []


def query_summary(name: str, minutes: int = 5) -> dict:
    """Aggregate summary of last N minutes."""
    buckets = query_recent(name, minutes)
    if not buckets:
        return {"count": 0, "avg": 0, "min": 0, "max": 0, "sum": 0}

    total_count = sum(b["count"] for b in buckets)
    total_sum = sum(b["sum"] for b in buckets)
    all_min = min((b["min"] for b in buckets if b["count"] > 0), default=0)
    all_max = max((b["max"] for b in buckets if b["count"] > 0), default=0)

    return {
        "count": total_count,
        "avg": round(total_sum / total_count, 2) if total_count > 0 else 0,
        "min": all_min,
        "max": all_max,
        "sum": round(total_sum, 2),
    }


# ── Flush to PostgreSQL ──────────────────────────────────────────

def flush_to_postgres(period: str = "hour"):
    """Roll up Redis minute-buckets into PostgreSQL hourly/daily rows.

    Called by the worker service loop every 5 minutes.
    """
    try:
        from crate.db.cache import _get_redis
        from crate.db.management import upsert_metric_rollup

        r = _get_redis()
        if r is None:
            return

        # Find all metric keys in Redis
        cursor = 0
        pattern = f"{_REDIS_PREFIX}:*"
        processed = 0

        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=200)
            for key_bytes in keys:
                key = key_bytes.decode() if isinstance(key_bytes, bytes) else key_bytes
                # Skip tag keys
                if key.endswith(":tags"):
                    continue

                parts = key.split(":")
                if len(parts) < 4:
                    continue

                name = parts[2]
                try:
                    bucket_ts = int(parts[3])
                except (ValueError, IndexError):
                    continue

                # Only flush buckets older than 10 minutes
                if bucket_ts > _minute_bucket() - 600:
                    continue

                data = r.hgetall(key)
                if not data:
                    continue

                count = int(data.get(b"count", data.get("count", 0)))
                total = float(data.get(b"sum", data.get("sum", 0)))
                min_val = float(data.get(b"min", data.get("min", 0)))
                max_val = float(data.get(b"max", data.get("max", 0)))
                avg_val = total / count if count > 0 else 0

                # Read tags
                tags_raw = r.get(f"{key}:tags")
                tags_json = tags_raw.decode() if isinstance(tags_raw, bytes) else (tags_raw or "{}")

                # Compute hour bucket
                hour_ts = bucket_ts - (bucket_ts % 3600)
                bucket_start = datetime.fromtimestamp(hour_ts, tz=timezone.utc).isoformat()

                upsert_metric_rollup(
                    name=name,
                    tags_json=tags_json,
                    period=period,
                    bucket_start=bucket_start,
                    count=count,
                    sum_value=total,
                    min_value=min_val,
                    max_value=max_val,
                    avg_value=avg_val,
                )
                processed += 1

            if cursor == 0:
                break

        if processed > 0:
            log.debug("Flushed %d metric buckets to PostgreSQL", processed)

    except Exception:
        log.warning("Metrics flush to PostgreSQL failed", exc_info=True)


def query_historical(name: str, period: str = "hour", start: str | None = None, end: str | None = None, limit: int = 168) -> list[dict]:
    """Read rollup data from PostgreSQL."""
    try:
        from crate.db.management import query_metric_rollups

        rows = query_metric_rollups(name=name, period=period, start=start, end=end, limit=limit)
        return [
            {
                "timestamp": row["bucket_start"].isoformat() if hasattr(row["bucket_start"], "isoformat") else str(row["bucket_start"]),
                "count": row["count"],
                "avg": round(float(row["avg_value"] or 0), 2),
                "min": round(float(row["min_value"] or 0), 2),
                "max": round(float(row["max_value"] or 0), 2),
                "sum": round(float(row["sum_value"] or 0), 2),
            }
            for row in reversed(rows)
        ]
    except Exception:
        log.debug("Failed to query historical metrics", exc_info=True)
        return []
