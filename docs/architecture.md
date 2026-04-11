# Architecture

## System Overview

Crate runs as a Docker Compose stack with 4 core services and several optional integrations.

```
Browser
  |
Traefik (TLS + forward-auth)
  |
  +-- crate-ui (nginx + React SPA)
  |     |
  |     +-- /api/* --> crate-api (FastAPI)
  |
  +-- crate-api (FastAPI, port 8585)
  |     +-- /music (read-only mount)
  |     +-- /rest (Open Subsonic API)
  |     +-- PostgreSQL (connection pool)
  |     +-- Redis (L2 cache)
  |     +-- slskd API (Soulseek)
  |
  +-- crate-worker (Python, 5 thread slots)
  |     +-- /music (read-write mount)
  |     +-- PostgreSQL
  |     +-- Redis
  |     +-- Task queue (DB-backed)
  |     +-- Filesystem watcher (watchdog)
  |     +-- Scheduler (periodic tasks)
  |
  +-- PostgreSQL 15
  +-- Redis 7 (256MB, allkeys-lru)
  +-- slskd (Soulseek)
```

## Core Principle: Read-Only API

The API container mounts `/music` as **read-only**. This is a deliberate design constraint:

- The API serves files (streaming, covers) and reads metadata
- Any operation that modifies the filesystem (tag writes, file moves, downloads, image uploads) creates a **task** in the database
- The worker picks up tasks and executes them with read-write access

This separation prevents accidental data corruption and makes the system more predictable.

## Task Queue

The task system is the backbone of all background work:

```python
# API side: create a task
task_id = create_task("task_type", {"param": "value"})

# Worker side: handler processes it
def _handle_task_type(task_id, params, config):
    # do work, emit events, update progress
    return {"result": "value"}
```

Tasks support:
- **Progress tracking**: JSON progress field updated during execution
- **SSE events**: Real-time events streamed to the browser
- **Cancellation**: Tasks check `_is_cancelled(task_id)` periodically
- **Retry**: Failed tasks can be retried from the UI
- **DB-heavy serialization**: Certain tasks (sync, repair, wipe) run one at a time

There are 42+ registered task handlers covering analysis, enrichment, downloads, repairs, and management operations.

## Cache Architecture

Three-tier cache with automatic fallthrough:

| Tier | Storage | TTL | Max Size | Use Case |
|------|---------|-----|----------|----------|
| L1 | In-memory dict | 60s | 2000 keys | Hot path (repeated API calls) |
| L2 | Redis | Per-key | 256MB (LRU eviction) | Shared between API/worker |
| L3 | PostgreSQL `cache` table | Per-key | Unlimited | Persistent across restarts |

Cache keys use prefixes for bulk invalidation: `delete_cache_prefix("enrichment:")`.

## Worker Architecture

The worker runs a `ThreadPoolExecutor` with 5 slots (configurable):

- **Regular tasks**: Up to 5 concurrent
- **DB-heavy tasks**: Serialized (only 1 at a time) via `_db_heavy_lock`
- **Chunked tasks**: Large operations split into sub-tasks of 10 artists each, processed in parallel across worker slots

Additional worker components:
- **Filesystem watcher**: watchdog monitors `/music` for changes, auto-syncs new content
- **Scheduler**: Checks every 60s, creates periodic tasks (library_pipeline every 30min, enrich every 24h, analytics every 1h, cleanup every 48h)
- **Import queue**: Checks every 60s for pending imports

## Database Schema

Key tables:

| Table | Purpose |
|-------|---------|
| `library_artists` | Artist metadata + enrichment data (name PK) |
| `library_albums` | Album metadata, MusicBrainz IDs |
| `library_tracks` | Track metadata + audio analysis (BPM, key, energy, mood, bliss_vector) |
| `genres` / `artist_genres` / `album_genres` | Genre taxonomy |
| `playlists` / `playlist_tracks` | Manual and smart playlists |
| `tasks` / `task_events` | Task queue + SSE events |
| `audit_log` | Destructive operation tracking |
| `tidal_downloads` | Tidal download queue + wishlist |
| `favorites` | Local user favorites |
| `cache` | L3 persistent cache |
| `users` / `sessions` | Authentication |
| `settings` | App configuration |

Schema migrations run in `init_db()` using idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

## Authentication

- JWT tokens stored in HTTP-only cookies
- Forward-auth middleware for Traefik (shared with Tidarr and other bypassed services)
- Google OAuth support (optional)
- Role-based access: `admin` and `user` roles
- Admin-only routes: management, settings, tasks, stack, users

## External Integrations

| Service | Protocol | Used For |
|---------|----------|----------|
| Last.fm | REST API | Bio, tags, similar artists, images, playcount |
| MusicBrainz | REST API (rate-limited) | MBID, discography, metadata |
| Fanart.tv | REST API | Artist backgrounds, thumbnails |
| Setlist.fm | REST API | Concert setlists |
| Spotify | REST API | Popularity (requires Premium) |
| Deezer | HTTP scraping | Artist photos, album covers |
| Tidal | tiddl library | Search, download |
| slskd | REST API | Soulseek search, download |
| Crate Subsonic API | Open Subsonic | Third-party players and compatible streaming clients |
| Cover Art Archive | REST API | Album covers by MBID |
| lrclib.net | REST API | Synced lyrics (LRC format) |
