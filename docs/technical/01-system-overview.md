# System Overview

## What Crate is

Crate is a self-hosted music platform built around one canonical library and
two separate products on top of it:

- `app/ui`: the admin application for curation, repair, ingestion, enrichment,
  analytics, and operations. It includes a lightweight preview player and a
  snapshot-backed ops dashboard.
- `app/listen`: the listener-facing application for playback, discovery,
  library browsing, social features, and PWA/Capacitor use. It ships the real
  playback engine, queueing, equalizer, offline behavior, and listening
  telemetry.

They share the same backend and database, but they are intentionally separate
applications with different UX priorities and different internal architecture.

## Core architectural principles

### 1. The API is read-only against the music library

The API container mounts `/music` read-only. This is a deliberate boundary.

- API code can browse files, stream audio, inspect images, and expose metadata.
- Any operation that writes to the filesystem must go through the worker.
- This keeps HTTP handlers simple and removes a large class of accidental
  library mutations from the public-facing process.

### 2. Background work is first-class

Crate does significant work that should not happen inline with a request:

- library scans
- metadata enrichment
- audio analysis
- similarity calculation
- acquisition from Tidal and Soulseek
- image processing
- storage migration
- cleanup and repair
- stats recompute and post-playback follow-ups

Some of this work is represented as database-backed task rows dispatched to
Dramatiq after commit. Some of it runs as long-lived daemons or follow-up
actors. The worker is therefore a background runtime, not just a queue
consumer.

### 3. PostgreSQL is the durable system of record

Filesystem state matters, but most product features are DB-first:

- artists, albums, tracks, playlists, users, and sessions live in PostgreSQL
- enrichment results are persisted
- tasks and task events are persisted
- listening telemetry is persisted in `user_play_events`
- read models such as UI snapshots and ops runtime state are persisted or
  materialized from DB-backed truth

### 4. Crate now has an explicit read plane

The runtime no longer relies only on “run a query every time the UI asks”.

Important current pieces:

- `crate-readplane`, a Go service for hot read routes and SSE relay with
  FastAPI fallback
- `ui_snapshots` for persisted snapshot payloads
- `ops_runtime_state` for fast operational surfaces
- `import_queue_items` for import queue read models
- Redis Streams domain events
- a dedicated projector container that warms affected surfaces
- snapshot SSE endpoints that notify clients when warmed data changes

### 5. Listening telemetry is richer than the old history model

The canonical telemetry path is now `user_play_events`, not the old
`play_history` write path.

- Listen emits rich `/api/me/play-events` payloads
- clients may include `client_event_id` for idempotent retries
- stats recompute and scrobble happen asynchronously after commit
- read surfaces such as history, recent activity, and stats derive from the
  new telemetry model

## Runtime stack

### Backend services

- `crate-api`: FastAPI app serving REST, SSE, streaming endpoints, artwork,
  lyrics, auth, and the Open Subsonic-compatible API.
- `crate-readplane`: Go service serving selected Listen/Admin read routes,
  snapshot responses, and SSE relay with FastAPI fallback.
- `crate-worker`: fast/default Dramatiq consumers plus the service loop,
  scheduler, watcher, imports, cleanup, and write-capable filesystem work.
- `crate-projector`: domain-event consumer that warms snapshots/read models.
- `crate-maintenance-worker`: maintenance/repair/sync/enrichment queue worker.
- `crate-analysis-worker`: heavy queue worker for audio analysis, fingerprints,
  and bliss-oriented background work.
- `crate-playback-worker`: playback queue worker for prepare/transcode jobs.
- `crate-media-worker`: Rust service for album/track download packages,
  ZIP64 output, Redis progress/cancel, and active slot gating.
- `crate-postgres`: PostgreSQL 15, the primary store.
- `crate-redis`: Redis 7, used for cache, broker, cache invalidation replay,
  metrics buckets, and the Redis Streams domain-event bus.
- `slskd`: Soulseek daemon with REST API.

### Frontend services

- `crate-ui`: desktop-oriented admin SPA.
- `crate-listen`: consumer-oriented listening app for web/PWA/Capacitor.

### Supporting integrations

- Traefik in production
- Caddy in local dev
- Tidal acquisition through `tiddl`
- Last.fm, MusicBrainz, Fanart.tv, Ticketmaster, Discogs, Spotify, Setlist.fm,
  `lrclib`, and others

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
       |                    cache + SSE + metrics               |
       |                           |
       |                    crate-readplane
       |                    hot reads + SSE
       |                           |
       |                       Redis Streams
       |                     domain-event bus
       |                           |
       |                      Redis DB 1
       |                     Dramatiq broker
       |                           |
       +---------------------------+
                                   |
           +------------+----------+----------+-------------+
           |            |          |          |             |
      crate-worker  maintenance analysis  playback   crate-projector
                                   |
       +---------------+-----------+------------+----------------+
       |               |                        |                |
   Dramatiq actors  service loop       analysis/bliss     /music (rw)
                                        workers

      crate-media-worker reads /music and writes generated artifacts/progress
```

## Main code areas

### Backend

- `app/crate/api`: FastAPI routers by domain
- `app/crate/db`: database access, read models, schema helpers, and migrations
- `app/crate/worker_handlers`: task implementations grouped by domain
- `app/crate/actors.py`: Dramatiq dispatch and execution wrappers
- `app/crate/library_sync.py`: filesystem-to-DB synchronization
- `app/crate/enrichment.py`: unified artist enrichment entrypoint
- `app/crate/audio_analysis.py`: feature extraction
- `app/crate/bliss.py`: similarity and transition logic
- `app/crate/projector.py`: domain event consumption and snapshot warming
- `app/crate/resource_governor.py`: host/playback-aware backpressure and
  maintenance-window decisions
- `app/readplane`: Go read plane
- `app/media-worker`: Rust media worker

### Frontend

- `app/ui/src`: admin app
- `app/listen/src`: listening app
- `app/shared/ui`: shared design system package
- `app/shared/web`: shared API and route helpers

## Cross-cutting architectural decisions

### Separate frontends instead of one shared app

Crate keeps `ui` and `listen` separate on purpose:

- admin workflows are dense, operational, and desktop-centric
- listen workflows are immersive, mobile-aware, and playback-centric
- the products share contracts and a UI package, but not one giant shell

### DB-backed tasks plus non-task eventing

Crate intentionally uses both:

- PostgreSQL task rows for auditability, UI status, cancellation, and operator
  visibility
- Dramatiq + Redis for asynchronous execution
- Redis Streams domain events plus projector-driven snapshot warming for read
  model freshness

### Product logic lives in the backend

The UI is relatively thin compared with the server:

- discovery sections are assembled on the server
- ops surfaces are snapshot-backed on the server
- task orchestration is server-owned
- playback telemetry is emitted client-side but interpreted and aggregated
  server-side

## Reading order for the rest of the docs

From here, the best next document is usually
[Backend API and Data Layer](/technical/backend-api-and-data), followed by
[Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services).
