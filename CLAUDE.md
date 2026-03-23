# Grooveyard (codebase: musicdock)

## Project Overview

Self-hosted music library manager with enrichment, analysis, streaming, and Tidal integration. Manages ~900 artists, 4400 albums, 48K tracks, 1.2TB.

## Architecture

```
musicdock-api     (FastAPI, Python 3.12)     → port 8585, /music:ro
musicdock-worker  (Python, ThreadPoolExecutor) → /music:rw, background tasks
musicdock-ui      (React 19 + Vite + Tailwind 4) → nginx, proxies /api → api:8585
musicdock-postgres (PostgreSQL 15)            → data persistence
```

API mounts /music as **read-only**. All filesystem writes go through **worker tasks**. Never write to filesystem from API endpoints.

## Key Directories

```
app/musicdock/          Python backend (API + Worker)
app/musicdock/api/      FastAPI routers (one file per domain)
app/ui/src/             React frontend
app/ui/src/pages/       Page components (lazy-loaded)
app/ui/src/components/  Shared components
tools/grooveyard-bliss/ Rust CLI for audio similarity (bliss-rs)
docs/plans/             Design documents
test-music/             Local dev music (3 artists, not committed)
```

## Tech Stack

### Backend (Python)
- FastAPI + Uvicorn (API server)
- psycopg2 (PostgreSQL, connection pool via `get_db_ctx()`)
- mutagen (audio tag reading/writing)
- essentia (audio analysis — x86_64 only, librosa fallback on ARM)
- musicbrainzngs (MusicBrainz API)
- tiddl (Tidal downloads)
- Pillow (image processing)

### Frontend (TypeScript/React)
- React 19 + React Router 7
- Tailwind CSS 4 + shadcn/ui components
- Nivo (@nivo/*) for charts — NOT recharts (legacy, being phased out)
- sonner for toasts
- lucide-react for icons

### Infrastructure
- Docker Compose (4 containers + AudioMuse via profile)
- Traefik reverse proxy (production)
- Navidrome as streaming backend (Subsonic API)

## Database Patterns

All DB access uses `get_db_ctx()` context manager (yields psycopg2 RealDictCursor):

```python
from musicdock.db import get_db_ctx
with get_db_ctx() as cur:
    cur.execute("SELECT * FROM library_artists WHERE name = %s", (name,))
    row = cur.fetchone()
```

Key tables: `library_artists`, `library_albums`, `library_tracks`, `genres`, `artist_genres`, `album_genres`, `playlists`, `playlist_tracks`, `tidal_downloads`, `tidal_monitored_artists`, `cache`, `tasks`, `audit_log`, `users`, `sessions`, `settings`

## Worker Task Pattern

API creates tasks, worker processes them:

```python
# API side
from musicdock.db import create_task
task_id = create_task("task_type", {"param": "value"})

# Worker side (worker.py)
def _handle_task_type(task_id: str, params: dict, config: dict) -> dict:
    # ... do work ...
    update_task(task_id, progress=json.dumps({"phase": "x", "done": 1, "total": 10}))
    return {"result": "value"}

TASK_HANDLERS = {
    "task_type": _handle_task_type,
    # ...
}
```

Tasks that write to filesystem (tags, delete, move) MUST run in the worker (has /music:rw). `DB_HEAVY_TASKS` set controls serialization of DB-intensive tasks.

## Enrichment Pipeline

When new content arrives (watcher or Tidal download):

```
process_new_content task:
  1. Artist enrichment (Last.fm, Spotify*, MusicBrainz, Setlist.fm, Fanart.tv)
  2. Album genre indexing (from audio tags)
  3. Album MBID lookup (MusicBrainz)
  4. Audio analysis (Essentia: BPM, key, energy, danceability, mood)
  5. Bliss vectors (Rust CLI: 20-float song DNA for similarity)
  6. Popularity (Last.fm listeners/playcount)
```

*Spotify requires Premium account — currently returns 403.

## Audio Analysis

Dual backend in `audio_analysis.py`:
- **Essentia** (production, x86_64): C++ engine, 10-30x faster, native danceability
- **librosa** (dev/ARM fallback): Python, slower but works everywhere
- Auto-detected at import time via `_BACKEND` variable

## Bliss (Song Similarity)

`tools/grooveyard-bliss/` — Rust CLI using bliss-rs:
- `--file <path>` → JSON with 20-float feature vector
- `--dir <path>` → batch analyze with internal parallelism
- `--similar-to <path> --dir <lib>` → find N most similar tracks
- Binary compiled for linux/amd64 via Docker, deployed to `/usr/local/bin/`
- Vectors stored in `library_tracks.bliss_vector` (PostgreSQL float8[])

## Deploy

```bash
make deploy  # syncs app/ only, builds api+worker+ui, restarts
```

**CRITICAL**: `make deploy` syncs only `app/` subdirectory. NEVER run `rsync --delete` on the full project root — the server has `media/` and `data/` that don't exist locally.

## Dev Environment

```bash
make dev                    # Docker: postgres + api + worker with test-music/
cd app/ui && API_URL=http://localhost:8585 npm run dev  # Vite dev server

# Or against production:
cd app/ui && API_URL=https://admin.lespedants.org npm run dev
```

Test library: 3 artists (Birds In Row, High Vis, Rival Schools), 122 tracks in `test-music/`.

Login: yosoy@diego.ninja / admin (dev), same email in production.

## Code Conventions

### Python
- Type hints on function signatures (Python 3.12 union syntax `str | None`)
- `log = logging.getLogger(__name__)` per module
- Imports: stdlib → third-party → local, separated by blank lines
- DB functions in `db.py`, not scattered across modules
- Worker handlers prefixed `_handle_` and registered in `TASK_HANDLERS` dict

### TypeScript/React
- Named exports for page components (`export function PageName()`)
- `useApi<T>(url)` hook for data fetching
- `api<T>(url, method?, body?)` for imperative calls
- `toast` from sonner for user feedback
- `encPath()` for URL-encoding path segments
- shadcn/ui components in `components/ui/`
- Nivo for all new charts (NOT recharts)
- No emojis in UI text

### API Routing
- Routers registered in `api/__init__.py`
- Routes with `{name:path}` catch-alls (like browse router) must be registered AFTER specific routes
- Auth: `_require_auth(request)` for logged-in users, `_require_admin(request)` for admin-only

## Important Files

| File | Purpose |
|------|---------|
| `app/musicdock/db.py` | All database functions + schema migrations in `init_db()` |
| `app/musicdock/worker.py` | Task handlers + worker loop (TASK_HANDLERS dict) |
| `app/musicdock/enrichment.py` | Unified artist enrichment (all sources) |
| `app/musicdock/audio_analysis.py` | Essentia/librosa dual backend |
| `app/musicdock/bliss.py` | Python integration with grooveyard-bliss Rust CLI |
| `app/musicdock/tidal.py` | Tidal auth, search, download via tiddl |
| `app/musicdock/library_sync.py` | Filesystem → DB sync |
| `app/musicdock/library_watcher.py` | Watchdog filesystem watcher |
| `app/musicdock/api/__init__.py` | Router registration order (important!) |
| `app/ui/src/contexts/PlayerContext.tsx` | Audio player state + HTMLAudioElement |
| `app/ui/src/components/player/AudioPlayer.tsx` | Full + mini player with visualizer |
| `app/ui/src/components/layout/SearchBar.tsx` | Unified Library + Tidal search |
| `app/ui/src/components/layout/Shell.tsx` | Main layout (sidebar, main, player) |
| `Makefile` | Dev, deploy, utilities |
| `docker-compose.yaml` | Production stack |
| `docker-compose.dev.yaml` | Dev stack |

## Server

- Host: root@104.152.210.73
- Path: /home/musicdock/musicdock
- Domain: admin.lespedants.org (UI), play.lespedants.org (Navidrome)
