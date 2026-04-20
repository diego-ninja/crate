# Observability Overhaul: Health Dashboard + Task/Event Logging

> **For Claude:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Production-grade observability: time-series metrics with dashboards, standardized task progress with rich UI, unified event logging with filtering, Telegram alerts on degradation, per-worker log visibility.

**Architecture:** Redis as primary metrics store (time-series buckets), PostgreSQL for persistence (daily rollups). Middleware captures API latency/errors. Workers emit structured progress events. New admin Health page with Nivo charts. Telegram alerting on threshold breaches.

**Tech Stack:** Redis (metrics hot store), PostgreSQL (cold store), FastAPI middleware (capture), Nivo charts (visualization), SSE (realtime), Telegram Bot API (alerts)

---

## Cross-Cutting Concerns (apply throughout all phases)

### CC-1: Task Type Human Labels

All task types must have a canonical human label. Currently some show `snake_case` in the UI, others use ad-hoc labels. Create a single registry:

**File:** `app/crate/task_registry.py`

```python
TASK_TYPE_LABELS: dict[str, str] = {
    "library_sync": "Library Scan",
    "scan": "Health Check",
    "process_new_content": "Process New Content",
    "enrich_artists": "Artist Enrichment",
    "enrich_artist": "Artist Enrichment",
    "audio_analysis": "Audio Analysis",
    "bliss_analysis": "Bliss Similarity",
    "tidal_download": "Tidal Download",
    "soulseek_download": "Soulseek Download",
    "index_genres": "Genre Indexing",
    "infer_genre_taxonomy": "Taxonomy Inference",
    "enrich_genre_descriptions": "Genre Description Enrichment",
    "sync_genre_musicbrainz": "MusicBrainz Sync",
    "cleanup_invalid_genre_taxonomy": "Taxonomy Cleanup",
    "generate_smart_playlist": "Smart Playlist Generation",
    "repair_library": "Library Repair",
    "migrate_storage": "Storage Migration",
    "update_popularity": "Popularity Update",
    "delete_artist": "Artist Deletion",
}

TASK_TYPE_ICONS: dict[str, str] = {
    "library_sync": "📂",
    "scan": "🔍",
    "process_new_content": "✨",
    "enrich_artists": "🔎",
    "audio_analysis": "🎵",
    "tidal_download": "📥",
    "index_genres": "🏷️",
    # ...
}

def task_label(task_type: str) -> str:
    return TASK_TYPE_LABELS.get(task_type, task_type.replace("_", " ").title())

def task_icon(task_type: str) -> str:
    return TASK_TYPE_ICONS.get(task_type, "⚙️")
```

Used by: API responses (add `label` field to task serialization), Telegram messages, admin UI (frontend also has a copy for display).

Frontend mirror: `app/ui/src/lib/task-labels.ts` (same map, used for display in Tasks page, Health dashboard, etc.)

### CC-2: Humanized Log Context

Every log entry, event, and progress message that references library entities must include human-readable context alongside IDs. Never show a UUID or numeric ID as the only identifier.

**Pattern:**
```python
# BAD
wlog.info(f"Processing track {track_id}", task_id=task_id)
emit_task_event(task_id, "item", {"track_id": track_id})

# GOOD
wlog.info(f"Processing: {artist} — {title}", task_id=task_id,
          category="enrichment",
          meta={"track_id": track_id, "artist": artist, "album": album, "title": title})
emit_task_event(task_id, "item", {
    "track_id": track_id,
    "label": f"{artist} — {title}",
    "artist": artist,
    "album": album,
})
```

**Rules:**
1. `label` field is mandatory in all event `data_json` — a single human-readable string summarizing the entity
2. If an ID (UUID, numeric, path) appears in a message, the corresponding name/title must appear too
3. Progress `item` field always uses `"Artist — Title"` or `"Artist — Album"` format, never a path or ID
4. Telegram notifications always use entity names, never raw IDs (task IDs shown as short codes: `a1b2c3d4`)

**Helper** (add to `app/crate/task_progress.py`):
```python
def entity_label(artist: str = "", album: str = "", title: str = "", path: str = "") -> str:
    """Build a human-readable label from whatever entity fields are available."""
    if artist and title:
        return f"{artist} — {title}"
    if artist and album:
        return f"{artist} — {album}"
    if artist:
        return artist
    if title:
        return title
    if path:
        return path.rsplit("/", 1)[-1]  # filename as last resort
    return "unknown"
```

---

## Phase A: Metrics Infrastructure (Backend)

### Task 1: Metrics Schema + Redis Time-Series Store

**Files:**
- Create: `app/crate/db/metrics.py`
- Create: `app/crate/metrics.py` (collection API)
- Modify: `app/crate/db/core.py` (add migration for rollup table)

**What it does:**
- Redis hash buckets: `metrics:{name}:{minute_timestamp}` with TTL 48h
- Each bucket: `{count, sum, min, max, p95_reservoir}` for histograms
- PostgreSQL `metric_rollups` table for daily aggregates (retained indefinitely):

```sql
CREATE TABLE metric_rollups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,              -- e.g. "api.latency", "worker.throughput"
    tags_json JSONB DEFAULT '{}',   -- e.g. {"endpoint": "/api/tracks/stream", "status": "200"}
    period TEXT NOT NULL,            -- "hour" | "day"
    bucket_start TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    sum_value DOUBLE PRECISION DEFAULT 0,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    avg_value DOUBLE PRECISION,
    p95_value DOUBLE PRECISION,
    UNIQUE(name, tags_json, period, bucket_start)
);
CREATE INDEX idx_metric_rollups_query ON metric_rollups(name, bucket_start DESC);
```

**Metrics collection API** (`app/crate/metrics.py`):
```python
def record(name: str, value: float, tags: dict | None = None):
    """Record a metric sample. Hot path — must be <1ms."""

def flush_to_postgres(period: str = "hour"):
    """Roll up Redis minute-buckets into PostgreSQL hourly/daily rows."""

def query(name: str, start: datetime, end: datetime, 
          period: str = "minute", tags: dict | None = None) -> list[dict]:
    """Read metric time-series. Returns [{timestamp, count, avg, min, max, p95}]."""
```

### Task 2: API Latency Middleware

**Files:**
- Create: `app/crate/api/metrics_middleware.py`
- Modify: `app/crate/api/__init__.py` (register middleware)

Captures per-request:
- `api.latency` — response time in ms, tagged by `{method, path_template, status}`
- `api.requests` — counter, same tags
- `api.errors` — counter for 5xx responses

Path normalization: `/api/tracks/12345/stream` → `/api/tracks/{id}/stream`

### Task 3: Worker Metrics Emission

**Files:**
- Modify: `app/crate/worker.py` (emit on task start/complete/fail)
- Modify: `app/crate/db/tasks.py` (add duration calculation)

Captures:
- `worker.task.duration` — seconds, tagged by `{type, pool, status}`
- `worker.task.throughput` — counter, tagged by `{type}`
- `worker.queue.depth` — gauge, sampled every 30s in service loop
- `worker.queue.wait` — time from created_at to started_at

### Task 4: Streaming Metrics

**Files:**
- Modify: `app/crate/api/browse_media.py` (stream endpoint instrumentation)

Captures:
- `stream.requests` — counter, tagged by `{format, status}`
- `stream.bytes` — sum of bytes served
- `stream.latency` — time-to-first-byte in ms
- `stream.concurrent` — gauge of active streams (increment on start, decrement on close)

### Task 5: Metrics Flush Scheduler

**Files:**
- Modify: `app/crate/worker.py` (add periodic flush to service loop)

Every 5 minutes: flush Redis minute-buckets older than 10min into PostgreSQL hourly rollups.
Every hour: aggregate hourly into daily rollups.
Cleanup: delete Redis keys older than 48h (TTL handles this, but belt+suspenders).

### Task 6: Metrics API Endpoints

**Files:**
- Create: `app/crate/api/metrics.py` (router)
- Create: `app/crate/api/schemas/metrics.py`
- Modify: `app/crate/api/__init__.py` (register router)

```
GET /api/admin/metrics/timeseries?name=api.latency&period=hour&start=...&end=...&tags=...
GET /api/admin/metrics/summary (current snapshot: active streams, queue depth, error rate, p95 latency)
GET /api/admin/metrics/streams (active stream details)
```

---

## Phase B: Alerting via Telegram

### Task 7: Alert Threshold Engine

**Files:**
- Create: `app/crate/alerting.py`
- Modify: `app/crate/worker.py` (check thresholds in service loop)

**Default thresholds** (stored in `settings` table, editable via API):
```python
ALERT_THRESHOLDS = {
    "api_p95_latency_ms": 3000,       # API p95 > 3s
    "api_error_rate_pct": 5,           # 5xx rate > 5%
    "worker_queue_depth": 50,          # pending tasks > 50
    "disk_usage_pct": 90,              # disk > 90%
    "stream_error_rate_pct": 10,       # stream errors > 10%
    "task_failure_rate_pct": 20,       # failed tasks > 20% in last hour
}
```

**Cooldown:** 15 min per metric. Store last alert time in Redis.

**Degradation score:** 0–100 composite:
- 100 = healthy (all metrics green)
- <80 = degraded (Telegram warning)
- <50 = critical (Telegram alert every 5 min)

Formula: weighted average of normalized thresholds (latency 25%, error rate 25%, queue 20%, disk 15%, stream 15%)

### Task 8: Telegram Alert Commands

**Files:**
- Modify: `app/crate/telegram.py` (add `/health` and `/task` commands)

```
/health          — Current degradation score + summary of each metric
/task <id>       — Task status, progress, duration, last 5 log entries
/tasks           — Running + recent failed tasks summary
/alerts on|off   — Toggle alert notifications
```

---

## Phase C: Task Progress Standardization

### Task 9: Standardized Progress Schema

**Files:**
- Create: `app/crate/task_progress.py` (helper)
- Modify: `app/crate/db/tasks.py` (validate on update)

```python
@dataclass
class TaskProgress:
    phase: str                    # "enriching", "analyzing", "indexing"
    phase_index: int = 0          # current phase (0-based)
    phase_count: int = 1          # total phases
    item: str = ""                # current item being processed
    done: int = 0                 # completed in this phase
    total: int = 0                # total in this phase
    rate: float = 0.0             # items/sec (rolling average)
    eta_sec: int = 0              # estimated time remaining
    errors: int = 0               # errors encountered so far
    warnings: int = 0             # warnings encountered

    def to_json(self) -> str: ...
    def percent(self) -> float: ...
    
    @staticmethod
    def from_json(raw: str | dict | None) -> "TaskProgress": ...
```

**Task event types** (standardized catalog):
```python
EVENT_TYPES = {
    "started":   "Task execution began",
    "progress":  "Progress update (phase, done, total)",
    "item":      "Processing a specific item",
    "warning":   "Non-fatal issue encountered",
    "error":     "Error on specific item (task continues)",
    "completed": "Task finished successfully",
    "failed":    "Task terminated with error",
    "cancelled": "Task was cancelled",
    "retry":     "Task is being retried",
    "stalled":   "No progress for >60s",
}
```

### Task 10: Migrate Worker Handlers to Structured Progress

**Files:**
- Modify: All files in `app/crate/worker_handlers/` (13 files)

Each handler currently does:
```python
update_task(task_id, progress="Processing 45/100")
```

Migrate to:
```python
from crate.task_progress import TaskProgress, emit_progress

p = TaskProgress(phase="enriching", phase_count=3, total=100)
for item in items:
    p.done += 1
    p.item = item.name
    emit_progress(task_id, p)  # calls update_task + emit_task_event
```

`emit_progress` batches updates (max 1 DB write per second, but SSE emission is immediate via in-memory buffer).

### Task 11: Per-Worker Log Table + API

**Files:**
- Modify: `app/crate/db/core.py` (add migration)
- Create: `app/crate/db/worker_logs.py`
- Modify: `app/crate/api/tasks.py` (add endpoints)

```sql
CREATE TABLE worker_logs (
    id BIGSERIAL PRIMARY KEY,
    worker_id TEXT NOT NULL,
    task_id TEXT,                          -- nullable (worker-level logs)
    level TEXT NOT NULL DEFAULT 'info',    -- debug | info | warn | error
    category TEXT NOT NULL DEFAULT 'general', -- enrichment | analysis | tidal | sync | system
    message TEXT NOT NULL,
    metadata_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_worker_logs_worker ON worker_logs(worker_id, created_at DESC);
CREATE INDEX idx_worker_logs_task ON worker_logs(task_id, id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_worker_logs_level ON worker_logs(level, created_at DESC);
```

**API:**
```
GET /api/admin/logs?worker_id=...&task_id=...&level=...&category=...&since=...&limit=100
GET /api/admin/logs/workers   — list known worker IDs with last_seen
```

**Log helper** (replaces scattered `log.info()` calls):
```python
from crate.db.worker_logs import wlog

wlog.info("Fetched Last.fm data", task_id=task_id, category="enrichment",
          meta={"artist": "Birds In Row", "source": "lastfm"})
wlog.warn("Spotify returned 403", task_id=task_id, category="enrichment")
wlog.error("Failed to analyze track", task_id=task_id, category="analysis",
           meta={"path": "/music/track.flac", "error": str(e)})
```

Auto-cleanup: `DELETE FROM worker_logs WHERE created_at < now() - interval '7 days'` (in service loop).

---

## Phase D: Admin Health Dashboard (Frontend)

### Task 12: Health Dashboard Page

**Files:**
- Create: `app/ui/src/pages/Health.tsx`
- Modify: `app/ui/src/App.tsx` (add route)

**Layout** (4 sections):

**1. Status Bar (top)**
- Degradation score gauge (0–100, green/yellow/red)
- Active streams count
- Queue depth
- Error rate (last 5min)
- Uptime

**2. Charts (Nivo, responsive grid)**
- **API Latency** — Line chart, p50/p95/p99, last 24h (hour buckets)
- **Request Volume** — Area chart, requests/min with error overlay
- **Streaming** — Line chart, concurrent streams + bytes/min
- **Task Throughput** — Bar chart, completed tasks/hour by type
- **Queue Depth** — Area chart, pending tasks over time
- Period selector: 24h | 7d | 30d

**3. Active Tasks**
- Table of running tasks with: type, phase, progress bar, duration, rate, ETA
- Click to expand → full log tail

**4. Recent Alerts**
- Timeline of threshold breaches with timestamp, metric, value, threshold

### Task 13: Task Detail View Enhancement

**Files:**
- Modify: `app/ui/src/pages/Tasks.tsx`

Current: shows raw progress string + basic info.

New task detail:
- **Stepper** showing phases (colored: done=green, current=cyan, pending=grey)
- **Progress bar** with percentage + ETA
- **Current item** prominently displayed
- **Rate** (items/sec) + **elapsed** + **errors/warnings** counters
- **Log tail**: last 50 events, color-coded by level, auto-scrolling, filterable
- **Sub-tasks** tree (if parent_task_id used)

### Task 14: Worker Logs View

**Files:**
- Create: `app/ui/src/pages/WorkerLogs.tsx`
- Modify: `app/ui/src/App.tsx` (add route)

- Sidebar: list of known workers (with last_seen indicator)
- Main panel: filterable log stream (level, category, time range)
- Real-time mode (SSE) or poll mode (every 2s)
- Click on task_id → navigate to task detail
- Search across log messages

---

## Phase E: SSE Enhancements

### Task 15: Unified Event Stream

**Files:**
- Modify: `app/crate/api/events.py`

Enhance `/api/events/task/{task_id}` to include:
- Structured progress events (phase, done, total, item, rate, eta)
- Worker log entries for that task (streamed in real-time)
- Completed/failed terminal events with full result

New endpoint:
```
GET /api/admin/events/worker/{worker_id}  — live log stream for a worker
```

---

## Phase F: Telegram Bot Revamp

### Current State Analysis

The bot (`app/crate/telegram.py`) works but has significant gaps:
- **Commands**: `/status`, `/server`, `/tasks`, `/cancel`, `/playing`, `/recent`, `/download`, `/search` — functional but basic
- **Formatting**: Raw text, minimal structure, no visual hierarchy
- **Alerts**: Only checks RAM, swap, disk, API reachability — no metrics integration
- **Task visibility**: `/tasks` shows type + truncated progress string, no detail per task
- **No interactive elements**: No inline keyboards, no callback queries

### Task 16: Rich Message Formatting

**Files:**
- Modify: `app/crate/telegram.py`

Replace plain text notifications with structured messages:

**Task completion notification** (currently a single line → becomes):
```
✅ enrich_artists completed (2m 34s)

📊 Results:
  • 12 artists enriched
  • 3 photos updated  
  • 2 Spotify 403 (skipped)

🔗 /task_a1b2c3d4
```

**Task failure notification:**
```
❌ tidal_download FAILED (45s)

💥 Error: Authentication expired
📋 Params: url=tidal.com/album/12345

🔗 /task_a1b2c3d4
```

**New release notification:**
```
🆕 New release detected

🎵 Birds In Row — Gris Klein (2026)
   FLAC · 11 tracks · 42:15

📥 /download https://tidal.com/album/...
```

### Task 17: New & Enhanced Commands

**Files:**
- Modify: `app/crate/telegram.py`
- Modify: `app/crate/db/queries/telegram.py` (new queries)

**New commands:**

```
/health              — Degradation score + metric summary (from Phase A metrics)
                       🟢 Health: 94/100
                       
                       📊 API: p95 340ms, 0.2% errors
                       🎵 Streams: 2 active, 0 stalls
                       ⚙️ Queue: 3 pending, 1 running
                       💾 Disk: 340 GB free (72%)
                       🧠 RAM: 4.2/8 GB (52%)

/task <id>           — Detailed task view with structured progress
                       ⚙️ enrich_artists [running]
                       
                       Phase: 2/3 — Fetching photos
                       Progress: ████████░░ 78% (94/120)
                       Rate: 1.3 items/sec · ETA: 20s
                       Duration: 1m 12s
                       
                       📋 Last events:
                       • ✅ Fetched Last.fm for Birds In Row
                       • ⚠️ Spotify 403 for High Vis
                       • ✅ Fetched Last.fm for Rival Schools

/logs [level]        — Recent worker log entries (last 10, filterable by level)
                       📋 Recent logs:
                       • 🔴 [enrichment] Spotify API rate limited
                       • 🟡 [analysis] Essentia timeout on track.flac
                       • 🟢 [sync] Scanned 45 new files

/workers             — Worker status overview
                       🔧 Workers:
                       • worker-1: 🟢 active (3 tasks, last seen 5s ago)
                       • worker-2: 🟢 active (1 task, last seen 12s ago)

/alerts on|off       — Toggle proactive alert notifications

/stats [period]      — Library growth stats (day/week/month)
                       📈 Last 7 days:
                       • +12 albums, +156 tracks
                       • 4.2 GB added
                       • 89 tracks analyzed
                       • 23 artists enriched

/enrich [artist]     — Queue artist enrichment task
/analyze [count]     — Queue batch audio analysis
/scan                — Queue library scan
```

**Enhanced existing commands:**

```
/tasks               — Grouped by status, with progress bars
                       ⚙️ Running (2):
                       • a1b2 enrich_artists ████████░░ 78%
                       • c3d4 audio_analysis ██░░░░░░░░ 15%
                       
                       ⏳ Pending (1):
                       • e5f6 tidal_download

/playing             — With album art link + quality badge
                       🎧 Now Playing:
                       
                       👤 Diego:
                       🎵 Birds In Row — We Already Lost the World
                       💿 You (2018) · FLAC 24/96 [Hi-Res]
                       
                       👤 Guest:
                       🎵 High Vis — Blending
                       💿 Blending (2022) · FLAC 16/44.1

/recent              — With format badges + size
                       📦 Recent additions (last 7 days):
                       • Birds In Row — Gris Klein (2026) [FLAC] 412 MB
                       • High Vis — Blending (2022) [FLAC] 287 MB
```

### Task 18: Inline Keyboards & Callbacks

**Files:**
- Modify: `app/crate/telegram.py` (add callback_query handler)

Add inline keyboard buttons for common actions:

**On task completion:**
```
[View Details] [View Logs] [Run Again]
```

**On `/tasks` list:**
```
[Cancel a1b2] [Cancel c3d4] [Refresh]
```

**On `/health`:**
```
[Full Report] [Silence 1h] [Open Dashboard]
```

Implementation:
- Add `callback_query` handling in `_handle_update()`
- Parse callback data as `action:param` (e.g., `cancel:a1b2c3d4`, `task:a1b2c3d4`)
- Reply with `answerCallbackQuery` + edit original message or send new one

### Task 19: Metrics-Driven Alerts

**Files:**
- Modify: `app/crate/telegram.py` (`_check_alerts` function)
- Depends on: Phase A metrics + Phase B alerting engine

Replace hardcoded checks with metrics-driven alerts:

```python
def _check_alerts():
    from crate.alerting import evaluate_health, HealthStatus
    
    status: HealthStatus = evaluate_health()
    
    if status.score < 80 and status.score >= 50:
        send_alert("degraded", f"⚠️ Service degraded ({status.score}/100)\n\n{status.summary_text()}")
    elif status.score < 50:
        send_alert("critical", f"🔴 Service CRITICAL ({status.score}/100)\n\n{status.summary_text()}")
    
    # Per-metric alerts with context
    for breach in status.breaches:
        send_alert(
            f"metric:{breach.name}",
            f"⚠️ {breach.name}: {breach.value:.1f} (threshold: {breach.threshold})\n"
            f"Trend: {breach.trend}"  # rising/stable/falling
        )
```

Alert cooldowns (per metric type):
- `degraded` → 15 min
- `critical` → 5 min
- `metric:*` → 30 min
- Task failure → immediate (no cooldown, but grouped if multiple fail within 1 min)

### Task 20: Notification Preferences

**Files:**
- Modify: `app/crate/telegram.py`
- Modify: `app/crate/db/cache.py` (settings helpers)

Granular notification control via settings:
```python
NOTIFICATION_SETTINGS = {
    "telegram_notify_task_completed": "true",    # task completion messages
    "telegram_notify_task_failed": "true",       # task failure messages  
    "telegram_notify_new_release": "true",       # new release detection
    "telegram_notify_health_alerts": "true",     # health/degradation alerts
    "telegram_notify_downloads": "true",         # download start/complete
    "telegram_quiet_hours": "",                  # e.g. "23:00-08:00" (UTC)
}
```

Quiet hours: suppress non-critical notifications during configured time window. Critical alerts (score <50) always go through.

Admin UI settings page should expose these toggles (modify `app/ui/src/pages/Settings.tsx` or create a Telegram settings section).

---

## Implementation Order

```
Phase A (Tasks 1-6)   — Metrics infra, capture, API         [~2 sessions]
Phase C (Tasks 9-11)  — Progress schema, worker migration    [~2 sessions]
Phase F (Tasks 16-20) — Telegram bot revamp                  [~2 sessions]
Phase B (Tasks 7-8)   — Alerting engine (connects A+F)       [~1 session]
Phase D (Tasks 12-14) — Admin dashboard + UI                  [~2 sessions]
Phase E (Task 15)     — SSE enhancements                      [~1 session]
```

Phases A and C can run in parallel (independent concerns).
Phase F (Telegram) can start in parallel with A/C — Tasks 16-18 (formatting + commands) are independent. Tasks 19-20 depend on Phase A/B.
Phase B depends on A (needs metrics to evaluate thresholds).
Phase D depends on A+C (needs both metrics API and structured progress).
Phase E is polish, can be last.

---

## Verification

1. **Metrics**: `curl /api/admin/metrics/summary` returns latency, error rate, queue depth, stream count
2. **Time-series**: `curl /api/admin/metrics/timeseries?name=api.latency&period=hour&start=...` returns data points
3. **Task progress**: Start an enrichment task → watch structured phases in task detail UI
4. **Worker logs**: `curl /api/admin/logs?level=error&limit=10` returns structured log entries
5. **Alerts**: Set `api_p95_latency_ms` threshold to 1ms → verify Telegram alert fires
6. **Dashboard**: Open `/admin/health` → charts render with real data, degradation score updates
7. **Telegram /health**: Returns degradation score + metric summary
8. **Telegram /task**: Shows structured progress with phases, rate, ETA, log tail
9. **Telegram /logs**: Returns color-coded recent worker log entries
10. **Telegram callbacks**: Inline keyboard buttons work (cancel task, view details)
11. **Telegram notifications**: Task completion/failure messages use rich formatting
12. **Quiet hours**: Set quiet window → verify non-critical notifications suppressed
13. `pytest app/tests/` — all tests pass
