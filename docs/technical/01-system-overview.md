# System Overview

## What Crate is

Crate is a self-hosted music platform built around one canonical library and two separate products on top of it:

- `app/ui`: the admin application for curation, repair, ingestion, enrichment, analytics, and operations. Has a minimal preview player (plain `<audio>`) for sampling tracks while working.
- `app/listen`: the listener-facing application for playback, discovery, library browsing, social features, and mobile/PWA use. Ships a full audio engine: Gapless-5, crossfade, equalizer, visualizer, media session integration.

Both products sit on the same backend and database, but they are intentionally separate applications with different UX priorities and different internal architecture.

## Core architectural principles

### 1. The API is read-only against the music library

The API container mounts `/music` as read-only. This is a deliberate constraint, not an accident.

- API code can browse files, stream audio, inspect images, and expose metadata.
- Any operation that writes to the filesystem must go through a background task executed by the worker.
- This keeps HTTP request handlers simple and reduces the risk of accidental writes from the public-facing process.

### 2. Background work is first-class

Crate does a lot of work that should not happen inline with a request:

- library scans
- metadata enrichment
- audio analysis
- similarity calculation
- acquisition from Tidal and Soulseek
- image processing
- storage migration
- cleanup and repair

This work is represented as database-backed task rows, dispatched to Dramatiq workers only after the creating transaction commits, and surfaced live to the UI through task events and status endpoints.

### 3. The database is the system of record

Filesystem state matters, but most product features are DB-first:

- artists, albums, tracks, playlists, and users are modeled in PostgreSQL
- enrichment results are persisted into artist/album/track tables
- tasks and task events are persisted in PostgreSQL
- cache can spill to PostgreSQL as an L3 fallback
- playback history, social graph, sessions, affinity, jam state, and system playlists all derive from DB state

### 4. Crate is now a platform, not just a library browser

The repo contains several architectural layers:

- library management and repair
- acquisition and post-processing
- enrichment and analytics
- streaming and playback
- social graph and collaborative features
- Open Subsonic compatibility
- mobile-oriented listening UI

That means there is no single "main" flow anymore. Crate has multiple equally important axes.

## Runtime stack

### Backend services

- `crate-api`: FastAPI application serving REST, SSE, streaming endpoints, artwork, lyrics, auth, and an Open Subsonic-compatible API for third-party clients.
- `crate-worker`: Python worker process hosting Dramatiq consumers plus a service loop for the filesystem watcher, scheduler, cleanup routines, and the long-running audio analysis / Bliss daemons.
- `crate-postgres`: PostgreSQL 15, the primary store.
- `crate-redis`: Redis 7, used both as cache and as the Dramatiq broker.
- `slskd`: Soulseek daemon with REST API.

### Frontend services

- `crate-ui`: desktop-oriented admin SPA.
- `crate-listen`: consumer-oriented listening app, designed for PWA and Capacitor packaging.

### Supporting integrations

- Traefik in production.
- Caddy in local dev.
- Tidal acquisition through `tiddl`.
- Last.fm, MusicBrainz, Fanart.tv, Ticketmaster, Discogs, Spotify, Setlist.fm, lrclib, and others.

## High-level system graph

```text
                        Browser / PWA / Capacitor shell
                                   |
                     +-------------+-------------+
                     |                           |
                crate-ui                    crate-listen
                     |                           |
                     +-------------+-------------+
                                   |
                               crate-api
                                   |
       +---------------------------+----------------------------+
       |                           |                            |
   PostgreSQL                  Redis DB 0                   /music (ro)
       |                           |
       |                      Redis DB 1
       |                      Dramatiq broker
       |                           |
       +---------------------------+
                                   |
                               crate-worker
                                   |
                +------------------+------------------+
                |                  |                  |
             /music (rw)       slskd API       external metadata APIs
```

## Main code areas

### Backend

- `https://github.com/diego-ninja/crate/blob/main/app/crate/api`: FastAPI routers by domain.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/db`: database access and schema helpers.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/worker_handlers`: task implementations grouped by domain.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/actors.py`: Dramatiq dispatch and execution wrappers.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/library_sync.py`: filesystem to DB synchronization.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/enrichment.py`: unified artist enrichment entrypoint.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/audio_analysis.py`: audio feature extraction.
- `https://github.com/diego-ninja/crate/blob/main/app/crate/bliss.py`: similarity and transition logic.

### Frontend

- `https://github.com/diego-ninja/crate/blob/main/app/ui/src`: admin app.
- `https://github.com/diego-ninja/crate/blob/main/app/listen/src`: listening app.
- `https://github.com/diego-ninja/crate/blob/main/app/shared/web`: small shared web helpers such as API and route utilities.

## Cross-cutting architectural decisions

### Separate frontends instead of one shared app

Crate keeps `ui` and `listen` separate on purpose:

- admin workflows are dense, operational, and desktop-centric
- listen workflows are immersive, mobile-aware, and playback-centric
- the products share API contracts and some utilities, but not a single UI shell

### DB-backed tasks plus Dramatiq transport

Crate intentionally uses both:

- PostgreSQL rows for auditability, UI status, progress, and cancellation
- Dramatiq + Redis for scalable asynchronous execution

Task rows are written first and the broker send is an after-commit side effect. That hybrid gives better operator visibility than "messages only" systems and avoids workers racing uncommitted task state.

### Transitional storage model

Crate is in the middle of a move from name-based library paths to storage-id-based layout:

- legacy layout still exists and is supported
- new storage-v2 layout uses UUID-backed `storage_id`
- sync and acquisition are aware of both

This has implications for sync, imports, storage migration, and playback identity.

### Product logic lives in the backend, not the frontend

The UI is relatively thin compared with the server:

- discovery sections are assembled on the server
- affinity is computed on the server
- system playlists are generated on the server
- task orchestration is server-owned
- playback telemetry is emitted client-side but interpreted server-side

## Reading order for the rest of the docs

From here, the best next document is usually [Backend API and Data Layer](/technical/backend-api-and-data), followed by [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services).
