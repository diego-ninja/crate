"""Schema models for task and worker endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, RootModel

from crate.api.schemas.common import OkResponse, TaskEnqueueResponse


class TaskResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    status: str
    progress: Any = None
    error: str | None = None
    result: Any = None
    params: Any = None
    priority: int | None = None
    pool: str | None = None
    created_at: datetime | str | None = None
    started_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class WorkerTaskRefResponse(BaseModel):
    id: str
    type: str
    pool: str | None = None


class WorkerStatusResponse(BaseModel):
    engine: str
    running: int
    pending: int
    running_tasks: list[WorkerTaskRefResponse]
    pending_tasks: list[WorkerTaskRefResponse]


class WorkerSlotsRequest(BaseModel):
    slots: int | None = None
    min_slots: int | None = None


class WorkerSlotsResponse(BaseModel):
    max_slots: int
    min_slots: int


class WorkerRestartResponse(BaseModel):
    status: str


class CancelAllTasksResponse(BaseModel):
    cancelled: int


class WorkerScheduleEntryResponse(BaseModel):
    interval_seconds: int
    interval_human: str
    last_run: datetime | str | None = None
    enabled: bool


class WorkerSchedulesResponse(RootModel[dict[str, WorkerScheduleEntryResponse]]):
    pass


class WorkerSchedulesUpdateRequest(RootModel[dict[str, int | float]]):
    pass


class WorkerSchedulesUpdateResponse(BaseModel):
    schedules: dict[str, int]


class TaskCleanByStatusResponse(BaseModel):
    deleted: int
    status: str


class TaskCleanupRequest(BaseModel):
    older_than_days: int = 7


class TaskCleanupResponse(BaseModel):
    deleted: int


class TaskRetryRequest(BaseModel):
    task_id: str


class TaskRetryResponse(BaseModel):
    task_id: str
    original_id: str


class TaskCancelResponse(BaseModel):
    status: str
    id: str


class TaskConflictResponse(BaseModel):
    error: str


class WorkerCancelAllResponse(BaseModel):
    cancelled: int


class WorkerActionOkResponse(OkResponse):
    pass


class TaskActionEnqueueResponse(TaskEnqueueResponse):
    pass
