# Development, Deployment, and Operations

## Development stack

Local development centers on `docker-compose.dev.yaml` and the helper targets in
`Makefile`.

### Core dev services

- PostgreSQL
- Redis
- `slskd`
- `crate-dev-api`
- `crate-dev-worker`
- Caddy
- Ollama when LLM work is enabled locally

The frontends usually run as Vite dev servers outside Docker:

- admin on `5173`
- listen on `5174`
- docs/reference surfaces on their own Vite ports when needed

## Local dev domains

The normal local domains are:

- `https://admin.dev.lespedants.org`
- `https://listen.dev.lespedants.org`
- `https://api.dev.lespedants.org`
- `https://docs.dev.cratemusic.app`

This matters because Crate's auth, cookies, and multi-origin topology are
closer to production when developed against those hostnames.

## Production stack

Production composition is defined by `docker-compose.yaml` plus, on the project
host, `docker-compose.project.yaml`.

Core Crate services:

- `crate-api`, `crate-worker`
- `crate-ui`, `crate-listen`
- `crate-postgres`, `crate-redis`
- `slskd`

Infrastructure around it:

- Traefik for reverse proxy and TLS

## Volumes and mounts

One of the most important deployment truths is mount asymmetry:

- API mounts library read-only
- worker mounts library read-write
- data directories hold DB/cache/config/runtime state

This separation is essential to Crate's safety model.

## Makefile as operations interface

The Makefile is effectively part of the operator UX.

Important command families:

- dev lifecycle (`make dev`, `make dev-down`, `make dev-rebuild`)
- regression/testing helpers
- deploy helpers
- Capacitor/mobile helpers

## Startup schema bootstrap

API and worker both call `init_db()`, but advisory locking ensures schema work
is not applied concurrently.

The current startup path is:

1. advisory lock
2. `alembic upgrade head`
3. optional extension setup
4. bootstrap seeds (genre taxonomy, admin user)

Fresh installs and upgrades therefore follow the same Alembic-based path.

## Database connection paths

Crate still has two runtime DB access paths:

- the legacy psycopg2 pool in `app/crate/db/core.py`
- the SQLAlchemy engine/session runtime in `app/crate/db/engine.py`

This is a controlled compatibility posture rather than the desired end-state for
all code. New runtime work should prefer the session-based path.

## Worker operational behavior

On startup the worker:

- marks orphaned tasks as failed
- clears stale locks/semaphores
- starts the service loop
- starts analysis/bliss daemons
- starts the projector thread
- launches Dramatiq

The service loop then maintains watcher/scheduler/import queue/runtime state and
periodic cleanup.

## Realtime and observability

Crate now exposes system state through several overlapping mechanisms:

- task list/status endpoints
- worker status/runtime snapshots
- SSE global and per-task feeds
- replayable cache invalidation feed
- snapshot-driven SSE surfaces
- Redis Stream domain-event diagnostics
- container logs and worker logs
- Telegram notifications for some task outcomes

### Admin ops snapshot

The admin dashboard is now backed by a richer ops snapshot that includes:

- core stats
- live worker/task state
- health counts
- recent activity
- domain-event runtime diagnostics
- cache invalidation runtime
- SSE surface catalog

This is the main operator-facing observability surface inside the product.

## Cache and eventing runtime

Redis now carries several distinct concerns:

- L2 cache
- Dramatiq broker
- cache invalidation replay feed
- minute-bucket metrics
- domain-event stream for the projector

That makes Redis operationally central even though PostgreSQL remains the
durable source of truth.

## Deployment caveat

`make deploy` syncs only the `app/` subtree to the server before rebuilding.
Do not `rsync --delete` the whole repo root to production; the host keeps data
outside the local tree.
