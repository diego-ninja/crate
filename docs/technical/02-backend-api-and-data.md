# Backend API and Data Layer

## FastAPI application structure

The application factory lives in `app/crate/api/__init__.py`.

Important characteristics:

- `create_app()` builds the FastAPI app.
- startup calls `init_db()` and the MusicBrainz initializer.
- request JSON serialization goes through Crate's custom JSON helpers.
- CORS is configured for admin/listen web origins, dev Vite ports, and native
  shell scenarios.

## Middleware stack

Three custom middlewares matter most:

- `AuthMiddleware` — user/session hydration and request auth handling
- `CacheInvalidationMiddleware` — emits invalidation events after write
  requests
- `MetricsMiddleware` — records API counters and latency

This means auth, cache invalidation, and metrics are not just route-local
concerns; they are part of the global request lifecycle.

## Router organization

Routers are grouped by domain under `app/crate/api`.

Notable route groups:

- `auth.py`: login, logout, provider discovery, OAuth flows, sessions, invites
- `me.py`: home discovery, likes, follows, saved albums, play events, stats,
  history, feed, and upcoming
- `playlists.py`: native playlists, collaboration, and playlist invites
- `social.py`: public profiles, user search, follows, and affinity
- `radio.py`: radio seeds and continuation
- `jam.py`: jam rooms, invites, and websocket-connected state
- `subsonic.py`: Open Subsonic-compatible surface under `/rest`
- `acquisition.py`, `tidal.py`, `scanner.py`, `tasks.py`, `settings.py`,
  `stack.py`, `enrichment.py`: admin and operational domains

### Registration order matters

Browse routers contain `{name:path}`-style catch-alls, so route registration
order in `app/crate/api/__init__.py` is important. Specific routes must remain
registered before browse routers or they can become unreachable.

## Data access layer

The DB layer lives under `app/crate/db`.

### Connection management

`app/crate/db/core.py` still provides the legacy psycopg2 pool and the
authoritative bootstrap entrypoint:

- DSN construction from environment variables
- optional DB provisioning
- `ThreadedConnectionPool`
- `init_db()` with PostgreSQL advisory locking
- Alembic bootstrap/upgrade orchestration

`app/crate/db/engine.py` provides the SQLAlchemy engine/session runtime used by
most modern code.

`app/crate/db/tx.py` defines the transaction helpers used by new runtime code:

- `transaction_scope()`
- `read_scope()`
- `optional_scope()`
- `register_after_commit()`

The preferred pattern for new code is explicit SQLAlchemy `Session` work inside
`transaction_scope()`.

### Schema bootstrap

The runtime bootstrap is now **Alembic-only**.

Current `init_db()` behavior in `app/crate/db/core.py`:

1. acquire an advisory lock
2. run `alembic upgrade head`
3. attempt optional observability extension setup
4. seed genre taxonomy and admin user inside one transaction

The older “hybrid `_create_schema()` plus frozen runtime migration bridge”
model is no longer the active startup path.

## Module boundaries

The DB layer has been split by responsibility:

- `db/queries/*` — read-heavy SQL helpers
- `db/jobs/*` — daemon, batch, repair, and claim/update helpers
- `db/repositories/*` — write-oriented and domain-specific persistence helpers
- `db/orm/*` and `db/models/*` — selected ORM-backed CRUD domains
- `db/*.py` — compatibility facades and long-lived entrypoints

`crate.db` itself should now be treated as a compatibility facade. New code
should prefer importing concrete modules directly.

## Major table families

### Core library tables

- `library_artists`
- `library_albums`
- `library_tracks`
- `genres`, `artist_genres`, `album_genres`
- taxonomy graph tables

These still hold the canonical indexed library and much of the enriched entity
state.

### Operational tables

- `tasks`
- `task_events`
- `cache`
- `settings`
- `audit_log`
- `worker_logs`

These power system operation rather than library content.

### User/product tables

- `users`
- `sessions`
- `user_external_identities`
- follows, likes, saved albums
- playlists and collaboration tables
- jam room tables
- social/affinity state
- listening telemetry tables

## Read plane tables

The new read plane introduced several important tables:

- `ui_snapshots` — persisted snapshot payloads keyed by scope/subject
- `ops_runtime_state` — small, fast operational state blobs
- `import_queue_items` — normalized read model for import sources

There is also a compatibility facade at `app/crate/db/read_models.py` that
re-exports snapshot/runtime helpers without pushing new code back into
`crate.db.__init__`.

## Pipeline shadow tables

The analysis/bliss pipeline no longer relies only on legacy columns inside
`library_tracks`.

Important tables:

- `track_processing_state`
- `track_analysis_features`
- `track_bliss_embeddings`
- `track_popularity_features`

### Operational truth

`track_processing_state` is now the operational truth for claim/retry/recovery
in the analysis and bliss pipelines.

The shadow feature tables are the preferred source for new queries and status
surfaces. Legacy columns in `library_tracks` are still mirrored for
compatibility, but they are no longer the intended primary pipeline contract.

## Cache architecture

Crate uses a three-tier cache strategy:

### L1: in-process memory

- very fast
- process-local
- TTL-based

### L2: Redis

- shared across API and worker
- used for cache keys, invalidation replay, metrics buckets, and coordination

### L3: PostgreSQL fallback

- persistent across restarts
- used when Redis is unavailable or for compatibility fallbacks

Redis also serves a second role as the Dramatiq broker on DB 1.

## Domain events and snapshot projection

Crate now has an explicit domain-event bus in `app/crate/db/domain_events.py`.

Important properties:

- backed by Redis Streams
- consumer group used by the projector
- publishing can be deferred with `register_after_commit()`
- runtime includes diagnostics for sequence, lag, pending count, and recent
  events

Current notable event types include:

- `ui.invalidate`
- `ui.snapshot.updated`
- `track.analysis.updated`
- `track.bliss.updated`
- `user.play_event.recorded`
- `user.listening_aggregates.updated`

`app/crate/projector.py` consumes those events and warms affected read models
such as:

- admin ops snapshots
- user home discovery snapshots

This is why many UI surfaces now behave like warmed read models rather than
live recomputation on every request.

## Listening telemetry model

The canonical listening telemetry table is now `user_play_events`.

Key properties:

- richer schema than the old `play_history`
- `client_event_id` supports idempotent retries per user
- captures timing, source attribution, device/app metadata, and completion
  semantics
- drives user listening aggregates and stats surfaces

`POST /api/me/play-events` is the preferred write path.

The older `play_history` table and `POST /api/me/history` endpoint remain only
as compatibility surfaces and should not be treated as the primary model.

Scrobbling is no longer performed inline in the telemetry write transaction; it
is queued as an asynchronous follow-up actor after commit.

## Authentication on the backend

The backend auth surface combines:

- password login
- Google OAuth
- Apple OAuth
- persisted sessions
- bearer-token identity for native Listen clients
- invite flows
- session list/revoke endpoints

JWT still exists, but it is not the whole story: session rows in PostgreSQL are
the management and revocation layer that sits behind the token.

## Subsonic compatibility

`app/crate/api/subsonic.py` exposes a parallel surface under `/rest`.

This is additive to Crate's native API and exists so the server can act as a
source for Open Subsonic-compatible clients.

## Design decisions in the backend layer

### Why hybrid SQLAlchemy plus explicit SQL

Crate intentionally mixes:

- SQLAlchemy `Session` and selected ORM-backed CRUD helpers for transactional
  domains such as auth, sessions, settings, and some write flows
- explicit SQL for queues, browse/search, analytics, read models, and pipeline
  claim/update logic

That keeps high-complexity SQL visible while still gaining transaction and
composition ergonomics where they help.
