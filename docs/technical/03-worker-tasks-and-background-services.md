# Worker, Tasks, and Background Services

## Why the worker exists

Crate's worker is not just “background jobs”. It is the write-capable side of
the system and the host for several long-lived background runtimes.

Anything that can mutate the library or perform long-running work belongs here:

- downloads
- file moves
- tag writes
- image writes
- scans and repairs
- enrichment fan-out
- storage migration
- audio analysis orchestration
- snapshot projection

The worker mounts `/music` read-write, unlike the API.

## Execution model

The worker entrypoint is `app/crate/worker.py`.

At startup it:

1. initializes DB and MusicBrainz client
2. cleans orphaned/running task state
3. clears stale locks and download semaphores
4. starts the background service loop
5. starts the analysis and bliss daemons
6. starts the projector thread for domain events
7. starts the Telegram bot loop
8. launches Dramatiq workers in a subprocess

This means the worker container hosts several cooperating concerns, not only
message consumption.

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

This remains one of the most important architectural choices in the project.

## Task lifecycle

### Creation

`create_task()` / `create_task_dedup()`:

- insert a row into `tasks`
- derive queue/priority/runtime limits from config
- schedule Dramatiq dispatch only after the surrounding transaction commits
- can participate in a caller-owned session

### Execution

The actor wrapper in `app/crate/actors.py`:

- fetches the task row
- acquires Redis-backed locks/semaphores when needed
- marks the task as running
- starts heartbeat state
- calls the real handler
- records completion or failure
- releases locks

### Progress and events

- coarse progress lives on `tasks.progress`
- richer task activity lives in `task_events`
- SSE endpoints stream both global and per-task activity

### Cancellation

Cancellation is cooperative:

- the task row can be marked cancelled
- handlers poll for cancellation
- Crate does not kill threads preemptively during filesystem work

## Not all follow-up work is a DB task

The task model is important, but it is not the only async mechanism anymore.

Examples:

- the **projector** consumes Redis Stream domain events in its own loop
- **scrobble follow-ups** for play events are queued as direct actors after
  commit rather than as user-visible task rows
- **analysis/bliss daemons** claim pipeline work directly rather than routing
  every unit of work through a task row

That split is intentional: not every async unit needs to be operator-visible as
its own row in `tasks`.

## Queue and priority strategy

`app/crate/actors.py` defines per-task execution policy.

Queues:

- `fast` — lightweight HTTP/DB-heavy but short jobs
- `default` — mixed work, library pipeline, downloads, management
- `heavy` — reserved for heavier CPU paths

Priority bands broadly map to:

- urgent user actions
- immediate post-ingest work
- scheduled operational work
- lower-priority maintenance/backfills

## Coordination primitives

### DB-heavy mutex

Some tasks should not overlap, especially ones that churn library state:

- `library_sync`
- `library_pipeline`
- `wipe_library`
- `rebuild_library`
- `repair`
- `migrate_storage_v2`

These use Redis-backed coordination so only one runs at a time across worker
processes.

### Download semaphore

Tidal and Soulseek transfers are globally capped using a Redis semaphore.

## Service loop responsibilities

`_run_service_loop()` is the second major part of the worker runtime.

On a cadence, it handles:

- filesystem watcher lifecycle
- scheduled task creation
- import queue refresh
- zombie task cleanup
- worker status cache updates
- ops runtime state updates
- queue depth metrics
- metrics flush to PostgreSQL
- incremental shadow read-model backfill for analysis/bliss pipeline tables
- old task/event/log/session/jam cleanup

This is what makes the worker feel like a living background runtime rather than
a pure broker consumer.

## Filesystem watcher

`app/crate/library_watcher.py` uses `watchdog` to:

- react to created and moved audio files
- debounce per album directory
- ignore files written by enrichment or artwork generation
- avoid infinite loops using runtime flags and suppression logic

Watcher events trigger sync and downstream processing rather than performing
heavy work inline.

## Scheduler

`app/crate/scheduler.py` implements configurable recurring tasks backed by
settings rather than static cron files.

Default schedules cover things such as:

- artist enrichment
- library pipeline
- analytics
- new releases
- incomplete download cleanup
- show sync

It checks both elapsed time and whether a same-type task is already
pending/running to avoid schedule storms.

## Analysis and bliss daemons

Separate long-lived daemons handle throughput-oriented analysis flows:

- audio analysis daemon
- bliss daemon

They claim work from `track_processing_state` and update the shadow pipeline
tables plus compatibility columns.

This is conceptually different from request-triggered tasks: the daemons absorb
newly indexed content and background resets without wrapping every track in a
task row.

## Projector loop

The projector thread is the worker-side consumer for the domain-event bus.

It:

- reads Redis Stream events through a consumer group
- retries its own pending messages first after a crash/restart
- decides whether ops or home snapshots need refreshing
- marks processed messages only after warming completes

This is the bridge between write-side mutations and snapshot-driven UI surfaces.

## Import queue

The service loop periodically normalizes external import sources into
`import_queue_items`, which gives the admin UI and ops snapshot a read model for
staging/import state rather than live rescans every time.
