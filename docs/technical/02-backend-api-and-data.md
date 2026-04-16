# Backend API and Data Layer

## FastAPI application structure

The application factory lives in [app/crate/api/__init__.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/__init__.py).

Important characteristics:

- `create_app()` builds the FastAPI app.
- `lifespan()` initializes the DB schema and MusicBrainz client on startup.
- custom JSON serialization goes through `DateAwareJSONResponse`, which delegates to Crate's own `json_dumps`.
- CORS is configured for `admin.*`, `listen.*`, `api.*`, localhost Vite ports, and Capacitor shell origins.

## Middleware stack

Two custom middlewares are especially important:

- `AuthMiddleware`: session/JWT user hydration and request auth handling.
- `CacheInvalidationMiddleware`: pushes cache invalidation events to clients.

This means auth and invalidation are not just route-local concerns; they are part of the global request lifecycle.

## Router organization

Routers are grouped by domain under `https://github.com/diego-ninja/crate/blob/main/app/crate/api`.

Notable route groups:

- `auth.py`: login, logout, provider discovery, OAuth flows, linking/unlinking, sessions, invites.
- `me.py`: user-centric listening APIs, home sections, stats, likes, follows, saved albums, history.
- `playlists.py`: native playlists, collaborative playlist membership, invites, mutation.
- `radio.py`: radio seeds and smart continuation.
- `social.py`: public profiles, user search, follow graph, affinity.
- `jam.py`: jam rooms, invites, websocket state.
- `subsonic.py`: Open Subsonic-compatible surface for external clients.
- `browse*.py`: artist/album/media browsing.
- `enrichment.py`, `acquisition.py`, `scanner.py`, `tasks.py`, `stack.py`, `settings.py`: admin and operational domains.

### Registration order matters

Router order is not arbitrary. In [app/crate/api/__init__.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/__init__.py), more specific routers are registered before browse routers that contain `{name:path}` style catch-alls.

If that order is changed carelessly, apparently unrelated routes can become unreachable.

## Data access layer

The DB layer is organized under `https://github.com/diego-ninja/crate/blob/main/app/crate/db`.

### Connection management

[app/crate/db/core.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/core.py) provides:

- DSN construction from environment variables
- optional app DB provisioning using superuser credentials
- a shared `ThreadedConnectionPool`
- `get_db_ctx()` as the standard transactional cursor context manager

The preferred pattern across the codebase is:

```python
with get_db_ctx() as cur:
    cur.execute(...)
    row = cur.fetchone()
```

### Schema management

Schema initialization is centralized in [app/crate/db/core.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/core.py):

- `init_db()` acquires a PostgreSQL advisory lock
- `_create_schema()` defines the final desired shape of tables for new installs
- `_run_migrations()` backfills missing columns and structure for existing installs

This is an idempotent in-app migration system rather than an external Alembic-style migration workflow.

## Major table families

### Library tables

- `library_artists`, `library_albums`, `library_tracks` — the indexed library itself.
- `genres`, `artist_genres`, `album_genres` — raw tag-derived genre graph keyed by slug.
- `genre_taxonomy_nodes`, `genre_taxonomy_aliases`, `genre_taxonomy_edges` — the canonical taxonomy with parent/related relations and per-node metadata (descriptions, MusicBrainz/Wikidata references, EQ presets).
- similarity and discovery-related tables populated from audio analysis and Bliss.

These hold the indexed and enriched representation of the filesystem library.

### Operational tables

- `tasks`
- `task_events`
- `cache`
- `settings`
- `audit_log`

These power system operation, not the library itself.

### User and product tables

- `users`
- `sessions`
- `user_external_identities`
- likes, follows, saved albums, history, play events
- playlists and playlist membership/invites
- jam rooms and jam events
- affinity cache and social relationship state

These power the application as a multi-user platform.

## Cache architecture

The cache implementation lives in [app/crate/db/cache.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/cache.py).

Crate uses a three-tier strategy:

### L1: in-process memory

- very fast
- process-local
- TTL-based
- best for hot repeated calls inside the same process

### L2: Redis

- shared between API and worker
- TTL-based
- used for cache keys and also coordination primitives
- Redis DB 0 is cache

### L3: PostgreSQL fallback

- persistent across restarts
- used when Redis is unavailable or for migration compatibility

This tiering means Crate can degrade gracefully if Redis is missing, while still benefiting from Redis when present.

## Redis as both cache and broker

Crate uses Redis for two different responsibilities:

- DB 0: application cache and coordination keys
- DB 1: Dramatiq broker, configured in [app/crate/broker.py](https://github.com/diego-ninja/crate/blob/main/app/crate/broker.py)

The broker setup is explicit:

- `AgeLimit`
- `TimeLimit`
- `ShutdownNotifications`
- `Callbacks`
- `Pipelines`
- `Retries`

One key operational decision is that Redis eviction policy must not evict broker keys, so cache behavior and broker behavior are intentionally separated by DB number and TTL assumptions.

## API domains by concern

### Setup and bootstrapping

- initial admin account seeding
- setup checks
- environment-backed configuration

### Browsing and media retrieval

- artist/album/track browse APIs
- artwork delivery
- lyrics
- search
- explore and discovery sections

### Library management

- tag editing
- repair and duplicate workflows
- scan and import tooling
- organizer and batch operations

### Intelligence and analytics

- radio
- system playlists
- stats and insights
- discovery surfaces and home sections

### User product surface

- auth and sessions
- social graph
- collaborative playlists
- jam rooms
- playback telemetry and user library state

## Authentication on the backend

The backend auth surface in [app/crate/api/auth.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/auth.py) combines:

- password login
- Google OAuth
- Apple OAuth
- provider enable/disable flags in settings
- session persistence in `sessions`
- HTTP-only cookie auth
- JWT-backed identity
- session list/revoke endpoints
- auth invite flows

An important implementation detail is that JWT is not the whole auth story. Crate now persists real sessions in DB and uses those sessions for session management and presence-like behavior.

## Subsonic compatibility

[app/crate/api/subsonic.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/subsonic.py) exposes a parallel API surface under `/rest`.

This lets Crate act as a compatible source for:

- Symfonium
- DSub
- Ultrasonic
- other Subsonic/Open Subsonic clients

This is additive to Crate's native API, not a replacement for it.

## Design decisions in the backend layer

### Why DB helpers instead of an ORM

Crate uses explicit SQL and helper modules rather than SQLAlchemy models.

Benefits for this codebase:

- simple runtime footprint
- predictable SQL
- easier ad hoc migration logic
- fewer hidden behaviors around joins and lazy loading

Trade-off:

- schema evolution and query composition need more discipline
- there is less compile-time structure than a richer ORM layer would provide
- some repetition creeps in across `app/crate/db/*.py` (connection pool usage, row-dict shaping, cache coordination) that an ORM would absorb

An eventual move to SQLAlchemy 2.0 is on the table; the current patterns are deliberately boring so that migration would be a translation exercise, not an invention one.

### Why application-managed schema migrations

The current model is optimized for self-hosting simplicity:

- the API and worker can bring up a fresh database by themselves
- operators do not need a separate migration command
- startup ordering between API and worker is handled by advisory lock

Trade-off:

- migration history is less formal than a dedicated migration toolchain
- large or risky schema transitions need extra care inside application code

## Related documents

- [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services)
- [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
- [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
