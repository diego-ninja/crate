"""Redis-backed snapshot update notifications for SSE consumers."""

from __future__ import annotations

import json

from crate.db.cache_runtime import _get_redis

SNAPSHOT_CHANNEL_ALL = "crate:sse:snapshot"


def snapshot_channel(scope: str, subject_key: str = "global") -> str:
    return f"{SNAPSHOT_CHANNEL_ALL}:{scope}:{subject_key}"


def publish_snapshot_update(scope: str, subject_key: str, version: int) -> None:
    try:
        redis_client = _get_redis()
        if not redis_client:
            return
        payload = json.dumps(
            {
                "scope": scope,
                "subject_key": subject_key,
                "version": int(version),
            }
        )
        redis_client.publish(SNAPSHOT_CHANNEL_ALL, payload)
        redis_client.publish(snapshot_channel(scope, subject_key), payload)
    except Exception:
        return


__all__ = ["SNAPSHOT_CHANNEL_ALL", "publish_snapshot_update", "snapshot_channel"]
