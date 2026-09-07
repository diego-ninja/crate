---
title: Development setup
summary: Run the complete local Crate stack and its four web workspaces.
section: start
audience: [developer]
status: canonical
order: 20
verified: 2026-07-21
sources: [Makefile, docker-compose.dev.yaml, docker-compose.readplane.dev.yaml]
---

# Development setup

## Prerequisites

- Node.js 20+ and npm.
- Docker Engine and Docker Compose v2.
- Python/uv and Go/Rust only when working directly on those services.
- The repository checkout and its `test-music/` fixture library.

```bash
git clone https://github.com/thecrateapp/crate.git
cd crate
npm install
make dev
```

`make dev` is the supported local entry point. It combines
`docker-compose.dev.yaml` and `docker-compose.readplane.dev.yaml`, builds the
backend stack and starts the Vite applications. Do not start only the base dev
compose if the change involves readplane-routed endpoints or SSE.

## Local services

| Surface   | Local port | Normal development hostname         |
| --------- | ---------: | ----------------------------------- |
| Admin     |       5173 | `https://admin.dev.lespedants.org`  |
| Listen    |       5174 | `https://listen.dev.lespedants.org` |
| Docs      |       5175 | `https://docs.dev.cratemusic.app`   |
| Site      |       5176 | `https://www.dev.cratemusic.app`    |
| API       |       8585 | `https://api.dev.lespedants.org`    |
| Readplane |       8686 | `http://localhost:8686`             |

The local backend includes PostgreSQL, cache Redis, durable Redis, `slskd`, API,
readplane, workers for normal/maintenance/analysis/playback work, projector,
media worker and Caddy. The dev fixture has three artists and 122 tracks.

## Sentry observability

The API, readplane and worker processes use the DSNs configured in the local
`.env` (`SENTRY_API_DSN`, `SENTRY_READPLANE_DSN` and `SENTRY_WORKERS_DSN`).
Listen and Admin use their browser/Capacitor DSNs at build time. Production CI
reads `SENTRY_ADMIN_DSN` and `SENTRY_LISTEN_DSN` from GitHub Actions Variables,
and uses the `SENTRY_AUTH_TOKEN` Actions Secret only to upload source maps.
The SDKs keep default PII collection disabled and redact credentials, cookies,
query strings and user contact fields before sending events.

Local frontend builds run without Sentry unless `VITE_SENTRY_DSN` is exported.
This keeps development noise and accidental local event uploads opt-in.

For local TLS and hostnames:

```bash
make dns-setup       # *.crate.local -> 127.0.0.1; requires sudo
make trust-local-ca  # trusts the mkcert CA used by the local Caddy certificate
```

Those targets are convenience helpers, not portable prerequisites. Run
`make trust-local-ca` once on macOS. `make dev` generates the local certificate
from the already trusted `mkcert` CA when it is missing, so recreating the
Caddy data volume does not change the certificate authority used by browsers.
`make dev` also advertises project development domains through Caddy; verify
the active Caddyfile and local resolver when cookies or TLS are relevant to
your change.

The seeded development account is `admin@cratemusic.app` / `admin`.

## Focused workflows

```bash
make dev-back     # backend, including readplane overlay
make dev-admin    # Admin Vite on 5173
make dev-listen   # Listen Vite on 5174
make dev-docs     # Docs Vite on 5175
make dev-site     # marketing Site Vite on 5176
make dev-logs s=worker
make dev-down
```

The npm workspace includes four web packages: `app/shared/ui`, `app/ui`,
`app/listen` and `app/listen-desktop`. Docs and Site are standalone Vite apps;
their dependencies are installed by `make dev`.

## Federation harness

Federation uses a separate two-node stack so it never shares the normal dev
database or fixture media:

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-down
```

Node A exposes API/readplane/Admin/Listen on 18585/18686/15173/15174; Node B
uses 28585/28686. There are focused acceptance targets for global catalog,
playback prepare, imports, singleton parity and zero-downtime catalog reads.
Read [Federation overview](federation-overview.md) before changing those flows.

## Tests and migrations

`make dev-test` runs backend checks plus Python, Go, Rust and frontend checks;
it is not a worker-only pytest shortcut. For a narrow Python test use the
project virtual environment or `uv run pytest`; for a full isolated backend run
use `make dev-test-backend`.

Alembic is the authoritative schema path. API/worker startup serializes
`alembic upgrade head` with an advisory lock. Add migrations under
`app/crate/db/migrations/versions/`; do not bootstrap schema changes from a
frontend or an ad-hoc script.

See [Developer guide](developer-guide.md) for ownership boundaries and the
complete repository map.
