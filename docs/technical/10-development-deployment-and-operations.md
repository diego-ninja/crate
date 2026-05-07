# Development, Deployment, and Operations

## Development stack

Local development centers on `docker-compose.dev.yaml` and the helper targets in
`Makefile`.

Other compose files are intentionally scoped:

- `docker-compose.yaml`: production/service definition used with project
  overlays.
- `docker-compose.project.yaml`: production domain/Traefik overlay for the
  hosted Crate instance.
- `docker-compose.home.yaml`: smaller self-hosted install used by the
  one-line installer.
- `docker-compose.local-stack.yaml`: local override for the production-style
  stack on `*.crate.local`.
- `docker-compose.readplane.dev.yaml`: local readplane service/proxy overlay.

### Core dev services

- PostgreSQL
- Redis
- `slskd`
- `crate-dev-api`
- `crate-dev-readplane`
- `crate-dev-worker`
- `crate-dev-maintenance-worker`
- `crate-dev-analysis-worker`
- `crate-dev-playback-worker`
- `crate-dev-media-worker`
- Caddy
- Ollama when LLM work is enabled locally

The frontends usually run as Vite dev servers outside Docker:

- admin on `5173`
- listen on `5174`
- marketing site on `5175`
- docs on `5176`

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

- `crate-api`, `crate-readplane`
- `crate-worker`, `crate-projector`, `crate-maintenance-worker`,
  `crate-analysis-worker`, `crate-playback-worker`
- `crate-media-worker`
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

The worker layer is split by concern:

- `crate-worker` runs fast/default queues plus the service loop.
- `crate-maintenance-worker` runs maintenance queue work.
- `crate-analysis-worker` runs heavy analysis/fingerprint/bliss work.
- `crate-playback-worker` runs playback prepare/transcode work.
- `crate-projector` runs the domain-event projector command.
- `crate-media-worker` runs Rust package/download artifact generation.

The service-loop runtime marks orphaned/zombie tasks, clears stale locks and
semaphores, maintains watcher/scheduler/import queue/runtime state, and
performs periodic cleanup.

Expensive background work is guarded by `app/crate/resource_governor.py`. The
`CRATE_RESOURCE_*` thresholds and `CRATE_MAINTENANCE_WINDOW_*` settings decide
when governed tasks should run immediately or be deferred to protect playback
and interactive usage.

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
- media-worker job/progress/cancel/slot state

That makes Redis operationally central even though PostgreSQL remains the
durable source of truth.

## Deployment caveat

`make deploy` is image-first: it expects the release images built by GitHub
Actions/GHCR, checks that required manifests are pullable, syncs only the
deployment files needed by the server, and restarts the compose stack from
those images. Do not `rsync --delete` the whole repo root to production; the
host keeps media/data outside the local tree.
