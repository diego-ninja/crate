# Crate

## Project Overview

Self-hosted music library manager with enrichment, analysis, streaming, and Tidal integration. Manages ~900 artists, 4400 albums, 48K tracks, 1.2TB.

## Architecture

```
crate-api       (FastAPI, Python 3.12)        → port 8585, /music:ro
crate-worker    (Dramatiq + daemons)          → /music:rw, background processing
crate-ui        (React 19 + Vite + TW4)      → admin web app
crate-listen    (React 19 + Vite + TW4)      → consumer listening app (PWA + Capacitor)
crate-site      (React 19 + Vite)            → marketing landing page (cratemusic.app)
crate-reference (Scalar)                     → API docs (reference.cratemusic.app)
crate-postgres  (PostgreSQL 15)              → data persistence
crate-redis     (Redis 7)                    → cache (DB 0) + Dramatiq broker (DB 1) + SSE pub/sub + metrics
```

API mounts /music as **read-only**. All filesystem writes go through **worker tasks**. Never write to filesystem from API endpoints.

## Key Directories

```
app/crate/                  Python backend (API + Worker)
app/crate/api/              FastAPI routers (37 files, ~405 endpoints)
app/crate/api/schemas/      Pydantic v2 request/response schemas (22 files)
app/crate/db/               Database layer (SQLAlchemy 2.0 + Alembic)
app/crate/db/orm/           SQLAlchemy ORM models (CRUD domains)
app/crate/db/queries/       Read-only query modules (complex SQL)
app/crate/db/jobs/          DB functions for worker handlers
app/crate/db/models/        Pydantic output models for DB layer
app/crate/db/repositories/  Repository pattern (nascent)
app/crate/db/migrations/    Alembic migrations
app/crate/worker_handlers/  8 handler modules (~111 handlers)
app/crate/scanners/         Scanner plugins (duplicates, naming, etc.)
app/crate/fixers/           Automated repair plugins
app/crate/llm/              LLM integration (Ollama/Gemini/litellm)
app/ui/src/                 Admin frontend (27 pages)
app/listen/src/             Consumer listening frontend (25 pages)
app/shared/web/             Shared frontend code (API client, hooks, utils)
app/shared/fonts/           Shared font files (Poppins)
app/site/                   Marketing landing page
app/reference/              Scalar API docs viewer
app/tests/                  Python backend tests (35 files)
tools/grooveyard-bliss/     Rust CLI for audio similarity (bliss-rs)
docs/plans/                 Design documents
test-music/                 Local dev music (3 artists, not committed)
```

## Tech Stack

### Backend (Python 3.12)
- FastAPI + Uvicorn (API server)
- SQLAlchemy 2.0 (ORM for CRUD domains) + psycopg2 (driver)
- Alembic (schema migrations)
- Pydantic v2 (API schemas + data models)
- Dramatiq + Redis broker (async task processing, 3 queues: fast/heavy/default)
- Redis 7 (cache, broker, SSE pub/sub, metrics)
- mutagen (audio tag reading/writing)
- essentia (audio analysis — x86_64 only, librosa fallback on ARM)
- musicbrainzngs (MusicBrainz API)
- tiddl (Tidal downloads)
- Pillow (image processing)
- LLM: Ollama (default), Gemini, litellm (multi-provider)

### Frontend (TypeScript/React)
- React 19 + React Router 7
- Tailwind CSS 4 + shadcn/ui components
- Nivo (@nivo/*) for charts — NOT recharts (legacy, being phased out)
- sonner for toasts
- lucide-react for icons
- Capacitor (listen app → iOS/Android)
- `app/ui` stays a separate admin web app
- `app/listen` stays a separate user-facing app (Capacitor-compatible)
- Shared frontend code lives in `app/shared/web/`

### Infrastructure
- Docker Compose (12 production services + 3 project overlay)
- Traefik reverse proxy (Let's Encrypt TLS via Cloudflare DNS)
- Redis 7-alpine (512MB, volatile-lru)
- GitHub Actions CI/CD (build images, test backend, build Android APK)
- GHCR for container images

## Database Patterns

Hybrid DB strategy — two layers coexist:

- **SQLAlchemy ORM** (`db/orm/`): Mapped models for simple CRUD (users, sessions, settings, tidal, genres, health, releases)
- **SQLAlchemy Core / `text()`** (`db/queries/`, `db/jobs/`): Complex queries (analytics, browse, bliss, task claiming)
- **Alembic** (`db/migrations/`): Schema migrations (7 versions)
- **Transaction scopes** (`db/tx.py`): `transaction_scope()`, `read_scope()`, `optional_scope()`

```python
from crate.db.tx import transaction_scope, read_scope
from sqlalchemy import text

# Write
with transaction_scope() as session:
    session.execute(text("INSERT INTO ..."), {"param": "value"})

# Read-only (no commit, less contention)
with read_scope() as session:
    rows = session.execute(text("SELECT ...")).mappings().all()
```

Key tables: `library_artists`, `library_albums`, `library_tracks`, `genres`, `artist_genres`, `album_genres`, `playlists`, `playlist_tracks`, `tidal_downloads`, `tidal_monitored_artists`, `cache`, `tasks`, `audit_log`, `users`, `sessions`, `settings`, `metric_rollups`, `worker_logs`

## Worker & Background Processing

### Dramatiq Actors
API creates tasks, Dramatiq actors process them via Redis broker (DB 1). 3 queues: `fast` (I/O), `heavy` (CPU), `default` (mixed). Workers self-recycle at 1.5GB RSS. Task handlers in `worker_handlers/` (8 modules, ~111 handlers).

Tasks that write to filesystem (tags, delete, move) MUST run in the worker (has /music:rw).

### Daemons (outside task system)
- **Analysis daemon**: Infinite loop, claims tracks via `FOR UPDATE SKIP LOCKED`, pauses under load
- **Bliss daemon**: Same pattern for bliss vector computation
- **Filesystem watcher**: Watchdog-based, debounced (30s), triggers library sync
- **Scheduler**: 6 recurring tasks (enrich 24h, pipeline 6h, analytics 4h, releases 12h, cleanup 48h, shows 24h)

## SSE & Real-time

3 SSE endpoints via Redis pub/sub:

| Endpoint | Purpose |
|----------|---------|
| `/api/events` | Global status stream |
| `/api/events/task/{id}` | Per-task progress |
| `/api/cache/events` | Cache invalidation (Last-Event-ID replay) |

## Enrichment Pipeline

When new content arrives (watcher or Tidal download):
1. Artist enrichment (Last.fm, Spotify*, MusicBrainz, Setlist.fm, Fanart.tv)
2. Album genre indexing (from audio tags)
3. Album MBID lookup (MusicBrainz)
4. Audio analysis (Essentia: BPM, key, energy, danceability, mood)
5. Bliss vectors (Rust CLI: 20-float song DNA for similarity)
6. Popularity (Last.fm listeners/playcount)

## LLM Integration

`app/crate/llm/` — Ollama (default, local), Gemini, litellm (any provider). Current prompts: EQ preset generation, genre taxonomy inference.

## Metrics System

Redis hash buckets (minute granularity, 48h TTL) → hourly flush to `metric_rollups` PostgreSQL table. `MetricsMiddleware` records `api.latency`, `api.requests`, `api.errors` per request.

## Deploy

```bash
make deploy  # syncs app/ only, builds api+worker+ui+listen, restarts
```

**CRITICAL**: `make deploy` syncs only `app/` subdirectory. NEVER run `rsync --delete` on the full project root — the server has `media/` and `data/` that don't exist locally.

## Dev Environment

```bash
make dev                     # Docker: postgres + redis + api + worker + ollama
cd app/ui && npm run dev     # Admin UI (Vite, port 5173)
cd app/listen && npm run dev # Listen app (Vite, port 5174)

# Or against production:
cd app/ui && API_URL=https://admin.lespedants.org npm run dev
cd app/listen && API_URL=https://listen.lespedants.org npm run dev
```

Test library: 3 artists (Birds In Row, High Vis, Rival Schools), 122 tracks in `test-music/`.

Login: admin@cratemusic.app / admin (dev seed user, also used in production).

## Code Conventions

### Python
- Type hints on function signatures (Python 3.12 union syntax `str | None`)
- `log = logging.getLogger(__name__)` per module
- Imports: stdlib → third-party → local, separated by blank lines
- DB functions in `db/` modules, not scattered across routers
- Worker handlers in `worker_handlers/`, registered via Dramatiq actors
- ORM models in `db/orm/` (SQLAlchemy 2.0 Mapped style), complex queries in `db/queries/` and `db/jobs/`
- Pydantic v2 schemas in `api/schemas/`, data models in `db/models/`

### TypeScript/React
- Named exports for page components (`export function PageName()`)
- `useApi<T>(url)` hook for data fetching (from `shared/web/use-api.ts`)
- `api<T>(url, method?, body?)` for imperative calls (from `shared/web/api.ts`)
- `toast` from sonner for user feedback
- `encPath()` for URL-encoding path segments (from `shared/web/utils.ts`)
- shadcn/ui components in `components/ui/`
- Nivo for all new charts (NOT recharts)
- No emojis in UI text
- Keep `app/ui` and `app/listen` as separate apps — shared code goes in `app/shared/web/`

#### Auth differences
- **ui**: Cookie-based sessions, admin-only, no registration
- **listen**: Bearer token (localStorage on web, per-server on Capacitor), OAuth, registration, multi-server

### API Routing
- Routers registered in `api/__init__.py`
- Routes with `{name:path}` catch-alls (like browse router) must be registered AFTER specific routes
- Auth: `_require_auth(request)` for logged-in users, `_require_admin(request)` for admin-only
- 3 middleware: `AuthMiddleware`, `CacheInvalidationMiddleware`, `MetricsMiddleware` + CORS

## Important Files

| File | Purpose |
|------|---------|
| `app/crate/db/` | Database layer: `core.py` (pool + init), `tx.py` (session scopes), `orm/` (models), `queries/` (complex SQL) |
| `app/crate/worker_handlers/` | 8 task handler modules (~111 handlers) |
| `app/crate/actors.py` | Dramatiq actor wrappers + queue config |
| `app/crate/orchestrator.py` | Worker process manager + scheduler + watcher |
| `app/crate/analysis_daemon.py` | Audio analysis + bliss daemon loops |
| `app/crate/enrichment.py` | Unified artist enrichment (all sources) |
| `app/crate/audio_analysis.py` | Essentia/librosa dual backend |
| `app/crate/bliss.py` | Python integration with grooveyard-bliss Rust CLI |
| `app/crate/tidal.py` | Tidal auth, search, download via tiddl |
| `app/crate/library_sync.py` | Filesystem → DB sync |
| `app/crate/metrics.py` | Redis metrics buckets → PostgreSQL rollups |
| `app/crate/llm/` | LLM provider abstraction (Ollama/Gemini/litellm) |
| `app/crate/api/__init__.py` | App factory + router registration order (important!) |
| `app/shared/web/api.ts` | Shared API client factory |
| `app/shared/web/use-api.ts` | Shared `useApi` hook factory |
| `app/shared/web/utils.ts` | Shared utilities (formatDuration, encPath, etc.) |
| `app/ui/src/components/layout/Shell.tsx` | Admin layout (sidebar, main) |
| `app/listen/src/contexts/PlayerContext.tsx` | Full player state (gapless, crossfade, EQ, queue, offline) |
| `app/listen/src/components/layout/Shell.tsx` | Listen layout (desktop/mobile adaptive) |
| `Makefile` | Dev, deploy, Capacitor, utilities |
| `docker-compose.yaml` | Production stack (12 services) |
| `docker-compose.dev.yaml` | Dev stack (7 services) |

## Server

- Host: root@104.152.210.73
- Path: /home/crate/crate
- Domains: admin.lespedants.org (admin UI), listen.lespedants.org (listen app), cratemusic.app (site), api.lespedants.org (API — serves all endpoints; `/rest` subpath is the Open Subsonic-compatible layer)

## Skills / Reference Guides

Detailed coding guidelines live in `.agents/skills/` (with compiled `AGENTS.md` per skill) and `.claude/skills/`. Read them when working on the relevant domain.

### Backend

| Skill | Location | When to use |
|-------|----------|-------------|
| Python Backend | `.claude/skills/python-backend.md` | FastAPI endpoints, SQLAlchemy ORM models, async patterns, testing |

### Frontend

| Skill | Location | When to use |
|-------|----------|-------------|
| React Best Practices | `.agents/skills/vercel-react-best-practices/AGENTS.md` | Performance optimization, re-renders, bundle size (70 rules) |
| Composition Patterns | `.agents/skills/vercel-composition-patterns/AGENTS.md` | Component APIs, compound components, context providers |
| React View Transitions | `.agents/skills/vercel-react-view-transitions/AGENTS.md` | Page transitions, shared element animations, enter/exit |
| Web Design Guidelines | `.claude/skills/web-design-guidelines.md` | UI audits, accessibility, UX review |
