# Crate — Comprehensive Code Audit

**Date**: 2026-03-27
**Scope**: Full codebase — Python backend, React frontend, Docker/infra, Rust component

---

## Executive Summary

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Python Backend | 3 | 7 | 15 | 10 | 35 |
| React Frontend | 1 | 6 | 10 | 11 | 28 |
| Architecture/Infra | 4 | 8 | 14 | 9 | 35 |
| **Total** | **8** | **21** | **39** | **30** | **98** |

Top 5 priorities by impact:
1. **Missing auth on 17 API routers** — anyone with network access can delete files, restart containers
2. **Hardcoded passwords** in compose/source (Navidrome, admin)
3. **worker.py is 2868 lines** — god module, unmaintainable
4. **Artist.tsx is 1761 lines** — god component, re-renders everything
5. **PlayerContext re-render storm** — fires 4x/sec on every consumer

---

## CRITICAL (8 issues)

### SEC-1: Unauthenticated API endpoints
- **Area**: API
- **Files**: `browse.py`, `scanner.py`, `tags.py`, `artwork.py`, `matcher.py`, `duplicates.py`, `organizer.py`, `imports.py`, `batch.py`, `analytics.py`, `events.py`, `tasks.py`, `stack.py`, `genres.py`, `navidrome.py`, `audiomuse.py`, `enrichment.py`
- **Description**: 17 routers have ZERO auth checks. `stack.py` exposes Docker container control. `tasks.py` allows worker restart. `duplicates.py` and `organizer.py` can delete/move files.
- **Fix**: Add `_require_auth(request)` to all endpoints. `_require_admin` for destructive ops.

### SEC-2: Navidrome plaintext password in source
- **File**: `navidrome.py:19`, `docker-compose.yaml:278,327`
- **Description**: Default password `0n053nd41` hardcoded in Python code and compose file.
- **Fix**: Remove default. Require env var or fail loudly.

### SEC-3: Default admin password `admin123`
- **File**: `db/auth.py:15`, `docker-compose.yaml:295,339`
- **Description**: Trivially guessable default password for admin account.
- **Fix**: Generate random password at first startup, log it once. Remove default from prod compose.

### SEC-4: SQL injection potential in `db/audit.py`
- **File**: `db/audit.py:63-66`
- **Description**: `format(table)` injects table name directly into SQL. Currently safe (hardcoded list) but one refactor away from injection.
- **Fix**: Use `psycopg2.sql.Identifier`.

### SEC-5: `.env` with all secrets deployed via `scp`
- **File**: `Makefile:163`
- **Description**: `make deploy` copies local `.env` to production. Modified local env can overwrite prod secrets.
- **Fix**: Manage prod secrets separately on server.

### SEC-6: Docker socket mounted in API container
- **File**: `docker-compose.yaml:306`
- **Description**: API container has Docker socket access. Combined with no auth on `stack.py`, any request can control containers.
- **Fix**: Move Docker socket to worker only, add admin auth to stack endpoints.

### SEC-7: CORS allows all origins with credentials
- **File**: `api/__init__.py:23-27`
- **Description**: `allow_origins=["*"]` + credential cookies = CSRF risk.
- **Fix**: Restrict to `https://admin.lespedants.org` + `http://localhost:*`.

### SEC-8: Open user registration
- **File**: `api/auth.py:160`
- **Description**: Anyone can create accounts via `POST /api/auth/register`.
- **Fix**: Disable public registration or require invite/admin approval.

---

## HIGH (21 issues)

### ARCH-1: `worker.py` god module (2868 lines, 43 task handlers)
- **Fix**: Extract handlers into `worker/tidal.py`, `worker/enrichment.py`, `worker/analysis.py`, `worker/management.py`, etc.

### ARCH-2: `Artist.tsx` god component (1761 lines, ~20 useState)
- **Fix**: Extract into `ArtistDiscographyTab`, `ArtistSimilarTab`, `ArtistSetlistTab`, `ArtistShowsTab`, `ArtistAboutTab`. Extract state into `useArtistPage(name)` hook.

### PERF-1: PlayerContext re-renders all consumers 4x/sec
- **File**: `PlayerContext.tsx:411-444`
- **Description**: `currentTime` updates via `timeupdate` event create new context value object on every tick.
- **Fix**: Split into `PlayerStateContext` (currentTime, duration, isPlaying) and `PlayerActionsContext` (play, pause, next — stable).

### PERF-2: N+1 query in `_handle_analyze_tracks` coordinator
- **File**: `worker.py:666-674`
- **Description**: One `SELECT COUNT(*)` per artist (~900 queries) to check which need analysis.
- **Fix**: Single `SELECT al.artist, COUNT(*) ... GROUP BY al.artist HAVING COUNT(*) > 0`.

### PERF-3: N+1 queries in `navidrome.map_library_ids()`
- **File**: `navidrome.py:350-386`
- **Description**: Individual API call per artist, then per album, then per-track DB update.
- **Fix**: Batch DB updates per artist in single transaction.

### PERF-4: `LibrarySync.sync_album()` opens 5+ transactions per album
- **File**: `library_sync.py:226-240`
- **Description**: Each upsert opens its own `get_db_ctx()`. Full sync = 20,000+ connections.
- **Fix**: Accept optional cursor, batch within single transaction.

### PERF-5: `audiomuse.py` bypasses connection pool
- **File**: `audiomuse.py:96-161`
- **Description**: Raw `psycopg2.connect()` without pool or context manager. Connection leak risk.
- **Fix**: Use `get_db_ctx()` or dedicated pool with proper context manager.

### BUG-1: `create_task_dedup` TOCTOU race condition
- **File**: `db/tasks.py:19-32`
- **Description**: Check and insert in separate transactions. Two threads can create the same task.
- **Fix**: Single transaction with `INSERT ... ON CONFLICT DO NOTHING` + partial unique index.

### BUG-2: Missing `unmark_processing()` in process_new_content
- **File**: `worker.py:1754`
- **Description**: `mark_processing(artist_name)` called but never unmark. Watcher permanently ignores artist after first process.
- **Fix**: Add `unmark_processing()` in `finally` block.

### BUG-3: `tidal.search()` infinite recursion on 401
- **File**: `tidal.py:129-133`
- **Description**: If refreshed token is also invalid, recurses forever.
- **Fix**: Add `_retried=False` param, only retry once.

### FRONT-1: recharts import (should be Nivo)
- **File**: `components/album/TrackTable.tsx:21-25`
- **Fix**: Replace RadarChart with `@nivo/radar`.

### FRONT-2: No AbortController in `api()` or `useApi`
- **File**: `lib/api.ts`, `hooks/use-api.ts`
- **Description**: Navigating away leaves orphan fetches. `useApi` uses boolean flag instead of abort.
- **Fix**: Accept `signal` in `api()`. Create `AbortController` per effect cycle in `useApi`.

### FRONT-3: Duplicated task-polling pattern (8+ files)
- **Files**: Health.tsx, Album.tsx, Genres.tsx, Playlists.tsx, Settings.tsx, AlbumHeader.tsx, NewReleases.tsx
- **Description**: Same `setInterval + poll + clearInterval` copy-pasted everywhere. `useTaskPoll` exists but unused.
- **Fix**: Use `useTaskPoll` consistently, or create `awaitTask(taskId)` utility.

### FRONT-4: useAudioVisualizer 120 state updates/sec
- **File**: `hooks/use-audio-visualizer.ts:57-76`
- **Description**: `setFrequencies` + `setWaveform` on every rAF (~60fps).
- **Fix**: Use refs + canvas rendering, or throttle to 20fps.

### INFRA-1: No healthchecks on any MusicDock container
- **Fix**: Add `curl -f http://localhost:8585/api/status` for API, `pg_isready` for Postgres, `redis-cli ping` for Redis.

### INFRA-2: No resource limits (mem/cpu) except audiomuse
- **Fix**: Add `mem_limit` and `cpus` to API, worker, Postgres.

### INFRA-3: No rate limiting
- **Description**: No rate limiting on login, registration, or any endpoint.
- **Fix**: Rate-limit at minimum `/api/auth/login` (5/min/IP).

### INFRA-4: All timestamps stored as TEXT
- **File**: `db/core.py` (throughout)
- **Description**: Prevents DB-level date operations, range queries, timezone handling.
- **Fix**: Migrate to `TIMESTAMPTZ`.

### INFRA-5: No migration framework
- **File**: `db/core.py:75-518`
- **Description**: 440-line `init_db()` with `CREATE IF NOT EXISTS` + exception-catching ALTER blocks.
- **Fix**: Add `schema_version` table + numbered migrations at minimum.

---

## MEDIUM (39 issues)

### Code Duplication
| ID | Description | Files |
|----|-------------|-------|
| DUP-1 | `_normalize_key()` duplicated | `library_sync.py:409`, `health_check.py:90` |
| DUP-2 | `PHOTO_NAMES` constant duplicated 3x | `library_sync.py`, `health_check.py`, `repair.py` |
| DUP-3 | `update_track_audiomuse()` call pattern 3x | `worker.py` (3 locations) |
| DUP-4 | `timeAgo()` function duplicated 5x | Dashboard, Health, Tasks, NotificationBell, Settings |
| DUP-5 | `fmtDuration()` duplicated 3x | Download, Playlists, Tasks (utils already has `formatDuration`) |
| DUP-6 | `musicbrainzngs.set_useragent()` called 5x with different names | lastfm, matcher, musicbrainz_ext, worker (2x) |

### Performance
| ID | Description | Fix |
|----|-------------|-----|
| PERF-6 | `health_check._check_stale_tracks` only samples 10% | Check all, or batch per-album |
| PERF-7 | `popularity.compute_popularity()` no batch limit for 48K tracks | Add configurable limit |
| PERF-8 | `_handle_compute_analytics` walks filesystem when DB has same data | Use `get_library_stats()` |
| PERF-9 | `health_check._check_missing_covers` holds DB connection during full FS scan | Fetch rows first, close ctx, then iterate |
| PERF-10 | `bliss._find_binary()` does FS checks on every call | Cache result |
| PERF-11 | `enrichment.py` 6x `time.sleep(0.3)` = 1.8s/artist minimum | Per-host rate limiter instead |
| PERF-12 | NotificationContext polls every 5s even when tab hidden | Use Page Visibility API |

### Code Smells
| ID | Description | Fix |
|----|-------------|-----|
| SMELL-1 | `__import__` abuse in worker.py | Proper top-level imports |
| SMELL-2 | `import re` inside loops/functions | Move to module level |
| SMELL-3 | Dead code in `_handle_analyze_album_full` else branch | Remove |
| SMELL-4 | 179 bare `except Exception: pass` across codebase | Add `log.debug` minimum |
| SMELL-5 | Download.tsx unused `setSlskSearchId` state | Remove |
| SMELL-6 | Chart components in `components/charts/` unused | Remove dead code |
| SMELL-7 | Inconsistent logger naming (`log` vs `logger`) | Standardize to `log` |

### Architecture
| ID | Description | Fix |
|----|-------------|-----|
| ARCH-3 | `_db_heavy_lock` re-queue pattern wastes thread pool slots | Move check to `claim_next_task` |
| ARCH-4 | `SearchBar.tsx` 456 lines doing too much | Extract `useUnifiedSearch` hook + `SearchResults` component |
| ARCH-5 | `library_artists` uses `name` as PK — rename cascades are manual | Consider synthetic PK |
| ARCH-6 | Inconsistent route definition style (prefix vs inline) | Standardize on `APIRouter(prefix=)` |
| ARCH-7 | `spotify.py` global token state not thread-safe | Add `threading.Lock()` |
| ARCH-8 | No task timeout mechanism — hung handler blocks slot forever | Add Future timeout tracking |
| ARCH-9 | `useFavorites` uses module-level mutable globals | Use `useSyncExternalStore` |

### Frontend Patterns
| ID | Description | Fix |
|----|-------------|-----|
| FRONT-5 | Missing deps in Browse.tsx effect | Add `fetchPage` to dep array |
| FRONT-6 | Stale closure risk in PlayerContext effects | Wrap callbacks in `useCallback` |
| FRONT-7 | Profile.tsx useState initializer runs side effect | Use useEffect |
| FRONT-8 | NotificationContext.unreadCount not memoized | `useMemo` |

### Infrastructure
| ID | Description | Fix |
|----|-------------|-----|
| INFRA-6 | Missing restart policy on authelia, musicdock-ui | Add `restart: unless-stopped` |
| INFRA-7 | Dockerfile not optimized for layer caching | Reorder: requirements -> install -> source |
| INFRA-8 | Missing index on `tidal_downloads.tidal_id` | Add index |
| INFRA-9 | Missing index on `sessions.expires_at` + no session cleanup | Add both |
| INFRA-10 | `playlist_tracks.track_path` has no FK to library_tracks | Add FK with CASCADE |
| INFRA-11 | `pytest` in production requirements.txt | Split dev/prod requirements |

---

## LOW (30 issues)

### Frontend
- Missing `aria-label` on icon-only buttons (AudioPlayer, Browse, Health)
- Keyboard navigation broken on artist grid cards (`<div onClick>`)
- Inconsistent Provider nesting in App.tsx
- `useApi` body param not in dependency array (eslint-disable)
- Shows.tsx Leaflet marker key falls back to array index
- `formatDuration` doesn't `Math.floor` fractional seconds
- Discover.tsx uses inline `style={{ display }}` instead of conditional render
- Toaster placement inconsistent in App.tsx

### Backend
- ISO timestamps as TEXT instead of TIMESTAMPTZ (repeated above as INFRA-4)
- `delete_artist()` doesn't use CASCADE (manually deletes)
- `_handle_check_new_releases` makes Tidal calls inside MB loop
- `config.load_config()` no error handling on missing file
- `init_db()` not idempotent-safe for partial migrations

### Infrastructure
- Python 3.13 in Dockerfile vs 3.12 in docs
- No Python lock file (unreproducible builds)
- `beets>=2.0` possibly unused dependency
- Rust: `rayon` possibly unused in Cargo.toml
- Rust: `unwrap()` on JSON serialization (panic risk on invalid paths)
- Rust: binary only for linux/amd64 (no ARM for dev)
- Rust: no optimized release profile (`lto`, `codegen-units`)
- Hardcoded `maxconn=30` for DB pool
- Inconsistent `MAX_WORKERS` defaults (5 in worker.py, 3 in tasks.py)

---

## Recommended Fix Order

### Phase 1: Security (immediate)
1. Add auth to all unprotected routers
2. Remove hardcoded passwords from compose and source
3. Fix CORS to restrict origins
4. Disable open registration
5. Move Docker socket from API to worker

### Phase 2: Bugs & Stability
1. Fix `unmark_processing()` missing call
2. Fix `create_task_dedup` TOCTOU race
3. Fix Tidal search infinite recursion
4. Add healthchecks to Docker services
5. Add resource limits

### Phase 3: Performance
1. Fix PlayerContext re-render storm (split contexts)
2. Fix N+1 queries (analyze coordinator, navidrome, library_sync)
3. Fix `audiomuse.py` connection pool bypass
4. Throttle audio visualizer to 20fps
5. Add AbortController to API calls

### Phase 4: Architecture & Maintainability
1. Split `worker.py` into task handler modules
2. Split `Artist.tsx` into tab components
3. Extract duplicated patterns (timeAgo, task polling, normalize_key)
4. Replace recharts with Nivo
5. Standardize route definitions

### Phase 5: Infrastructure Polish
1. Migrate timestamps to TIMESTAMPTZ
2. Add simple migration framework
3. Split dev/prod Python requirements
4. Add rate limiting
5. Optimize Dockerfile layer caching
