"""Standardized task progress schema and helpers.

Every worker handler should use TaskProgress to report structured
progress instead of freeform strings. The emit_progress() helper
batches DB writes (max 1/sec) but streams events immediately.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# Minimum interval between DB progress writes (seconds).
# SSE events are emitted immediately regardless.
_PROGRESS_DB_INTERVAL = 1.0


@dataclass
class TaskProgress:
    phase: str = ""
    phase_index: int = 0
    phase_count: int = 1
    item: str = ""
    done: int = 0
    total: int = 0
    rate: float = 0.0
    eta_sec: int = 0
    errors: int = 0
    warnings: int = 0

    # Internal: track rate calculation
    _rate_window: list[float] = field(default_factory=list, repr=False)
    _rate_last_done: int = field(default=0, repr=False)
    _rate_last_time: float = field(default=0.0, repr=False)

    def percent(self) -> float:
        if self.total <= 0:
            return 0.0
        return min(100.0, (self.done / self.total) * 100)

    def update_rate(self):
        """Recalculate rolling rate (items/sec) from recent samples."""
        now = time.monotonic()
        if self._rate_last_time > 0 and self.done > self._rate_last_done:
            elapsed = now - self._rate_last_time
            if elapsed > 0:
                sample = (self.done - self._rate_last_done) / elapsed
                self._rate_window.append(sample)
                if len(self._rate_window) > 10:
                    self._rate_window = self._rate_window[-10:]
                self.rate = sum(self._rate_window) / len(self._rate_window)
                remaining = max(0, self.total - self.done)
                self.eta_sec = int(remaining / self.rate) if self.rate > 0 else 0
        self._rate_last_done = self.done
        self._rate_last_time = now

    def to_dict(self) -> dict:
        return {
            "phase": self.phase,
            "phase_index": self.phase_index,
            "phase_count": self.phase_count,
            "item": self.item,
            "done": self.done,
            "total": self.total,
            "percent": round(self.percent(), 1),
            "rate": round(self.rate, 2),
            "eta_sec": self.eta_sec,
            "errors": self.errors,
            "warnings": self.warnings,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @staticmethod
    def from_json(raw: str | dict | None) -> TaskProgress:
        if raw is None:
            return TaskProgress()
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return TaskProgress(phase=raw)
        if not isinstance(raw, dict):
            return TaskProgress()
        return TaskProgress(
            phase=raw.get("phase", ""),
            phase_index=raw.get("phase_index", 0),
            phase_count=raw.get("phase_count", 1),
            item=raw.get("item", ""),
            done=raw.get("done", 0),
            total=raw.get("total", 0),
            rate=raw.get("rate", 0.0),
            eta_sec=raw.get("eta_sec", 0),
            errors=raw.get("errors", 0),
            warnings=raw.get("warnings", 0),
        )


def entity_label(
    artist: str = "",
    album: str = "",
    title: str = "",
    path: str = "",
) -> str:
    """Build a human-readable label from whatever entity fields are available."""
    if artist and title:
        return f"{artist} \u2014 {title}"
    if artist and album:
        return f"{artist} \u2014 {album}"
    if artist:
        return artist
    if title:
        return title
    if album:
        return album
    if path:
        return path.rsplit("/", 1)[-1]
    return "unknown"


# ── Emission helpers ─────────────────────────────────────────────

_last_db_write: dict[str, float] = {}


def emit_progress(task_id: str, progress: TaskProgress, *, force: bool = False):
    """Update task progress in DB (throttled).

    Does NOT emit a task_event — progress updates are high-frequency
    and would flood the event log. The UI reads the progress field
    from the task row directly (via SSE global stream or polling).
    """
    from crate.db.repositories.tasks import update_task

    progress.update_rate()

    # Throttle DB writes
    now = time.monotonic()
    last = _last_db_write.get(task_id, 0)
    if force or (now - last) >= _PROGRESS_DB_INTERVAL:
        _last_db_write[task_id] = now
        try:
            update_task(task_id, progress=progress.to_json())
        except Exception:
            log.debug("Failed to update task progress for %s", task_id, exc_info=True)


def emit_item_event(
    task_id: str,
    *,
    level: str = "info",
    message: str,
    artist: str = "",
    album: str = "",
    title: str = "",
    path: str = "",
    track_id: int | str | None = None,
    extra: dict | None = None,
):
    """Emit a human-readable item-level event for a task."""
    from crate.db.events import emit_task_event

    data: dict = {
        "level": level,
        "message": message,
        "label": entity_label(artist=artist, album=album, title=title, path=path),
    }
    if artist:
        data["artist"] = artist
    if album:
        data["album"] = album
    if title:
        data["title"] = title
    if track_id is not None:
        data["track_id"] = track_id
    if extra:
        data.update(extra)

    try:
        emit_task_event(task_id, "item", data)
    except Exception:
        log.debug("Failed to emit item event for %s", task_id, exc_info=True)
