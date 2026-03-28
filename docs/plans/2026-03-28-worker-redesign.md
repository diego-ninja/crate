# Worker System Redesign

Date: 2026-03-28
Status: Analysis & Proposal

---

## 1. Current Architecture

### 1.1 Components

```
Orchestrator (main process)
  ├── LibraryWatcher (filesystem watchdog, main thread)
  ├── Scheduler (checked every 60s in main loop)
  ├── Worker-1 (child process)
  ├── Worker-2 (child process)
  └── Worker-N (child process, autoscaled 2-5)
```

**Orchestrator** (`orchestrator.py`) is the entry point. It runs in the main process and:
- Initializes the DB and MusicBrainz client
- Cleans up orphaned tasks from previous crashes (marks all `running` as `failed`)
- Starts the filesystem watcher in-process
- Spawns 2-5 worker child processes via `multiprocessing.Process`
- Runs a 2-second main loop that handles: scheduled task checks (60s), import queue scan (60s), health checks (10s), autoscaling (30s), status cache updates (15s), periodic cleanup (1h)

**Worker processes** (`_worker_process_entry` in orchestrator.py) are daemon processes that:
- Reset the DB connection pool (each process needs its own)
- Poll for tasks via `claim_next_task()` with a 2-second sleep between polls
- Execute task handlers from the `TASK_HANDLERS` dict
- Self-recycle after 200 tasks OR when RSS exceeds 1.5GB
- Handle SIGTERM for graceful shutdown

### 1.2 Task Lifecycle

```
Created (pending)
  ↓  claim_next_task() — SELECT FOR UPDATE SKIP LOCKED
Running
  ↓  handler completes / fails / cancelled
Completed | Failed | Cancelled
```

#### Who creates tasks:

| Source | Tasks Created | Mechanism |
|--------|--------------|-----------|
| **Scheduler** (60s interval) | `enrich_artists`, `library_pipeline`, `compute_analytics`, `check_new_releases`, `cleanup_incomplete_downloads`, `sync_shows` | `check_and_create_scheduled_tasks()` with interval gating |
| **Filesystem Watcher** | `process_new_content` | `create_task_dedup()` on directory changes |
| **API endpoints** | All 20+ types — downloads, tags, covers, analysis, sync, etc. | `create_task()` or `create_task_dedup()` |
| **Other tasks** | `process_new_content` (from pipeline, tidal, repair), `compute_analytics` (from scan), `rebuild_library` (from wipe), chunk sub-tasks | Direct `create_task()` within handlers |

#### How tasks are claimed (`claim_next_task` in `db/tasks.py`):

1. **Global gate**: COUNT running tasks >= max_workers (default 5) → return None
2. **DB-heavy serialization**: If any `DB_HEAVY_TASKS` is running, only claim non-DB-heavy tasks
3. **FIFO ordering**: `ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
4. **Atomic claim**: UPDATE status → 'running' WHERE status = 'pending'

DB_HEAVY_TASKS: `library_sync`, `library_pipeline`, `wipe_library`, `rebuild_library`, `repair`, `enrich_mbids`

#### What happens when a worker dies:

1. **Orchestrator detects** dead process in `_health_check()` (every 10s)
2. Respawns to maintain min_workers
3. **Zombie cleanup** in `_cleanup_zombie_tasks()`: tasks `running` with `updated_at` > 30min ago → marked `failed`
4. **On restart**: `_cleanup_orphaned_tasks()` marks ALL running tasks as failed

### 1.3 Current Tasks Table Schema

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,          -- uuid hex[:12]
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress TEXT DEFAULT '',     -- JSON string, updated during execution
    params_json JSONB DEFAULT '{}',
    result_json JSONB,
    error TEXT,
    created_at TEXT NOT NULL,     -- ISO 8601
    updated_at TEXT NOT NULL      -- ISO 8601, doubles as "heartbeat"
)
```

No priority, no parent_task_id, no pool assignment, no max_duration, no dedicated heartbeat.

---

## 2. `process_new_content` Breakdown

This is the megalodon. Called for every new/changed artist — by watcher, by pipeline, by tidal download, by repair. It runs 8 sequential steps in a single task.

Lines 1660-1985 of `worker.py`.

### 2.1 Step-by-Step Analysis

| # | Step | Operation | Est. Duration | Type | Depends On | Can Parallel | Notes |
|---|------|-----------|---------------|------|------------|-------------|-------|
| 0 | `organize_folders` | Move album dirs to `Artist/Year/Album` structure | 1-5s | I/O (filesystem) | Nothing | Yes | Writes to disk (shutil.move), updates DB paths |
| 1 | `enrich_artist` | Last.fm + Spotify + MusicBrainz + Setlist.fm + Fanart.tv + Discogs | 5-15s | I/O (HTTP) | Nothing | Yes | 6 API calls with 0.3s sleeps between each, downloads artist photo |
| 2 | `album_genres` | Read genre tags from DB tracks, write to `album_genres` | <1s | DB | Sync (needs tracks in DB) | Yes | Fast DB operations |
| 3 | `album_mbid` | MusicBrainz search + scoring per album | 5-30s per album | I/O (HTTP) | Nothing | Yes, per album | 1s sleep per MB request, rate limited. For artist with 10 albums = ~60s |
| 4 | `audio_analysis` | Essentia/PANNs BPM, key, energy, mood per track | 5-30s per track | **CPU** | Sync (needs tracks in DB) | Yes (but CPU-bound) | Loads audio into RAM (44.1kHz mono), CNN inference. For 50 tracks = 250-1500s. **THE bottleneck.** |
| 5 | `bliss` | Rust CLI computes 20-float feature vectors per track | 2-10s per track | **CPU** (Rust subprocess) | Nothing (reads files) | Yes | Spawns `crate-cli bliss --dir`. For 50 tracks = ~100-500s. Second biggest bottleneck. |
| 6 | `popularity` | Last.fm album.getinfo + track.getinfo per track | 0.25s per request | I/O (HTTP) | Nothing | Yes | Capped at 50 tracks. With 10 albums + 50 tracks = ~20s |
| 7 | `covers` | Fetch album covers from CAA/Deezer | 1-5s per album | I/O (HTTP) | Step 3 (MBID helps) | Yes | Skips if cover exists |

### 2.2 Timing Estimates

For a typical artist with 5 albums, 50 tracks:

| Step | Best Case | Typical | Worst Case |
|------|-----------|---------|------------|
| organize_folders | 0s | 2s | 10s |
| enrich_artist | 3s | 8s | 20s (timeouts) |
| album_genres | <1s | <1s | 1s |
| album_mbid | 5s | 30s | 120s (many albums) |
| audio_analysis | 25s | 150s | 1500s (librosa fallback) |
| bliss | 10s | 100s | 500s |
| popularity | 5s | 20s | 60s |
| covers | 2s | 10s | 30s |
| **TOTAL** | **~50s** | **~320s** | **~2240s** |

Audio analysis + bliss alone = 75% of the total time. And they're CPU-bound while everything else is I/O-bound.

### 2.3 Dependency Graph

```
organize_folders ──┐
                   ├── album_genres (needs synced tracks)
                   ├── audio_analysis (needs file paths)
                   ├── bliss (needs file paths)
                   └── covers (benefits from album_mbid)

enrich_artist ─── (independent, no downstream deps)

album_mbid ───── covers (MBID enables CAA lookup)

popularity ───── (independent)
```

Key insight: **All steps except album_genres can start immediately in parallel.** Covers benefit from waiting for album_mbid, but can fallback to Deezer without it.

---

## 3. Current Problems

### 3.1 Workers die from OOM → tasks stuck as "running" forever

Workers load Essentia + PANNs CNN14 model (~500MB) into RAM. Processing large albums can push RSS past limits. When a process is OOM-killed:
- The task stays in `running` status
- The only recovery is the 30-minute zombie check in `_cleanup_zombie_tasks()`
- During those 30 minutes, the task counts against `max_running`, blocking others

### 3.2 No real heartbeat mechanism

`updated_at` serves as a proxy heartbeat, but:
- Only updated when `update_task()` is explicitly called (progress updates)
- Steps like audio_analysis may run for 10+ minutes without updating
- The 30-minute zombie threshold is too generous — a stuck task blocks a worker slot for 30 min

### 3.3 No task timeout

There's no `max_duration` concept. A task can run forever. The only escape is OOM kill or the 30-min zombie check.

### 3.4 Monolith `process_new_content`

Does 8 things sequentially. A single slow step (audio analysis on 200 tracks) blocks everything else for that artist. Meanwhile, enrichment (3s) and popularity (20s) could have completed long ago.

### 3.5 Max running gate counts zombies

`claim_next_task()` counts ALL running tasks against max_running. Zombie tasks (from dead workers) count too, so the system can think it's at capacity when it's actually idle.

### 3.6 No priority system

Tasks are FIFO by `created_at`. A user clicking "download this album" waits behind 50 queued `process_new_content` tasks from a pipeline run. No way to say "user-initiated = urgent."

### 3.7 No retry for individual sub-steps

If `audio_analysis` fails inside `process_new_content`, the whole task fails. The only option is to re-run the entire pipeline for that artist — re-enriching, re-looking up MBIDs, etc.

### 3.8 No task deduplication for sub-steps

`create_task_dedup` only checks `type + params_json` exact match. Two different tasks wanting to enrich the same artist can't easily share a result.

### 3.9 Autoscaling is naive

Only scales UP (never down). Counts alive processes, not actually working ones. A worker polling with no tasks still counts as active.

---

## 4. Established Task Queue Systems Evaluation

### 4.1 Celery + Redis

**Architecture fit**: Celery is the de facto Python task queue. We already run Redis (for cache). Redis can serve as both broker (message transport) and result backend.

**Worker specialization**:
```python
# Define queues in celery config
task_queues = [
    Queue('fast', routing_key='fast'),      # enrichment, genre, mbid, popularity
    Queue('heavy', routing_key='heavy'),    # audio_analysis, bliss
    Queue('general', routing_key='general'), # sync, pipeline, downloads
]

# Start workers per pool
celery -A crate.celery worker -Q fast -c 3 --hostname=fast@%h
celery -A crate.celery worker -Q heavy -c 1 --hostname=heavy@%h --max-memory-per-child=2000000
celery -A crate.celery worker -Q general -c 2 --hostname=general@%h
```

**Task chaining for sub-tasks**:
```python
from celery import chain, group, chord

def process_new_content(artist_name):
    """Coordinator — fan out sub-tasks, then finalize."""
    return chord(
        group(
            enrich_artist.si(artist_name),
            index_genres.si(artist_name),
            lookup_mbids.si(artist_name),
            compute_popularity.si(artist_name),
        ),
        finalize_step.s(artist_name)  # after all I/O done
    ) | group(
        analyze_audio.si(artist_name),    # CPU tasks after I/O
        compute_bliss.si(artist_name),
    ) | save_content_hash.si(artist_name)
```

**Retry policies**:
```python
@app.task(bind=True, max_retries=3, default_retry_delay=60,
          rate_limit='10/m', soft_time_limit=300, time_limit=600)
def enrich_artist(self, artist_name):
    try:
        ...
    except RateLimitError as exc:
        raise self.retry(exc=exc, countdown=30)
```

**Priority**: Celery supports priority 0-9 with Redis broker (requires `x-max-priority` queue setting). Not as robust as RabbitMQ priorities, but functional.

**Monitoring**: Flower provides a web dashboard (task history, worker status, rate monitoring). Runs as a separate container.

**Pros**:
- Battle-tested at massive scale (Instagram, Mozilla, etc.)
- Rich primitives: chain, group, chord, map, starmap
- Built-in retry with exponential backoff
- Worker prefork pool with `--max-memory-per-child` (replaces our manual RSS check)
- `soft_time_limit` / `time_limit` per task
- Built-in rate limiting per task type
- Flower monitoring dashboard
- ETA/countdown scheduling (replaces our scheduler)
- No need for our `claim_next_task` / `FOR UPDATE SKIP LOCKED` logic

**Cons**:
- Heavy dependency (~30 transitive packages)
- Celery 5.x has had stability issues; 5.4+ is better
- Configuration complexity (dozens of settings)
- Redis broker lacks some features vs RabbitMQ (no true priority queues, weaker delivery guarantees)
- Result backend adds Redis memory pressure
- Debugging Celery issues can be painful (cryptic errors, pickle/serialization gotchas)
- We lose our PostgreSQL task history unless we dual-write

### 4.2 Celery + RabbitMQ

Same as above, but with RabbitMQ as the message broker instead of Redis.

**Additional pros over Redis broker**:
- True priority queues (0-255)
- Better delivery guarantees (message acknowledgment, persistence)
- Dead letter queues built-in
- Better under high contention

**Additional cons**:
- New infrastructure dependency (another Docker container, ~150MB RAM)
- More operational complexity (Erlang runtime, management plugin)
- Overkill for our scale (~900 artists, single server)

### 4.3 Dramatiq + Redis

**Overview**: Dramatiq is a simpler alternative to Celery, designed to fix its pain points. Created by Bogdan Popa as a reaction to Celery's complexity.

**Architecture fit**: Uses Redis as broker. Workers are plain Python processes. Simpler configuration.

```python
import dramatiq
from dramatiq.brokers.redis import RedisBroker

broker = RedisBroker(url="redis://redis:6379/1")
dramatiq.set_broker(broker)

@dramatiq.actor(queue_name="fast", max_retries=3, min_backoff=1000, max_backoff=60000,
                time_limit=300_000)  # ms
def enrich_artist(artist_name: str):
    ...

@dramatiq.actor(queue_name="heavy", time_limit=3600_000)
def analyze_audio(artist_name: str):
    ...
```

**Worker pools**: Named queues with dedicated processes.
```bash
dramatiq crate.tasks -Q fast -p 3
dramatiq crate.tasks -Q heavy -p 1
```

**Task coordination**: Dramatiq has `group` and `pipeline` primitives:
```python
import dramatiq
from dramatiq import group, pipeline

g = group([
    enrich_artist.message(artist_name),
    index_genres.message(artist_name),
    lookup_mbids.message(artist_name),
]).run()
```

However, Dramatiq's `group().then(callback)` is less ergonomic than Celery's `chord`. No built-in equivalent of Celery's complex workflows.

**Pros**:
- Simpler API, better defaults
- Fewer dependencies than Celery
- Built-in retry with exponential backoff
- Per-actor time limits and rate limits
- Better error messages
- Worker health monitoring via `dramatiq-dashboard` (basic)
- Supports Redis and RabbitMQ brokers

**Cons**:
- Smaller ecosystem and community than Celery
- Less battle-tested at scale
- Group/pipeline coordination is less powerful than Celery's chord
- No built-in ETA/countdown scheduling (need `dramatiq-crontab` or `APScheduler`)
- `dramatiq-dashboard` is minimal compared to Flower
- We still lose PostgreSQL task history

### 4.4 Huey

**Overview**: Minimal task queue by Charles Leifer (author of Peewee ORM). Intentionally small.

```python
from huey import RedisHuey

huey = RedisHuey('crate', host='redis')

@huey.task(retries=3, retry_delay=30, priority=0)
def enrich_artist(artist_name):
    ...

@huey.task(queue='heavy')
def analyze_audio(artist_name):
    ...
```

**Pros**:
- Tiny codebase (~3K lines), easy to understand and debug
- Redis-backed, minimal dependencies
- Built-in periodic tasks (crontab decorator)
- Priority support
- Result storage
- Pipeline and task chaining

**Cons**:
- Single-threaded consumer by default (can use `-w N` for workers, but all in one process)
- No worker pool specialization (no named queues routing to different consumer processes)
- No built-in time limits (must implement manually)
- No monitoring dashboard
- Not designed for CPU-bound workloads with memory isolation
- Community is small
- **Dealbreaker**: No multi-process worker pools with queue specialization — we need heavy tasks isolated from fast tasks

### 4.5 ARQ (Async Redis Queue)

**Overview**: asyncio-native task queue by Samuel Colvin (author of Pydantic).

```python
from arq import cron, func
from arq.connections import RedisSettings

async def enrich_artist(ctx, artist_name: str):
    ...

class WorkerSettings:
    functions = [func(enrich_artist, name='enrich_artist')]
    redis_settings = RedisSettings(host='redis')
    max_jobs = 10
    job_timeout = 300
    health_check_interval = 30
```

**Pros**:
- Lightweight, modern, asyncio-native
- Built-in health checks and job timeouts
- Cron scheduling built-in
- Clean API

**Cons**:
- **All workers must be async** — our entire codebase (Essentia, mutagen, psycopg2, subprocess calls) is synchronous. Migration would require wrapping everything in `run_in_executor()`.
- No named queues / worker pool specialization
- Small community
- No monitoring dashboard
- Limited task coordination (no group/chord)
- **Dealbreaker**: Async requirement forces massive code changes for zero benefit (our workloads are CPU-bound or blocking I/O)

### 4.6 Custom with Improvements (Enhanced PostgreSQL-based)

Keep our existing PostgreSQL task store but add the missing features.

```sql
ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 2;
ALTER TABLE tasks ADD COLUMN pool TEXT DEFAULT 'general';
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN max_duration_sec INTEGER DEFAULT 1800;
ALTER TABLE tasks ADD COLUMN heartbeat_at TEXT;
ALTER TABLE tasks ADD COLUMN worker_id TEXT;
```

**Worker pools**: Each worker process is assigned a pool at spawn. `claim_next_task(pool='fast')` only claims tasks with matching pool.

**Sub-task coordination**: Parent task creates children with `parent_task_id`. Orchestrator monitors children and marks parent as complete when all children finish.

**Heartbeat**: Workers call `heartbeat_task(task_id)` every 30s. Orchestrator marks tasks without heartbeat for >5min as failed.

**Pros**:
- Zero new infrastructure
- Full control, tailored to our needs
- Task history stays in PostgreSQL (queryable, API-visible)
- Incremental migration — change one thing at a time
- No serialization format issues (we control params_json)
- Dedup logic already exists
- Workers already manage their own lifecycle (recycle on OOM)

**Cons**:
- We maintain it ourselves
- PostgreSQL polling (2s interval) has higher latency than Redis pub/sub push
- No built-in retry with backoff (must implement)
- No built-in rate limiting (must implement)
- No monitoring dashboard (must build or use existing task UI)
- Must implement task chaining/coordination from scratch
- Risk of re-inventing wheels poorly

### 4.7 Comparison Matrix

| Feature | Custom+PG | Celery+Redis | Celery+RMQ | Dramatiq | Huey | ARQ |
|---------|-----------|-------------|------------|----------|------|-----|
| Worker pools | Must build | Yes (named queues) | Yes (named queues) | Yes (named queues) | No | No |
| Task chains/groups | Must build | Yes (chord, group, chain) | Yes (chord, group, chain) | Basic (group, pipeline) | Basic (pipeline) | No |
| Retry/backoff | Must build | Yes (exponential) | Yes (exponential) | Yes (exponential) | Yes (fixed delay) | Yes (fixed) |
| Priority queues | Easy (SQL ORDER BY) | Partial (Redis) | Yes (0-255) | No | Yes | No |
| Rate limiting | Must build | Yes (per task) | Yes (per task) | Yes (per actor) | No | No |
| Monitoring UI | Existing task page | Flower | Flower | dramatiq-dashboard | No | No |
| Dead letter queue | Must build | Yes | Yes (native) | No | No | No |
| Heartbeat/timeout | Must build | Yes (--without-heartbeat to disable) | Yes | Yes (time_limit) | No | Yes |
| New infra needed | None | None (have Redis) | RabbitMQ container | None (have Redis) | None (have Redis) | None (have Redis) |
| Migration effort | Low (incremental) | High (rewrite handlers) | High (rewrite + RMQ) | Medium (rewrite handlers) | Medium | Very High (async) |
| Memory overhead | None | ~100MB per worker | ~150MB RMQ + workers | ~80MB per worker | ~50MB | ~50MB |
| Task visibility | PostgreSQL (full SQL) | Redis (ephemeral) + optional DB | Redis/RMQ (ephemeral) | Redis (ephemeral) | Redis (ephemeral) | Redis (ephemeral) |
| Python 3.13 compat | Yes | Yes (Celery 5.4+) | Yes | Yes | Yes | Yes |
| Scheduling (cron) | Our scheduler.py | celery beat | celery beat | APScheduler addon | Built-in | Built-in |

### 4.8 Recommendation

**Dramatiq + Redis** is the best fit for our use case. Here's why:

1. **We already have Redis.** No new infrastructure.
2. **Named queues** map directly to our pool concept (fast/heavy/general).
3. **Simpler than Celery** — fewer footguns, better error messages, fewer dependencies. At our scale (~900 artists, single server), Celery's power is overkill and its complexity is liability.
4. **Built-in retry with exponential backoff** — exactly what we need for API rate limits (Last.fm, MusicBrainz, Spotify).
5. **Time limits per actor** — solves the "audio analysis runs forever" problem.
6. **synchronous workers** — unlike ARQ, fits our existing codebase perfectly.
7. **Migration is tractable** — our task handlers are already clean functions `(task_id, params, config) -> dict`. Converting to Dramatiq actors is mechanical.

**However**, there's a significant downside: **we lose PostgreSQL task visibility.** Our current UI shows task history, progress, results — all from the `tasks` table. With Dramatiq, tasks live in Redis and are ephemeral.

**Hybrid approach**: Use Dramatiq for execution, but keep the `tasks` table for visibility. Each Dramatiq actor starts by creating a DB task row, updates progress there, and marks it complete/failed. This gives us:
- Dramatiq's execution engine (queues, retry, timeout, worker pools)
- PostgreSQL's queryability (task history, progress API, dedup)

**If we want to avoid a new dependency entirely**, the Custom+PG approach is the second-best option. The incremental migration path is lower risk. The features we need (priority, heartbeat, sub-tasks, pools) are straightforward to implement in SQL + Python. We just accept the 2s polling latency and maintain the code ourselves.

**My ranking**:
1. **Dramatiq + Redis** (with PG shadow table for visibility) — best balance
2. **Custom + PG improvements** — safest, most incremental
3. **Celery + Redis** — if we need industrial-strength features later
4. Everything else — poor fit for various reasons

---

## 5. Proposed Redesign: Specialized Worker Pools + Sub-tasks

### 5.1 `process_new_content` Becomes a Coordinator

Instead of one monolith task, the coordinator creates independent sub-tasks:

```
process_new_content(artist="Converge")
  ├── organize_folders(artist="Converge")        → pool: general
  ├── enrich_artist(artist="Converge")            → pool: fast     [I/O, 5-15s]
  ├── index_genres(artist="Converge")             → pool: fast     [DB, <1s]
  ├── lookup_mbids(artist="Converge")             → pool: fast     [I/O, 5-60s]
  ├── compute_popularity(artist="Converge")       → pool: fast     [I/O, 20s]
  ├── fetch_covers(artist="Converge")             → pool: fast     [I/O, 5-30s]  (after mbids)
  ├── analyze_audio(artist="Converge")            → pool: heavy    [CPU, 150s]
  └── compute_bliss(artist="Converge")            → pool: heavy    [CPU, 100s]
```

The coordinator:
1. Creates all sub-tasks with `parent_task_id` pointing to itself
2. Sets status to `running` and waits (polls every 5s)
3. When all children are `completed`/`failed`, marks itself done
4. Reports aggregate results

Dependencies are handled by ordering within the same pool or explicit `depends_on`:
- `fetch_covers` can declare a soft dependency on `lookup_mbids` (proceed after N seconds even if mbids not done)
- `analyze_audio` and `compute_bliss` are fully independent

### 5.2 Worker Pools

```
Pool: "fast" (3 workers, ~200MB RAM each)
  Tasks: enrich_artist, index_genres, lookup_mbids, compute_popularity,
         fetch_covers, check_new_releases, scan_missing_covers,
         backfill_similarities, sync_shows
  Character: I/O-bound, lots of HTTP + light DB, fast completion

Pool: "heavy" (1 worker, up to 2GB RAM)
  Tasks: analyze_audio (Essentia/PANNs), compute_bliss (Rust subprocess)
  Character: CPU-bound, memory-intensive, long-running

Pool: "general" (2 workers, ~500MB RAM each)
  Tasks: library_sync, library_pipeline, health_check, repair,
         tidal_download, soulseek_download, delete_artist, delete_album,
         move_artist, wipe_library, rebuild_library, scan,
         process_new_content (coordinator only), enrich_mbids,
         compute_analytics, update_album_tags, update_track_tags,
         match_apply, upload_image, map_navidrome_ids
  Character: Mixed workload, filesystem I/O, moderate DB
```

### 5.3 Task Priority Queues

```
Priority 0 (critical):  User-initiated immediate actions
  → tidal_download, soulseek_download, delete_artist, delete_album,
    move_artist, update_album_tags, update_track_tags, match_apply,
    fetch_cover, upload_image

Priority 1 (high):  New content processing
  → process_new_content (coordinator), enrich_artist (single),
    analyze_album_full

Priority 2 (normal):  Scheduled recurring tasks
  → library_pipeline, health_check, repair, library_sync,
    compute_analytics, check_new_releases

Priority 3 (low):  Background batch operations
  → enrich_artists (all), enrich_mbids, compute_popularity (all),
    compute_bliss (all), index_genres (all), scan_missing_covers,
    backfill_similarities, sync_shows, cleanup_incomplete_downloads
```

Implementation in `claim_next_task`:
```sql
SELECT * FROM tasks
WHERE status = 'pending' AND pool = %s
ORDER BY priority ASC, created_at ASC
LIMIT 1 FOR UPDATE SKIP LOCKED
```

### 5.4 Heartbeat + Timeout

**Workers send heartbeats** by updating `heartbeat_at` every 30s during task execution:

```python
def _heartbeat_loop(task_id):
    """Background thread that updates heartbeat while task runs."""
    while not _stop_heartbeat.is_set():
        try:
            with get_db_ctx() as cur:
                cur.execute("UPDATE tasks SET heartbeat_at = %s WHERE id = %s",
                           (datetime.now(timezone.utc).isoformat(), task_id))
        except Exception:
            pass
        _stop_heartbeat.wait(30)
```

**Orchestrator detects dead tasks** — any task with `status='running'` and `heartbeat_at` older than 5 minutes (or null after 2 minutes) is marked as failed:

```python
def _cleanup_zombie_tasks(self):
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE tasks SET status = 'failed', error = 'Worker died (no heartbeat)'
            WHERE status = 'running'
              AND (heartbeat_at IS NULL AND updated_at < NOW() - INTERVAL '2 minutes'
                   OR heartbeat_at < NOW() - INTERVAL '5 minutes')
        """)
```

**Per-task timeouts** via `max_duration_sec`:

| Task Type | Default Timeout |
|-----------|----------------|
| enrich_artist | 120s |
| index_genres | 60s |
| lookup_mbids | 300s |
| analyze_audio | 7200s (2h) |
| compute_bliss | 3600s (1h) |
| compute_popularity | 600s |
| fetch_covers | 300s |
| library_sync | 3600s |
| library_pipeline | 7200s |
| tidal_download | 1800s |
| process_new_content | 14400s (4h, coordinator) |
| Default | 1800s (30min) |

---

## 6. Database Schema Changes

```sql
-- New columns on tasks table
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;
ALTER TABLE tasks ADD COLUMN pool TEXT NOT NULL DEFAULT 'general';
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN max_duration_sec INTEGER NOT NULL DEFAULT 1800;
ALTER TABLE tasks ADD COLUMN heartbeat_at TEXT;
ALTER TABLE tasks ADD COLUMN worker_id TEXT;
ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0;

-- Index for efficient claim queries
CREATE INDEX IF NOT EXISTS idx_tasks_claim
  ON tasks (pool, priority, created_at)
  WHERE status = 'pending';

-- Index for parent task lookups
CREATE INDEX IF NOT EXISTS idx_tasks_parent
  ON tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- Index for heartbeat monitoring
CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat
  ON tasks (heartbeat_at)
  WHERE status = 'running';
```

### Pool + Priority defaults per task type:

```python
TASK_DEFAULTS = {
    # pool, priority, max_duration_sec, max_retries
    "enrich_artist":       ("fast", 1, 120, 2),
    "index_genres":        ("fast", 3, 60, 1),
    "lookup_mbids":        ("fast", 1, 300, 2),
    "compute_popularity":  ("fast", 3, 600, 1),
    "fetch_covers":        ("fast", 1, 300, 2),
    "analyze_audio":       ("heavy", 1, 7200, 1),
    "compute_bliss":       ("heavy", 1, 3600, 1),
    "library_sync":        ("general", 2, 3600, 0),
    "library_pipeline":    ("general", 2, 7200, 0),
    "tidal_download":      ("general", 0, 1800, 2),
    "process_new_content": ("general", 1, 14400, 0),
    "delete_artist":       ("general", 0, 300, 0),
    "delete_album":        ("general", 0, 300, 0),
    # ... etc
}
```

---

## 7. Implementation Plan

### Phase 1: Heartbeat + Timeout + Priority (Week 1)

**Goal**: Fix the most critical problems — zombie tasks and no priority — with minimal risk.

Changes:
1. Add `heartbeat_at`, `priority`, `max_duration_sec`, `worker_id` columns to `tasks` table (migration in `init_db`)
2. Worker processes start a heartbeat thread when claiming a task
3. `_cleanup_zombie_tasks()` uses `heartbeat_at` instead of `updated_at` age
4. `create_task()` accepts `priority` parameter, uses `TASK_DEFAULTS` lookup
5. `claim_next_task()` adds `ORDER BY priority ASC` before `created_at`
6. Set user-initiated tasks to priority 0

**Risk**: Low. All changes are additive. Existing tasks default to priority 2.

### Phase 2: Worker Pools (Week 2)

**Goal**: Isolate CPU-heavy tasks from fast I/O tasks.

Changes:
1. Add `pool` column to `tasks` table
2. `create_task()` looks up pool from `TASK_DEFAULTS`
3. `claim_next_task(pool='fast')` — each worker only claims from its pool
4. Orchestrator spawns workers with a pool assignment: `_spawn_worker(pool='fast')`
5. Pool configuration in settings: `{"fast": 3, "heavy": 1, "general": 2}`
6. Autoscaler respects per-pool pending counts

**Risk**: Medium. Requires orchestrator changes and careful pool sizing. If heavy pool is full and fast tasks accumulate, we need to ensure fast workers aren't idle.

**Mitigation**: Workers can have a fallback pool — if their primary queue is empty for 30s, they check `general`.

### Phase 3: Sub-tasks for `process_new_content` (Week 3-4)

**Goal**: Break the megalodon into independent, parallelizable sub-tasks.

Changes:
1. Add `parent_task_id` column to `tasks` table
2. `_handle_process_new_content()` becomes a coordinator:
   - Creates 7 sub-tasks with `parent_task_id` pointing to itself
   - Enters a monitoring loop (poll every 5s)
   - Aggregates results when all children complete
3. Each sub-step becomes a standalone task handler:
   - `_handle_pnc_enrich` (pool: fast)
   - `_handle_pnc_genres` (pool: fast)
   - `_handle_pnc_mbids` (pool: fast)
   - `_handle_pnc_analyze` (pool: heavy)
   - `_handle_pnc_bliss` (pool: heavy)
   - `_handle_pnc_popularity` (pool: fast)
   - `_handle_pnc_covers` (pool: fast)
4. Content hash check stays in coordinator (before creating children)
5. Each sub-task is independently retryable

**Risk**: Medium-high. The coordinator pattern adds complexity. Must handle:
- Partial failure (some children fail, others succeed)
- Cancellation propagation (cancel parent → cancel all pending children)
- Progress aggregation for UI

**Mitigation**: Start with a simple polling coordinator. Don't use callbacks or events — just poll children status every 5s.

### Phase 4 (Optional): Migrate to Dramatiq (Week 5-6)

**Goal**: Replace custom orchestrator with Dramatiq for execution, keep PG for visibility.

Changes:
1. Install `dramatiq[redis]`
2. Define actors for each task handler (thin wrappers)
3. Each actor creates/updates a PG task row for UI visibility
4. Configure named queues: fast, heavy, general
5. Replace orchestrator process spawning with `dramatiq` CLI workers
6. Replace scheduler with `APScheduler` or `dramatiq-crontab`
7. Replace `claim_next_task` with Dramatiq queue dispatch

**Risk**: High. Major rewrite of the execution layer. Should only be done after Phase 1-3 prove the sub-task model works.

**When to do this**: If we find ourselves spending too much time maintaining the custom orchestrator, or if we need features like exponential backoff, rate limiting, or multi-server workers.

### Summary

| Phase | Effort | Impact | Risk |
|-------|--------|--------|------|
| 1: Heartbeat + Priority | 2-3 days | High (fixes zombie + priority) | Low |
| 2: Worker Pools | 3-4 days | High (isolates CPU from I/O) | Medium |
| 3: Sub-tasks | 5-7 days | Very High (parallel processing) | Medium-High |
| 4: Dramatiq | 7-10 days | Medium (better primitives) | High |

Phases 1-3 can be done incrementally with zero downtime. Phase 4 is a bigger bet that should only happen once 1-3 are proven.
