# Worker, Tasks, and Background Services

## Why the worker exists

Crate's worker is not just "background jobs". It is the write-capable side of the system.

Anything that can mutate the library or perform long-running work belongs here:

- downloads
- file moves
- tag writes
- image writes
- scans and repairs
- enrichment fan-out
- storage migration
- audio analysis orchestration

The worker process mounts `/music` read-write, unlike the API.

## Execution model

The worker entrypoint is [app/crate/worker.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker.py).

At startup it:

1. initializes DB and MusicBrainz client
2. cleans orphaned/running task state
3. clears stale locks and download semaphores
4. starts a background service loop
5. starts background analysis daemons
6. starts the Telegram bot loop
7. launches Dramatiq workers in a subprocess

This means the "worker container" actually hosts several cooperating background concerns, not only message consumption.

## Task model

Crate tasks are dual-represented:

- PostgreSQL row in `tasks`
- Dramatiq message delivered to an actor

### Why both exist

The DB row provides:

- a stable task id
- persistent status and progress
- cancellation
- task history in the UI
- a place to attach result and error payloads

The Dramatiq message provides:

- asynchronous execution
- queueing
- retries
- process isolation
- distribution over worker processes

This is one of the most important architectural choices in the project.

## Task lifecycle

### Creation

`create_task()` in [app/crate/db/tasks.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/tasks.py):

- inserts a row into `tasks`
- derives queue, priority, max duration, and retries from `TASK_POOL_CONFIG`
- optionally dispatches to Dramatiq immediately

### Execution

The actor wrapper in [app/crate/actors.py](/Users/diego/Code/Ninja/musicdock/app/crate/actors.py):

- fetches the PG task row
- acquires DB-heavy or download locks if required
- marks the task as running
- starts a heartbeat thread
- calls the real task handler
- updates completion or failure state
- releases locks

### Progress and events

- task progress is persisted as JSON-ish text in `tasks.progress`
- richer events are emitted into `task_events`
- SSE endpoints in [app/crate/api/events.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/events.py) stream both global and per-task updates

### Cancellation

Cancellation is cooperative:

- a task status can be set to `cancelled`
- handlers periodically call `is_cancelled` or related checks
- cancellation is not preemptive thread termination

This is safer for filesystem operations.

## Queue and priority strategy

[app/crate/actors.py](/Users/diego/Code/Ninja/musicdock/app/crate/actors.py) defines `TASK_POOL_CONFIG`.

Each task type gets:

- queue name
- priority
- max duration
- max retries

### Queues

- `fast`: lightweight HTTP/DB-heavy but short jobs
- `default`: mixed work, library pipeline, downloads, management
- `heavy`: reserved for heavier CPU paths, though much of the current analysis orchestration now fans out differently

### Priority bands

- `0`: user-initiated urgent actions such as downloads, deletes, tag writes
- `1`: immediate post-ingest work
- `2`: scheduled operational work
- `3`: lower-priority background maintenance or backfills

This gives Crate a useful product property: manual user actions can outrun background hygiene work.

## Coordination primitives

### DB-heavy mutex

Some tasks should not overlap, especially ones that can churn a lot of database state:

- `library_sync`
- `library_pipeline`
- `wipe_library`
- `rebuild_library`
- `repair`
- `migrate_storage_v2`

These acquire a Redis-backed mutex so only one such task runs at a time across worker processes.

### Download semaphore

Tidal and Soulseek transfers are globally capped using a Redis set-based semaphore:

- avoids network and provider overload
- enforces bounded parallelism
- works across worker processes

## Service loop responsibilities

The worker's `_run_service_loop()` is a second major architectural element.

Every few seconds or minutes it handles:

- filesystem watcher lifecycle
- scheduled task creation
- import queue scanning
- zombie task cleanup
- worker status cache updates
- old task/event/session/jam cleanup

This service loop is what makes the worker feel like a living background runtime rather than a pure message consumer.

## Filesystem watcher

[app/crate/library_watcher.py](/Users/diego/Code/Ninja/musicdock/app/crate/library_watcher.py) uses `watchdog` to:

- react to created and moved audio files
- debounce per album directory
- ignore files written by enrichment or artwork generation
- avoid infinite loops using in-process and DB/Redis processing flags

Watcher writes do not directly do enrichment. They trigger sync and then queue higher-level content processing if needed.

## Scheduler

[app/crate/scheduler.py](/Users/diego/Code/Ninja/musicdock/app/crate/scheduler.py) implements configurable recurring tasks backed by settings rather than static cron files.

Default schedules cover:

- artist enrichment
- library pipeline
- analytics
- new releases
- incomplete download cleanup
- show sync

The scheduler checks:

- whether enough time has elapsed since the last run
- whether a task of the same type is already pending or running

This prevents schedule storms.

## Analysis daemons

Separate background daemons in the worker handle throughput-oriented analysis flows:

- audio analysis daemon
- bliss daemon

These are conceptually different from request-triggered jobs. They let Crate absorb newly indexed content and background resets without requiring every analysis step to run synchronously inside one monolithic task.

## Import queue

The service loop periodically scans import sources declared in [app/config.yaml](/Users/diego/Code/Ninja/musicdock/app/config.yaml):

- Tidal
- Soulseek
- other ingestion roots

This supports workflows where external systems or download tools populate a staging area that Crate then normalizes and ingests.

## Task handler organization

Handlers are grouped by subsystem under `/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers`:

- `acquisition.py`
- `analysis.py`
- `artwork.py`
- `enrichment.py`
- `integrations.py`
- `library.py`
- `management.py`
- `migration.py`

`worker.py` assembles these into the final `TASK_HANDLERS` dictionary.

This makes the task registry flat at runtime but modular in source.

## Operational characteristics

### Strengths

- good visibility into work in progress
- retryable failures
- live progress in the UI
- safe separation of reads and writes
- easier to reason about than ad hoc threads inside the API

### Trade-offs

- dual representation means more moving parts
- task handlers must remain idempotent or at least retry-safe
- long-running operations need careful heartbeat and cleanup behavior

## Recommended mental model

When thinking about Crate, it helps to split the system into:

- request path: API + DB + cache
- background path: task row + actor + handler + events

Many product features cross both paths:

- user requests an operation via API
- API creates a task
- worker mutates the world
- UI follows the operation through task events

That request-to-task-to-event loop is the dominant operational pattern in Crate.

## Related documents

- [Backend API and Data Layer](/Users/diego/Code/Ninja/musicdock/docs/technical/02-backend-api-and-data.md)
- [Library, Storage, Sync, and Imports](/Users/diego/Code/Ninja/musicdock/docs/technical/04-library-storage-sync-and-imports.md)
- [Enrichment, Acquisition, and External Integrations](/Users/diego/Code/Ninja/musicdock/docs/technical/05-enrichment-acquisition-and-integrations.md)
