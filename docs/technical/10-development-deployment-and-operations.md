# Development, Deployment, and Operations

## Development stack

Local development is centered on [docker-compose.dev.yaml](https://github.com/diego-ninja/crate/blob/main/docker-compose.dev.yaml) and the helper targets in [Makefile](https://github.com/diego-ninja/crate/blob/main/Makefile).

### Core dev services

- PostgreSQL
- Redis
- `slskd`
- `crate-dev-api`
- `crate-dev-worker`
- Caddy

The frontends usually run as Vite dev servers outside Docker:

- admin on `5173`
- listen on `5174`
- docs on `5175`

## Local dev domains

The normal local domains are:

- `https://admin.dev.lespedants.org`
- `https://listen.dev.lespedants.org`
- `https://api.dev.lespedants.org`
- `https://docs.dev.cratemusic.app`

This matters because Crate's auth, cookies, and multi-origin app topology are closer to production when developed against these hostnames.

## Production stack

Production composition is defined in [docker-compose.yaml](https://github.com/diego-ninja/crate/blob/main/docker-compose.yaml).

Core Crate services:

- `crate-api`, `crate-worker`
- `crate-ui`, `crate-listen`
- `crate-docs` (opt-in via the `docs` compose profile — see below)
- `crate-postgres`, `crate-redis`
- `slskd` for Soulseek

Infrastructure around it:

- Traefik for reverse proxy + Let's Encrypt certificates
- Authelia as a soft-auth middleware option

Images for `crate-api`, `crate-ui`, `crate-listen`, and `crate-docs` are
built and pushed to GHCR by
[.github/workflows/build-images.yml](https://github.com/diego-ninja/crate/blob/main/.github/workflows/build-images.yml)
on every push to `main` that touches the relevant paths.

### The docs profile

`crate-docs` serves the project-level documentation at
`docs.cratemusic.app`, not a per-instance URL. Other Crate operators
don't need that container, so it's behind
`profiles: ["docs"]`. On the canonical project server, adding
`COMPOSE_PROFILES=docs` to `.env` makes `docker compose up -d` include
it; elsewhere it stays dormant.

## Volumes and mounts

One of the most important deployment truths is mount asymmetry:

- API mounts library read-only
- worker mounts library read-write
- data directories hold DB/cache/config state

This separation is essential to Crate's safety model.

## Environment variables

Crate is heavily environment-configured.

Major groups:

- PostgreSQL credentials and host
- Redis URL
- domain and JWT secret
- OAuth credentials
- Last.fm / Fanart / Spotify / Discogs / Ticketmaster keys
- Soulseek configuration
- timezone and UID/GID values

These env vars affect both infrastructure wiring and product behavior.

## Makefile as operations interface

The Makefile is effectively part of the operator UX.

Important command families:

### Dev

- `make dev`
- `make dev-down`
- `make dev-rebuild`
- `make dev-reset`
- `make dev-logs`
- `make dev-docs`

### Regression and tests

- `make dev-test`
- `make regression-api`
- `make regression-radio`
- `make regression-smoke`

### Deploy

- `make deploy`
- `make deploy-build`
- `make deploy-sync`
- `make deploy-restart`
- `make deploy-logs`

This gives Crate a low-friction local and remote operations surface.

## Hosted documentation as part of the stack

The docs site is now part of the stack rather than an external afterthought.

Development:

- Caddy routes `docs.dev.cratemusic.app` to the Vite server in `app/docs`

Production:

- Traefik routes `docs.${DOMAIN}` to the `crate-docs` container

This matters operationally because documentation changes can now be deployed and verified like any other frontend surface.

## Important operational behaviors

### Startup schema migration

API and worker both call DB initialization, but PostgreSQL advisory locking ensures schema work is not applied concurrently.

### Worker self-healing

On startup the worker:

- marks orphaned running tasks as failed
- clears stale locks
- restarts watcher/service loop/daemons

### Cache fallback

If Redis is unavailable, Crate can still continue with PostgreSQL-backed fallback cache semantics.

That is a strong operational resilience decision for self-hosted environments.

## Realtime and observability

Crate exposes system state in several ways:

- task list endpoints
- worker status endpoint
- SSE global events
- SSE per-task events
- logs in containers
- Telegram notifications for task completion/failure

This is not full observability in the Prometheus sense, but it gives operators a strong enough picture for a self-hosted product.

## Security posture

### Auth separation

- app auth lives in Crate
- outer reverse-proxy and Authelia can protect adjacent services

### Cookie posture

Cookies are configured for cross-origin and native-shell scenarios, because Listen is designed for Capacitor as well as web.

### Role model

Crate distinguishes at least:

- admin
- regular user

Many operational routes are admin-only.

## Testing posture

The project currently leans on:

- targeted backend regression tests
- focused frontend tests in Listen for playback-related helpers
- smoke testing against the dev environment

This is pragmatic rather than exhaustive, and worth knowing when planning large refactors.

## Operational constraints worth remembering

### Do not write to `/music` from the API

This is one of the easiest architectural lines to accidentally blur when shipping new features. It should remain firm.

### Deploy sync is scoped

The deploy flow intentionally syncs `app/`, top-level `docs/` (consumed
by the `crate-docs` build context), and key config files rather than
blindly rsyncing the whole project root. That protects server-side
state directories like `media/` and `data/` that don't exist locally.

### Redis serves two jobs

Redis is not "just cache". It is also the broker and coordination substrate, so changing its policy or availability characteristics has wider consequences.

### Dev and prod are close, but not identical

The dev stack is intentionally convenient:

- local test music
- Caddy instead of Traefik
- direct Vite servers

But auth, domains, and multi-origin behavior are designed to stay close enough to production to surface real issues.

## Recommended operator mental model

Think of Crate operations in four layers:

1. infrastructure and containers
2. API and worker runtime behavior
3. background tasks and queue health
4. library correctness and product correctness

Most incidents will span more than one of these layers.

## Related documents

- [System Overview](/technical/system-overview)
- [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services)
- [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
- [Documentation Platform and Hosted Site](/technical/documentation-platform-and-hosted-site)
