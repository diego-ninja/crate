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
- `get_db_ctx()` for legacy cursor-based helpers and bootstrap paths that still use psycopg2 directly

[app/crate/db/engine.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/engine.py) provides the newer SQLAlchemy runtime:

- a lazy SQLAlchemy 2.x engine and `Session` factory
- the same `CRATE_POSTGRES_*` env var contract as `core.py`
- conservative default pooling (`pool_size=2`, `max_overflow=0`) with env overrides for operators

[app/crate/db/tx.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/tx.py) defines the explicit transaction boundary used by new code:

- `transaction_scope()` yields a SQLAlchemy `Session`
- `register_after_commit()` lets callers delay side effects until commit

The preferred pattern for new code is:

```python
from sqlalchemy import text

from crate.db.tx import transaction_scope

with transaction_scope() as session:
    row = session.execute(
        text("SELECT * FROM users WHERE email = :email"),
        {"email": email},
    ).mappings().first()
```

Legacy psycopg2 access still exists in `core.py` for bootstrap and frozen compatibility paths, but the runtime direction is now explicitly session-based.

### Module boundaries

The data layer is now intentionally split by responsibility:

- `db/*.py` remains the long-lived compatibility layer and home of older domain helpers
- `db/queries/*` holds read-heavy or SQL-visible query helpers
- `db/jobs/*` holds task, daemon, repair, and batch-oriented DB logic
- `db/orm/*` and `db/models/*` support targeted ORM-backed CRUD domains
- `crate.db` is now best thought of as a frozen compatibility facade: existing imports keep working, but new code should import concrete modules directly and should not keep widening the facade

### Schema management

Schema initialization is centralized in [app/crate/db/core.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/core.py):

- `init_db()` acquires a PostgreSQL advisory lock
- `_create_schema()` defines the final desired shape of tables for fresh installs
- `_run_migrations()` is frozen and only backfills legacy pre-Alembic installs
- `_run_alembic_upgrade()` applies `alembic upgrade head`
- bootstrap seeds such as the genre taxonomy and admin user run last inside one shared `transaction_scope()`

This is now a hybrid bootstrap + Alembic model: fresh self-hosted installs still come up without a separate manual step, while ongoing schema history lives in Alembic revisions under `app/crate/db/migrations`.

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

### Why hybrid SQLAlchemy plus explicit SQL

Crate no longer fits the old "helpers only, no ORM" description. The runtime is intentionally hybrid:

- SQLAlchemy `Session` and selected ORM-backed helpers for CRUD-oriented domains such as auth, sessions, settings, health, and other transactional workflows
- SQLAlchemy Core / `text()` for queues, daemons, browse/search, analytics, bulk updates, and other places where visible SQL is the better abstraction

Benefits for this codebase:

- explicit transaction boundaries via `transaction_scope()`
- visible SQL where performance and locking behavior matter
- standard engine/session/migration integration
- room for typed CRUD models without forcing every domain into ORM semantics

Trade-offs:

- the hybrid model needs discipline about where code belongs
- `crate.db` still carries a large compatibility surface during the transition
- some older helpers still return dict-shaped data until they are migrated or typed more strictly

The goal is not "ORM everywhere". It is "use ORM where it improves CRUD semantics, and keep explicit SQL where it expresses the system better".

### Why startup bootstrap and Alembic coexist

The current model is optimized for self-hosting simplicity without giving up inspectable migration history:

- the API and worker can bring up a fresh database by themselves
- operators do not need a separate bootstrap command for a brand-new install
- ongoing schema changes are visible as Alembic revisions
- startup ordering between API and worker is still handled by advisory lock

Trade-off:

- the bootstrap path is more layered than a pure "run Alembic and nothing else" setup
- docs and code need to stay clear about which changes belong in frozen legacy bootstrap versus Alembic history

## Related documents

- [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services)
- [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
- [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
