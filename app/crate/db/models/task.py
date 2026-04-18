"""Typed models for task-related data.

Covers the ``tasks`` table and the ``scan_results`` table.
Models match the dict shapes returned by ``_row_to_task()`` in ``db/tasks.py``.
"""


from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TaskRow(BaseModel):
    """Full task record as returned by ``get_task()`` and ``list_tasks()``.

    Note: ``params`` and ``result`` are the deserialized JSON versions of the
    ``params_json`` / ``result_json`` DB columns (done by ``_row_to_task``).
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    status: str
    progress: str | None = None
    params: dict[str, Any] = {}
    result: Any | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    priority: int = 2
    pool: str = "default"
    parent_task_id: str | None = None
    max_duration_sec: int = 1800
    max_retries: int = 0
    retry_count: int = 0
    worker_id: str | None = None


class TaskSummary(BaseModel):
    """Lighter task projection for list views."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    status: str
    progress: str | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    priority: int = 2
    pool: str = "default"
    parent_task_id: str | None = None


class ScanResultRow(BaseModel):
    """Scan result record as returned by ``get_latest_scan()``."""
    model_config = ConfigDict(from_attributes=True)

    task_id: str
    issues: list[dict[str, Any]] = []
    scanned_at: datetime | None = None
