"""Runtime back-pressure for expensive background work.

The governor is intentionally conservative. It protects interactive API and
playback workloads from batch jobs that are allowed to wait: repairs, full
syncs, exports, analysis and audio fingerprinting.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
import logging
import os
import shutil
import time
from collections.abc import Sequence

log = logging.getLogger(__name__)

RESOURCE_GOVERNED_TASK_TYPES = frozenset({
    "backfill_track_audio_fingerprints",
    "batch_covers",
    "batch_retag",
    "compute_analytics",
    "compute_popularity",
    "enrich_mbids",
    "export_rich_metadata",
    "fetch_artwork_all",
    "fix_artist",
    "fix_issues",
    "health_check",
    "library_pipeline",
    "library_sync",
    "migrate_storage_v2",
    "process_new_content",
    "rebuild_library",
    "rehydrate_portable_metadata",
    "repair",
    "resolve_duplicates",
    "scan",
    "scan_missing_covers",
    "verify_storage_v2",
    "wipe_library",
    "write_portable_metadata",
})

AUDIO_HEAVY_TASK_TYPES = frozenset({
    "backfill_track_audio_fingerprints",
})

MAINTENANCE_WINDOW_TASK_TYPES = frozenset({
    "batch_retag",
    "export_rich_metadata",
    "fix_issues",
    "library_pipeline",
    "migrate_storage_v2",
    "rebuild_library",
    "rehydrate_portable_metadata",
    "verify_storage_v2",
    "wipe_library",
    "write_portable_metadata",
})

DEFAULT_DEFER_SECONDS = 300
DEFAULT_LOAD_RATIO = 0.85
DEFAULT_IOWAIT_PERCENT = 25.0
DEFAULT_SWAP_PERCENT = 30.0
DEFAULT_NICE_VALUE = 12
DEFAULT_MAINTENANCE_WINDOW_START = "02:00"
DEFAULT_MAINTENANCE_WINDOW_END = "07:00"
DEFAULT_FINGERPRINT_WINDOW_LIMIT = 1000


@dataclass(slots=True)
class ResourceSnapshot:
    cpu_count: int
    load_1m: float | None = None
    load_ratio: float | None = None
    iowait_percent: float | None = None
    swap_used_percent: float | None = None
    active_users: int | None = None
    active_streams: int | None = None


@dataclass(slots=True)
class ResourceDecision:
    allowed: bool
    reason: str = ""
    defer_seconds: int = DEFAULT_DEFER_SECONDS
    snapshot: ResourceSnapshot | None = None
    window: dict | None = None

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "defer_seconds": self.defer_seconds,
            "snapshot": asdict(self.snapshot) if self.snapshot else None,
            "window": self.window,
        }


def is_governed_task(task_type: str) -> bool:
    return task_type in RESOURCE_GOVERNED_TASK_TYPES


def should_defer_task(task_type: str, params: dict | None = None) -> ResourceDecision:
    params = params or {}
    if params.get("ignore_resource_governor"):
        return ResourceDecision(allowed=True)
    if not is_governed_task(task_type):
        return ResourceDecision(allowed=True)
    if _requires_maintenance_window(task_type, params):
        window_decision = evaluate_maintenance_window(task_type=task_type)
        if not window_decision.allowed:
            return window_decision
    return evaluate_resources(label=task_type, listener_sensitive=True)


def evaluate_maintenance_window(*, task_type: str = "background") -> ResourceDecision:
    if not _maintenance_window_enabled():
        return ResourceDecision(allowed=True)

    start_raw = os.environ.get("CRATE_MAINTENANCE_WINDOW_START", DEFAULT_MAINTENANCE_WINDOW_START)
    end_raw = os.environ.get("CRATE_MAINTENANCE_WINDOW_END", DEFAULT_MAINTENANCE_WINDOW_END)
    start_min = _parse_hhmm(start_raw, _parse_hhmm(DEFAULT_MAINTENANCE_WINDOW_START, 120))
    end_min = _parse_hhmm(end_raw, _parse_hhmm(DEFAULT_MAINTENANCE_WINDOW_END, 420))
    now_min = _local_minutes_now()
    in_window = _minutes_in_window(now_min, start_min, end_min)
    seconds_until_start = _seconds_until_window_start(now_min, start_min)
    window = {
        "enabled": True,
        "start": _format_hhmm(start_min),
        "end": _format_hhmm(end_min),
        "now": _format_hhmm(now_min),
        "in_window": in_window,
        "seconds_until_start": seconds_until_start,
    }
    if in_window:
        return ResourceDecision(allowed=True, window=window)

    reason = f"outside maintenance window {_format_hhmm(start_min)}-{_format_hhmm(end_min)}"
    return ResourceDecision(
        allowed=False,
        reason=reason,
        defer_seconds=max(60, seconds_until_start),
        window=window,
    )


def evaluate_resources(*, label: str = "background", listener_sensitive: bool = True) -> ResourceDecision:
    if not _enabled():
        return ResourceDecision(allowed=True)

    snapshot = build_snapshot(include_playback=listener_sensitive)
    reasons: list[str] = []
    max_load_ratio = _float_setting("CRATE_RESOURCE_MAX_LOAD_RATIO", DEFAULT_LOAD_RATIO)
    max_iowait = _float_setting("CRATE_RESOURCE_MAX_IOWAIT_PERCENT", DEFAULT_IOWAIT_PERCENT)
    max_swap = _float_setting("CRATE_RESOURCE_MAX_SWAP_PERCENT", DEFAULT_SWAP_PERCENT)
    max_active_users = _nonnegative_int_setting("CRATE_RESOURCE_MAX_ACTIVE_USERS", 0)
    max_active_streams = _nonnegative_int_setting("CRATE_RESOURCE_MAX_ACTIVE_STREAMS", 0)

    if listener_sensitive:
        if (snapshot.active_users or 0) > max_active_users:
            reasons.append(f"{snapshot.active_users} active listener(s)>{max_active_users}")
        if (snapshot.active_streams or 0) > max_active_streams:
            reasons.append(f"{snapshot.active_streams} recent stream(s)>{max_active_streams}")

    if snapshot.load_ratio is not None and snapshot.load_ratio > max_load_ratio:
        reasons.append(f"load {snapshot.load_ratio:.2f}>{max_load_ratio:.2f}")
    if snapshot.iowait_percent is not None and snapshot.iowait_percent > max_iowait:
        reasons.append(f"iowait {snapshot.iowait_percent:.1f}%>{max_iowait:.1f}%")
    if snapshot.swap_used_percent is not None and snapshot.swap_used_percent > max_swap:
        reasons.append(f"swap {snapshot.swap_used_percent:.1f}%>{max_swap:.1f}%")

    allowed = not reasons
    decision = ResourceDecision(
        allowed=allowed,
        reason=", ".join(reasons),
        defer_seconds=_int_setting("CRATE_RESOURCE_DEFER_SECONDS", DEFAULT_DEFER_SECONDS),
        snapshot=snapshot,
    )
    if not allowed:
        log.info("Resource governor deferring %s: %s", label, decision.reason)
    return decision


def build_snapshot(*, include_playback: bool = True) -> ResourceSnapshot:
    cpu_count = os.cpu_count() or 1
    load_1m: float | None = None
    load_ratio: float | None = None
    try:
        load_1m = float(os.getloadavg()[0])
        load_ratio = load_1m / max(cpu_count, 1)
    except Exception:
        pass

    active_users: int | None = None
    active_streams: int | None = None
    if include_playback:
        active_users = _count_active_users()
        active_streams = _count_active_streams()

    return ResourceSnapshot(
        cpu_count=cpu_count,
        load_1m=load_1m,
        load_ratio=load_ratio,
        iowait_percent=_sample_iowait_percent(),
        swap_used_percent=_swap_used_percent(),
        active_users=active_users,
        active_streams=active_streams,
    )


def record_decision(
    decision: ResourceDecision,
    *,
    task_type: str | None = None,
    source: str = "worker",
) -> None:
    try:
        from crate.db.cache_store import set_cache

        set_cache("resource_pressure", decision.to_dict(), ttl=max(decision.defer_seconds, 60))
    except Exception:
        pass
    if not decision.allowed:
        _record_deferral_metrics(decision, task_type=task_type, source=source)


def low_priority_command(command: Sequence[str], *, nice_value: int | None = None, idle_io: bool = True) -> list[str]:
    wrapped = [str(part) for part in command]
    if os.name != "posix":
        return wrapped
    if wrapped and "/" not in wrapped[0] and shutil.which(wrapped[0]) is None:
        return wrapped

    if idle_io and shutil.which("ionice"):
        wrapped = ["ionice", "-c3", *wrapped]

    nice = DEFAULT_NICE_VALUE if nice_value is None else int(nice_value)
    if nice > 0 and shutil.which("nice"):
        wrapped = ["nice", "-n", str(nice), *wrapped]

    return wrapped


def wait_while_pressured(
    *,
    label: str,
    task_type: str,
    is_cancelled_fn,
    task_id: str,
    emit_event_fn=None,
    max_sleep_seconds: int | None = None,
) -> bool:
    slept = 0
    while True:
        if is_cancelled_fn(task_id):
            return False
        decision = evaluate_resources(label=label, listener_sensitive=True)
        record_decision(decision, task_type=task_type, source="task_loop")
        if decision.allowed:
            return True
        delay = min(decision.defer_seconds, max_sleep_seconds or decision.defer_seconds)
        if emit_event_fn:
            emit_event_fn(
                task_id,
                "info",
                {
                    "message": f"{task_type} paused by resource governor: {decision.reason}",
                    "resource_pressure": decision.to_dict(),
                    "delay_seconds": delay,
                },
            )
        time.sleep(max(1, delay))
        slept += delay
        if max_sleep_seconds is not None and slept >= max_sleep_seconds:
            return True


def _enabled() -> bool:
    raw = os.environ.get("CRATE_RESOURCE_GOVERNOR_ENABLED", "true")
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _maintenance_window_enabled() -> bool:
    raw = os.environ.get("CRATE_MAINTENANCE_WINDOW_ENABLED", "false")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _requires_maintenance_window(task_type: str, params: dict) -> bool:
    if not _maintenance_window_enabled():
        return False
    if params.get("ignore_maintenance_window"):
        return False
    if task_type in MAINTENANCE_WINDOW_TASK_TYPES:
        return not _has_specific_scope(params)
    if task_type == "library_sync":
        return not _has_specific_scope(params)
    if task_type == "repair":
        return not _has_specific_scope(params)
    if task_type == "backfill_track_audio_fingerprints":
        limit = _coerce_int(params.get("limit"), 5000)
        threshold = _int_setting("CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT", DEFAULT_FINGERPRINT_WINDOW_LIMIT)
        return not _has_specific_scope(params) or limit > threshold
    return False


def _has_specific_scope(params: dict) -> bool:
    if params.get("issues"):
        return True
    scope_keys = {
        "album",
        "album_dir",
        "album_entity_uid",
        "album_id",
        "artist",
        "artist_dir",
        "artist_entity_uid",
        "artist_id",
        "entity_uid",
        "path",
        "track_entity_uid",
        "track_id",
    }
    return any(params.get(key) for key in scope_keys)


def _parse_hhmm(value: str, default: int) -> int:
    try:
        hour_raw, minute_raw = str(value).strip().split(":", 1)
        hour = int(hour_raw)
        minute = int(minute_raw)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour * 60 + minute
    except Exception:
        pass
    return default


def _local_minutes_now() -> int:
    now = datetime.now().astimezone()
    return now.hour * 60 + now.minute


def _minutes_in_window(now_min: int, start_min: int, end_min: int) -> bool:
    if start_min == end_min:
        return True
    if start_min < end_min:
        return start_min <= now_min < end_min
    return now_min >= start_min or now_min < end_min


def _seconds_until_window_start(now_min: int, start_min: int) -> int:
    delta_min = (start_min - now_min) % (24 * 60)
    return max(60, delta_min * 60)


def _format_hhmm(minutes: int) -> str:
    minutes = minutes % (24 * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _coerce_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _int_setting(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _nonnegative_int_setting(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _float_setting(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _record_deferral_metrics(
    decision: ResourceDecision,
    *,
    task_type: str | None,
    source: str,
) -> None:
    try:
        from crate.metrics import record, record_counter

        reason = _reason_family(decision.reason)
        tags = {
            "task_type": task_type or "unknown",
            "source": source,
            "reason": reason,
        }
        record_counter("worker.resource.deferred", tags)
        record("worker.resource.defer_seconds", float(decision.defer_seconds), tags)
        snapshot = decision.snapshot
        if snapshot:
            if snapshot.load_ratio is not None:
                record("worker.resource.load_ratio", float(snapshot.load_ratio), tags)
            if snapshot.iowait_percent is not None:
                record("worker.resource.iowait_percent", float(snapshot.iowait_percent), tags)
            if snapshot.swap_used_percent is not None:
                record("worker.resource.swap_used_percent", float(snapshot.swap_used_percent), tags)
            if snapshot.active_users is not None:
                record("worker.resource.active_users", float(snapshot.active_users), tags)
            if snapshot.active_streams is not None:
                record("worker.resource.active_streams", float(snapshot.active_streams), tags)
    except Exception:
        pass


def _reason_family(reason: str) -> str:
    lowered = reason.lower()
    if "maintenance window" in lowered:
        return "maintenance_window"
    if "listener" in lowered or "stream" in lowered:
        return "playback"
    if "iowait" in lowered:
        return "iowait"
    if "swap" in lowered:
        return "swap"
    if "load" in lowered:
        return "load"
    return "mixed"


def _count_active_users() -> int:
    try:
        from crate.db.queries.management import count_recent_active_users

        return int(count_recent_active_users(window_minutes=5))
    except Exception:
        return 0


def _count_active_streams() -> int:
    try:
        from crate.db.queries.management import count_recent_streams

        return int(count_recent_streams(window_minutes=3))
    except Exception:
        return 0


def _read_cpu_totals() -> tuple[int, int] | None:
    try:
        with open("/proc/stat", encoding="utf-8") as handle:
            first = handle.readline().strip().split()
    except Exception:
        return None
    if not first or first[0] != "cpu":
        return None
    values = [int(part) for part in first[1:]]
    total = sum(values)
    iowait = values[4] if len(values) > 4 else 0
    return total, iowait


def _sample_iowait_percent(interval_seconds: float = 0.05) -> float | None:
    before = _read_cpu_totals()
    if before is None:
        return None
    time.sleep(interval_seconds)
    after = _read_cpu_totals()
    if after is None:
        return None
    total_delta = after[0] - before[0]
    iowait_delta = after[1] - before[1]
    if total_delta <= 0:
        return None
    return round(max(0.0, iowait_delta / total_delta * 100), 1)


def _swap_used_percent() -> float | None:
    values: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, raw_value = line.split(":", 1)
                if key in {"SwapTotal", "SwapFree"}:
                    values[key] = int(raw_value.strip().split()[0])
    except Exception:
        return None

    total = values.get("SwapTotal", 0)
    free = values.get("SwapFree", 0)
    if total <= 0:
        return 0.0
    return round((total - free) / total * 100, 1)


__all__ = [
    "AUDIO_HEAVY_TASK_TYPES",
    "MAINTENANCE_WINDOW_TASK_TYPES",
    "RESOURCE_GOVERNED_TASK_TYPES",
    "ResourceDecision",
    "ResourceSnapshot",
    "build_snapshot",
    "evaluate_maintenance_window",
    "evaluate_resources",
    "is_governed_task",
    "low_priority_command",
    "record_decision",
    "should_defer_task",
    "wait_while_pressured",
]
