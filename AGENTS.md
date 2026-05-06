# Crate

## Project Overview

Self-hosted music platform with enrichment, analysis, streaming, acquisition, and a snapshot-backed read plane. Manages ~900 artists, 4400 albums, 48K tracks, 1.2TB.

## Architecture

```
crate-api       (FastAPI, Python 3.13)        → port 8585, /music:ro
crate-worker    (Dramatiq + daemons + projector) → /music:rw, background processing
@crate/ui       (React 19 + TW4 + shadcn)   → shared design system (npm workspace)
crate-ui        (React 19 + Vite + TW4)      → admin web app
crate-listen    (React 19 + Vite + TW4)      → consumer listening app (PWA + Capacitor)
crate-site      (React 19 + Vite)            → marketing landing page (cratemusic.app)
crate-reference (Scalar)                     → API docs (reference.cratemusic.app)
crate-postgres  (PostgreSQL 15)              → data persistence
crate-redis     (Redis 7)                    → cache + invalidation replay + metrics + Redis Streams domain events + Dramatiq broker
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
app/shared/ui/              @crate/ui design system (npm workspace package)
app/shared/ui/tokens/       Design tokens (colors, surfaces, radius, z-index, animations)
app/shared/ui/primitives/   UI primitives (AppModal, AppPopover, ActionIconButton, etc.)
app/shared/ui/shadcn/       Curated shadcn/Radix components (19 components)
app/shared/ui/domain/       Shared domain components (EqBands, ShowCard, OAuthButtons, etc.)
app/shared/ui/lib/          Shared hooks and utilities (cn, useIsDesktop, etc.)
app/shared/web/             Shared frontend code (API client, hooks, utils)
app/shared/fonts/           Shared font files (Poppins)
app/ui/src/                 Admin frontend (27 pages)
app/listen/src/             Consumer listening frontend (25 pages)
app/site/                   Marketing landing page
app/reference/              Scalar API docs viewer
app/tests/                  Python backend tests (35 files)
tools/crate-cli/     Rust CLI for audio similarity (bliss-rs)
docs/plans/                 Design documents
test-music/                 Local dev music (3 artists, not committed)
```

## Tech Stack

### Backend (Python 3.13)
- FastAPI + Uvicorn (API server)
- SQLAlchemy 2.0 (ORM for CRUD domains) + psycopg2 (driver)
- Alembic (authoritative schema bootstrap + migrations)
- Pydantic v2 (API schemas + data models)
- Dramatiq + Redis broker (async task processing, 3 queues: fast/heavy/default)
- Redis 7 (cache, broker, invalidation replay, domain-event stream, metrics)
- mutagen (audio tag reading/writing)
- essentia (audio analysis — x86_64 only, librosa fallback on ARM)
- musicbrainzngs (MusicBrainz API)
- tiddl (Tidal downloads)
- Pillow (image processing)
- LLM: Ollama (default), Gemini, litellm (multi-provider)

### Frontend (TypeScript/React)
- React 19 + React Router 7
- **@crate/ui** — shared design system (npm workspace at `app/shared/ui/`)
- Tailwind CSS 4 with unified design tokens (`data-surface="solid|glass"` variants)
- shadcn/ui components (curated in `@crate/ui/shadcn/`)
- Nivo (@nivo/*) for charts — NOT recharts (legacy, being phased out)
- sonner for toasts
- lucide-react for icons
- Capacitor (listen app → iOS/Android)
- npm workspaces (root `package.json` orchestrates `app/shared/ui`, `app/ui`, `app/listen`)
- Shared utilities in `app/shared/web/` (API client, formatters, route builders)

#### @crate/ui import conventions
- Primitives: `import { Button } from "@crate/ui/shadcn/button"`
- Custom UI: `import { AppModal } from "@crate/ui/primitives/AppModal"`
- Hooks: `import { useIsDesktop } from "@crate/ui/lib/use-breakpoint"`
- Domain: `import { ShowCard } from "@crate/ui/domain/shows/ShowCard"`
- Tokens (CSS): `@import "@crate/ui/tokens/index.css"`
- Only put components in @crate/ui when used by BOTH apps

### Infrastructure
- Docker Compose (12 production services + 3 project overlay)
- Traefik reverse proxy (Let's Encrypt TLS via Cloudflare DNS)
- Redis 7-alpine (512MB, volatile-lru)
- GitHub Actions CI/CD (build images, test backend, build Android APK)
- GHCR for container images

## Database Patterns

Hybrid DB strategy — two runtime layers coexist:

- **SQLAlchemy ORM** (`db/orm/`): Mapped models for simple CRUD (users, sessions, settings, tidal, genres, health, releases)
- **SQLAlchemy Core / `text()`** (`db/queries/`, `db/jobs/`): Complex queries (analytics, browse, bliss, task claiming)
- **Alembic** (`db/migrations/`): authoritative schema bootstrap and migrations
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

Key tables: `library_artists`, `library_albums`, `library_tracks`, `tasks`, `task_events`, `users`, `sessions`, `user_play_events`, `ui_snapshots`, `ops_runtime_state`, `import_queue_items`, `track_processing_state`, `track_analysis_features`, `track_bliss_embeddings`, `track_popularity_features`, `metric_rollups`, `worker_logs`

## Worker & Background Processing

### Dramatiq Actors
API creates tasks, Dramatiq actors process them via Redis broker (DB 1). 3 queues: `fast` (I/O), `heavy` (CPU), `default` (mixed). Workers self-recycle at 1.5GB RSS. Task handlers in `worker_handlers/` (8 modules, ~111 handlers).

Tasks that write to filesystem (tags, delete, move) MUST run in the worker (has /music:rw).

### Daemons (outside task system)
- **Analysis daemon**: Infinite loop, claims tracks via `FOR UPDATE SKIP LOCKED`, pauses under load
- **Bliss daemon**: Same pattern for bliss vector computation
- **Projector daemon**: Consumes Redis Stream domain events and warms snapshots
- **Filesystem watcher**: Watchdog-based, debounced (30s), triggers library sync
- **Scheduler**: 6 recurring tasks (enrich 24h, pipeline 6h, analytics 4h, releases 12h, cleanup 48h, shows 24h)

## SSE & Real-time

Crate uses both classic SSE feeds and snapshot-driven streams:

| Endpoint | Purpose |
|----------|---------|
| `/api/events` | Global status stream |
| `/api/events/task/{id}` | Per-task progress |
| `/api/cache/events` | Cache invalidation (Last-Event-ID replay) |
| `/api/admin/ops-stream` | Snapshot-driven admin dashboard updates |
| `/api/admin/tasks-stream` | Admin task surface updates |
| `/api/admin/health-stream` | Admin health surface updates |
| `/api/admin/logs-stream` | Admin worker-log surface updates |
| `/api/admin/stack-stream` | Admin stack snapshot updates |
| `/api/me/home/discovery-stream` | Per-user Listen home snapshot updates |

## Enrichment Pipeline

When new content arrives (watcher or acquisition import):
1. Artist enrichment (Last.fm, Spotify*, MusicBrainz, Setlist.fm, Fanart.tv)
2. Album genre indexing (from audio tags)
3. Album MBID lookup (MusicBrainz)
4. Audio analysis (Essentia: BPM, key, energy, danceability, mood)
5. Bliss vectors (Rust CLI: 20-float song DNA for similarity)
6. Popularity (Last.fm listeners/playcount)
7. Snapshot/read-model refresh follow-ups

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
npm install                 # Install all workspace dependencies (run from root)
make dev                    # Docker backend + all frontend dev servers

# Individual dev servers:
npm run --workspace=app/ui dev          # Admin UI (port 5173)
npm run --workspace=app/listen dev      # Listen app (port 5174)

# Build @crate/ui:
npm run --workspace=app/shared/ui build     # → dist/*.js + dist/*.d.ts
npm run --workspace=app/shared/ui typecheck # Standalone type-check
```

Test library: 3 artists (Birds In Row, High Vis, Rival Schools), 122 tracks in `test-music/`.

Login: admin@cratemusic.app / admin (dev seed user, also used in production).

## Code Conventions

### Python
- Type hints on function signatures (Python 3.13 union syntax `str | None`)
- `log = logging.getLogger(__name__)` per module
- Imports: stdlib → third-party → local, separated by blank lines
- DB functions in `db/` modules, not scattered across routers
- `crate.db.__init__.py` is a frozen compatibility facade; new code should import concrete `queries/`, `repositories/`, `jobs/`, or `surface` modules directly instead of widening the facade
- Worker handlers in `worker_handlers/`, registered via Dramatiq actors
- ORM models in `db/orm/` (SQLAlchemy 2.0 Mapped style), complex queries in `db/queries/` and `db/jobs/`
- Pydantic v2 schemas in `api/schemas/`, data models in `db/models/`

### TypeScript/React
- Named exports for page components (`export function PageName()`)
- `useApi<T>(url)` hook for data fetching (from `shared/web/use-api.ts`)
- `api<T>(url, method?, body?)` for imperative calls (from `shared/web/api.ts`)
- `toast` from sonner for user feedback
- `encPath()` for URL-encoding path segments (from `shared/web/utils.ts`)
- Nivo for all new charts (NOT recharts)
- No emojis in UI text
- Keep `app/ui` and `app/listen` as separate apps

#### Auth differences
- **ui**: Cookie-based persisted sessions, admin-oriented
- **listen**: OAuth + persisted-session bootstrap on web, bearer-token storage for native multi-server flows, registration

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
| `app/crate/projector.py` | Domain events → snapshot warming |
| `app/crate/analysis_daemon.py` | Audio analysis + bliss daemon loops |
| `app/crate/enrichment.py` | Unified artist enrichment (all sources) |
| `app/crate/audio_analysis.py` | Essentia/librosa dual backend |
| `app/crate/bliss.py` | Python integration with crate-cli Rust CLI |
| `app/crate/tidal.py` | Tidal auth, search, download via tiddl |
| `app/crate/library_sync.py` | Filesystem → DB sync |
| `app/crate/metrics.py` | Redis metrics buckets → PostgreSQL rollups |
| `app/crate/llm/` | LLM provider abstraction (Ollama/Gemini/litellm) |
| `app/crate/api/__init__.py` | App factory + router registration order (important!) |
| `app/shared/ui/` | @crate/ui design system (tokens, primitives, shadcn, domain) |
| `app/shared/web/api.ts` | Shared API client factory |
| `app/shared/web/use-api.ts` | Shared `useApi` hook factory |
| `app/shared/web/utils.ts` | Shared utilities (formatDuration, encPath, etc.) |
| `package.json` | Root workspace config |
| `app/ui/src/components/layout/Shell.tsx` | Admin layout (sidebar, main) |
| `app/listen/src/contexts/PlayerContext.tsx` | Public player provider/orchestrator; heavy internals now split across focused hooks |
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
