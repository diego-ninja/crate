# API Performance Overhaul

> **For Claude:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate API responsiveness loss during heavy worker loads on a 4-core / 6GB RAM server serving 4-5 concurrent users.

**Architecture:** Separate resource pools for API vs workers, in-memory auth cache, Redis pub/sub for SSE, scheduled download windows, and right-sized process counts.

**Tech Stack:** PostgreSQL (connection tuning), Redis (pub/sub, caching), Uvicorn (multi-worker), Dramatiq (reduced processes)

---

## Server Profile

- 4 cores, 5.7GB RAM
- 4-5 concurrent users, 20-30 registered
- Tidal downloads: infrequent, can be scheduled overnight (02:00–07:00)
- Analysis daemons: mostly idle, fast when active (seconds per track)
- All services on one machine (API, workers, PostgreSQL, Redis, nginx, Traefik)

## Current Resource Allocation (the problem)

| Component | Processes | DB Connections | Notes |
|-----------|-----------|---------------|-------|
| Uvicorn API | 1 | up to 15 (shared pool) | Single-threaded, blocks on sync DB |
| Dramatiq workers | 6 | up to 15 (shared pool) | More processes than CPU cores |
| Analysis daemon | 1 thread | from shared pool | Claims + marks done per track |
| Bliss daemon | 1 thread | from shared pool | Same pattern |
| Auth middleware | — | 2-3 queries per request | No caching |
| SSE endpoints | — | 1 connection per client, polling | Permanently held |
| **Total pool** | — | **10 + 5 overflow = 15** | **Shared by everything** |

When a heavy task runs (download + enrichment), workers claim most connections → API starves → 4-5 users experience latency spikes or timeouts.

---

## Target Resource Allocation

| Component | Processes | DB Connections | Change |
|-----------|-----------|---------------|--------|
| Uvicorn API | 2 workers | dedicated pool: 8 + 4 overflow = 12 | +1 worker, dedicated pool |
| Dramatiq workers | 3 | dedicated pool: 6 + 3 overflow = 9 | -3 processes, dedicated pool |
| Analysis daemon | 1 thread | from worker pool | unchanged |
| Bliss daemon | 1 thread | from worker pool | unchanged |
| Auth middleware | — | 0 per request (cached) | eliminated DB queries |
| SSE endpoints | — | 0 (Redis pub/sub) | eliminated DB polling |
| **Total** | **5 processes** | **21 connections max** | **was 7 processes, 15 connections** |

---

## Implementation Plan

### Phase 1: Quick Configuration Wins (no code changes)

#### Task 1: Right-size Dramatiq processes

**File:** `app/crate/worker.py` (default), `app/crate/__main__.py` (CLI arg)

Change default from 6 to 3 processes:
```python
# __main__.py
worker_cmd.add_argument("--processes", type=int, default=3, ...)
```

Also update `docker-compose.yaml` and `docker-compose.dev.yaml` if they override.

**Why 3:** 4 cores - 1 for API = 3. Workers are I/O bound (network calls to Last.fm, Tidal, MusicBrainz), not CPU bound, so 3 processes with 1 thread each is enough. The download slot limiter already caps concurrent downloads.

#### Task 2: Add Uvicorn workers

**File:** `app/crate/__main__.py`

```python
uvicorn.run(app, host=args.host, port=args.port, 
            log_level="info", workers=2)
```

**Why 2:** With 4 cores, 2 API workers + 3 Dramatiq = 5 processes for 4 cores. Each uvicorn worker handles concurrent async I/O. Sync DB calls still block per-worker, but 2 workers means one can serve while the other waits on DB.

#### Task 3: Increase and split connection pools

**File:** `app/crate/db/engine.py`

Currently one global pool (10+5). Split into two:

```python
# API pool — read-heavy, many short queries
API_POOL_SIZE = 8
API_MAX_OVERFLOW = 4

# Worker pool — fewer connections, longer transactions
WORKER_POOL_SIZE = 6
WORKER_MAX_OVERFLOW = 3
```

Detection: `engine.py` checks `CRATE_RUNTIME` env var:
- API container sets `CRATE_RUNTIME=api` → uses API pool config
- Worker container sets `CRATE_RUNTIME=worker` → uses worker pool config

Since both containers build from the same Dockerfile, this is just an env var in docker-compose.

#### Task 4: Configure Redis memory limit

**File:** `docker-compose.yaml`, `docker-compose.dev.yaml`

```yaml
redis:
  command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

Prevents Redis from consuming unbounded memory on a constrained server.

---

### Phase 2: Auth Cache (highest impact code change)

#### Task 5: In-memory session + user cache with TTL

**File:** Create `app/crate/api/auth_cache.py`

```python
_session_cache: dict[str, tuple[float, dict]] = {}
_user_cache: dict[int, tuple[float, dict]] = {}
_TTL = 10  # seconds

def get_cached_session(session_id: str) -> dict | None:
    entry = _session_cache.get(session_id)
    if entry and (time.monotonic() - entry[0]) < _TTL:
        return entry[1]
    session = get_session(session_id)  # DB call
    if session:
        _session_cache[session_id] = (time.monotonic(), session)
    return session

def get_cached_user(user_id: int) -> dict | None:
    entry = _user_cache.get(user_id)
    if entry and (time.monotonic() - entry[0]) < _TTL:
        return entry[1]
    user = get_user_by_id(user_id)  # DB call
    if user:
        _user_cache[user_id] = (time.monotonic(), user)
    return user

def invalidate_session(session_id: str):
    _session_cache.pop(session_id, None)

def invalidate_user(user_id: int):
    _user_cache.pop(user_id, None)
```

**File:** Modify `app/crate/api/auth.py` AuthMiddleware

Replace:
```python
session = get_session(session_id)  # line 380
current_user = get_user_by_id(payload["user_id"])  # line 396
```

With:
```python
from crate.api.auth_cache import get_cached_session, get_cached_user
session = get_cached_session(session_id)
current_user = get_cached_user(payload["user_id"])
```

#### Task 6: Batch touch_session updates

**File:** Modify `app/crate/api/auth.py`

Currently `touch_session()` writes to DB on every authenticated request (line 403-408). Replace with a batched approach:

```python
_touch_buffer: dict[str, float] = {}  # session_id → last_touch_time
_TOUCH_INTERVAL = 60  # seconds — only touch DB once per minute per session

# In middleware dispatch:
now = time.monotonic()
last_touch = _touch_buffer.get(session_id, 0)
if now - last_touch > _TOUCH_INTERVAL:
    touch_session(session_id, ...)
    _touch_buffer[session_id] = now
```

**Impact:** Eliminates 1 DB write per request → reduces from 3 queries/request to 0-1 queries/request (cache hit = 0 queries).

---

### Phase 3: SSE → Redis Pub/Sub

#### Task 7: Redis-based event bus for SSE

**File:** Modify `app/crate/api/events.py`

Replace the polling loop:
```python
# BEFORE: polls DB every 2 seconds
while True:
    running = list_tasks(status="running", limit=5)
    await asyncio.sleep(2)
```

With Redis pub/sub:
```python
# AFTER: subscribes to Redis channel, yields on message
import aioredis

async def _event_stream():
    redis = aioredis.from_url(REDIS_URL)
    pubsub = redis.pubsub()
    await pubsub.subscribe("crate:events")
    
    # Initial snapshot
    yield f"data: {json_dumps(get_status_snapshot())}\n\n"
    
    async for message in pubsub.listen():
        if message["type"] == "message":
            yield f"data: {message['data'].decode()}\n\n"
```

**Publisher side** (in task completion, emit_task_event):
```python
redis.publish("crate:events", json.dumps(event_data))
```

This eliminates ALL DB polling from SSE endpoints. Each connected client holds a Redis subscription (cheap) instead of a PostgreSQL connection (expensive).

#### Task 8: Publish events from worker task lifecycle

**File:** Modify `app/crate/actors.py` (_execute_task)

After task status changes (running, completed, failed), publish to Redis:
```python
redis.publish("crate:events", json.dumps({
    "type": "task_status",
    "task_id": task_id,
    "status": "completed",
    "task_type": task_type,
}))
```

**File:** Modify `app/crate/db/events.py` (emit_task_event)

Also publish per-task events so the task-specific SSE stream works:
```python
redis.publish(f"crate:task:{task_id}", json.dumps(event_data))
```

---

### Phase 4: Download Scheduling

#### Task 9: Download window configuration

**File:** `app/crate/db/cache.py` (settings), admin Settings page

New settings:
```python
"download_window_enabled": "true",
"download_window_start": "02:00",  # UTC
"download_window_end": "07:00",    # UTC
```

#### Task 10: Enforce download window in task dispatch

**File:** Modify `app/crate/actors.py`

Before executing a download task, check if we're inside the window:
```python
if task_type in DOWNLOAD_TASK_TYPES:
    if not _is_in_download_window():
        # Re-enqueue with delay until window opens
        delay_ms = _ms_until_download_window()
        actor.send_with_options(args=(task_id,), delay=delay_ms)
        update_task(task_id, status="pending", 
                    progress="Scheduled for download window")
        return
```

If window is disabled (`download_window_enabled=false`), downloads run immediately (current behavior).

Admin UI: add toggle + time pickers in Settings page.

---

### Phase 5: Query Optimizations

#### Task 11: Cache auth config and provider status

**File:** Modify `app/crate/api/auth.py`

`_provider_status()` and `_allowed_redirect_origins()` read settings from DB on every call. Cache with 60s TTL:

```python
_provider_status_cache: tuple[float, dict] | None = None

def _provider_status(request=None) -> dict:
    global _provider_status_cache
    if _provider_status_cache and (time.monotonic() - _provider_status_cache[0]) < 60:
        return _provider_status_cache[1]
    # ... existing DB queries ...
    _provider_status_cache = (time.monotonic(), result)
    return result
```

#### Task 12: Cache track-to-path mapping for streaming

**File:** Modify `app/crate/api/browse_media.py`

Currently every stream request queries DB for track path. Add LRU cache:

```python
from functools import lru_cache

@lru_cache(maxsize=4096)
def _cached_track_path(track_id: int) -> str | None:
    return get_track_path(track_id)
```

Invalidated on library sync (clear the cache). For 48K tracks, 4096 entries covers the hot set.

#### Task 13: Make cache invalidation non-blocking

**File:** Modify `app/crate/api/cache_events.py`

Currently `broadcast_invalidation()` blocks the HTTP response while clearing caches. Make it fire-and-forget:

```python
import threading

def broadcast_invalidation(*scopes: str):
    threading.Thread(
        target=_do_broadcast, args=(scopes,), daemon=True
    ).start()

def _do_broadcast(scopes):
    # ... existing Redis + cache clear logic ...
```

The response returns immediately; cache clearing happens in background.

---

### Phase 6: Daemon Optimization

#### Task 14: Analysis daemon connection hygiene

**File:** Modify `app/crate/db/jobs/analysis.py`

The daemon claims tracks with `FOR UPDATE SKIP LOCKED` which is correct and fast. But each claim/mark_done opens a new `transaction_scope()`. On a busy server, these micro-transactions add up.

Optimization: batch mark_done when processing completes, and add a connection check before claiming:

```python
def claim_track(state_column):
    # Add a quick check before the FOR UPDATE lock
    with transaction_scope() as session:
        count = session.execute(
            text(f"SELECT COUNT(*) FROM library_tracks WHERE {col} = 'pending' LIMIT 1")
        ).scalar()
        if not count:
            return None  # Skip the expensive FOR UPDATE query
        # ... existing claim logic ...
```

This avoids acquiring a row lock when there's nothing to process (the common case when idle).

---

## Implementation Order

```
Phase 1 (Tasks 1-4)   — Configuration wins          [30 min, no code risk]
Phase 2 (Tasks 5-6)   — Auth cache                  [1 session]
Phase 5 (Tasks 11-13) — Query caching               [1 session]
Phase 3 (Tasks 7-8)   — SSE Redis pub/sub           [1-2 sessions]
Phase 4 (Tasks 9-10)  — Download scheduling          [1 session]
Phase 6 (Task 14)     — Daemon optimization          [30 min]
```

Phase 1 is zero-risk configuration. Phase 2 has the highest impact-to-effort ratio. Phase 3 is the biggest refactor but eliminates the worst resource leak. Phase 4 is a product feature that also helps performance.

---

## Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| DB queries per API request | 2-3 (auth) | 0-1 (cached) | ~70% reduction |
| Connection pool pressure | 15 shared | 12 API + 9 worker (isolated) | No cross-starvation |
| SSE DB connections | 1 per client (polling) | 0 (Redis pub/sub) | 100% elimination |
| Concurrent processes | 7 (1 API + 6 workers) | 5 (2 API + 3 workers) | Better per-core utilization |
| Download impact on API | Immediate, competes for resources | Scheduled window, isolated pool | Zero daytime impact |
| Auth middleware latency | 5-15ms (3 DB round-trips) | <0.1ms (memory cache hit) | ~99% reduction |

## Verification

1. Run Tidal download + enrichment simultaneously → API p95 stays under 500ms
2. 4 concurrent users browsing → no perceivable delay
3. SSE streams don't consume DB connections (check `pg_stat_activity`)
4. Download tasks defer to window when enabled
5. Auth cache hit rate >95% (log cache hits/misses for first 24h)
6. `docker stats` shows <4GB RAM usage across all containers
