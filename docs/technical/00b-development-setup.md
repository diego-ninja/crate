# Development Setup

Set up a local development environment for contributing to Crate.

## Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose v2
- Git
- A small music collection for testing (or use the bundled `test-music/`)

## 1. Clone and install

```bash
git clone https://github.com/diego-ninja/crate.git
cd crate
npm install    # Installs all workspace dependencies (shared/ui, admin, listen)
```

Crate uses npm workspaces. The root `package.json` orchestrates three packages:

| Package | Path | What |
|---------|------|------|
| `@crate/ui` | `app/shared/ui` | Shared design system — tokens, primitives, shadcn, domain components |
| `ui` | `app/ui` | Admin web app |
| `crate-listen` | `app/listen` | Listening app |

## 2. Start the dev stack

```bash
make dev
```

This does everything:

1. Kills any leftover Vite processes
2. Starts Docker containers (PostgreSQL with pgvector, Redis, API, Worker, Caddy)
3. Installs npm dependencies
4. Launches five Vite dev servers with hot reload

| Service | URL | Port |
|---------|-----|------|
| Admin UI | `https://admin.dev.lespedants.org` | 5173 |
| Listen app | `https://listen.dev.lespedants.org` | 5174 |
| Docs | `https://docs.dev.cratemusic.app` | 5175 |
| Marketing site | `https://www.dev.cratemusic.app` | 5176 |
| API reference | `https://reference.dev.cratemusic.app` | 5177 |
| API | `https://api.dev.lespedants.org` | 8585 |

Local HTTPS is handled by Caddy with auto-generated certificates. Run `make trust-local-ca` once to trust the local CA in your browser.

### DNS setup

For the `.dev.lespedants.org` domains to resolve locally:

```bash
make dns-setup    # Configures /etc/hosts or local DNS
```

### Test library

Crate ships with `test-music/` containing 3 artists (Birds In Row, High Vis, Rival Schools) with 122 tracks. The dev stack mounts this automatically.

**Login:** `admin@cratemusic.app` / `admin`

## 3. Individual dev servers

If you only need one frontend:

```bash
make dev-back           # Backend only (Docker containers)
make dev-admin          # Admin UI on :5173
make dev-listen         # Listen app on :5174
make dev-site           # Marketing site on :5176

# Or via npm workspaces
npm run --workspace=app/ui dev -- --port 5173 --host
npm run --workspace=app/listen dev -- --port 5174 --host
```

### Against production API

Useful for testing frontend changes with real data:

```bash
cd app/ui && API_URL=https://admin.your-domain.com npm run dev
cd app/listen && API_URL=https://listen.your-domain.com npm run dev
```

## 4. Project structure

```
crate/
  package.json              # Root workspace config
  Makefile                  # Dev, deploy, build commands
  docker-compose.yaml       # Production stack
  docker-compose.dev.yaml   # Dev stack
  app/
    crate/                  # Python backend (API + Worker)
      api/                  # FastAPI routers
      db/                   # Database layer (SQLAlchemy + Alembic)
      worker_handlers/      # Background task handlers
    shared/
      ui/                   # @crate/ui design system
        tokens/             # CSS design tokens
        primitives/         # UI primitives (AppModal, ActionIconButton, etc.)
        shadcn/             # Curated shadcn/Radix components
        domain/             # Shared domain components
        lib/                # Shared hooks and utilities
      web/                  # Shared API client, hooks, formatters
      fonts/                # Poppins font files
    ui/                     # Admin frontend (React 19 + Vite)
    listen/                 # Listen frontend (React 19 + Vite + Capacitor)
    site/                   # Marketing landing page
    docs/                   # Documentation site
    reference/              # Scalar API reference
    tests/                  # Python backend tests
  docs/
    technical/              # Technical documentation (rendered by docs app)
    plans/                  # Design documents and plans
  tools/
    grooveyard-bliss/       # Rust CLI for audio similarity
```

## 5. Common tasks

### Type-checking

```bash
# Check all workspace packages
npm run --workspace=app/shared/ui typecheck
cd app/ui && npx tsc --noEmit
cd app/listen && npx tsc --noEmit
```

### Building @crate/ui

```bash
npm run --workspace=app/shared/ui build    # → dist/*.js + dist/*.d.ts
```

### Running backend tests

```bash
make dev-test           # Runs pytest inside the worker container
```

### Database migrations

Crate uses Alembic. Migrations run automatically on API startup. To create a new migration:

```bash
cd app && alembic revision -m "description"
# Edit the generated file in crate/db/migrations/versions/
```

### Building the Android APK

```bash
cd app/listen
npm run build:cap       # Build + sync with Capacitor
npx cap open android    # Open in Android Studio
```

## 6. Useful Make targets

| Command | What |
|---------|------|
| `make dev` | Start everything |
| `make dev-down` | Stop everything |
| `make dev-rebuild` | Force rebuild + restart |
| `make dev-logs` | Tail backend logs |
| `make dev-logs s=worker` | Tail specific service |
| `make ps` | Status of all services |
| `make deploy` | Deploy to production server |
